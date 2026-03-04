import { createServer, Socket } from 'net';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import type {
  MemoryLoadInput,
  MemoryLoadOutput,
  MemoryUpdateInput,
  MemoryUpdateOutput,
} from '../contracts/types.js';
import { MemoryService } from '../services/memory-service.js';
import { createLogger, type Logger } from '../utils/logger.js';

const PROTOCOL_VERSION = 1;
const LOOPBACK_HOST = '127.0.0.1';

type BackendRole = 'daemon' | 'client';

type DaemonEndpoint = {
  readonly pid: number;
  readonly host: string;
  readonly port: number;
  readonly protocolVersion: number;
};

type DaemonRequest =
  | {
      readonly id: string;
      readonly method: 'memory_load';
      readonly params: MemoryLoadInput;
    }
  | {
      readonly id: string;
      readonly method: 'memory_update';
      readonly params: MemoryUpdateInput;
    };

type DaemonResponse = {
  readonly id: string;
  readonly ok: boolean;
  readonly result?: MemoryLoadOutput | MemoryUpdateOutput;
  readonly error?: string;
};

export interface SharedMemoryBackendConfig {
  readonly storagePath: string;
  readonly vectorSearch?: boolean;
}

export interface MemoryBackend {
  initialize(): Promise<void>;
  memoryLoad(input: MemoryLoadInput): Promise<MemoryLoadOutput>;
  memoryUpdate(input: MemoryUpdateInput): Promise<MemoryUpdateOutput>;
  close(): Promise<void>;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      return (error as { code?: string }).code === 'EPERM';
    }
    return false;
  }
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch {
    // Best-effort cleanup only.
  }
}

export class SharedMemoryBackend implements MemoryBackend {
  private readonly localService: MemoryService;
  private readonly lockPath: string;
  private readonly endpointPath: string;
  private readonly logger: Logger;
  private role: BackendRole | null = null;
  private server: ReturnType<typeof createServer> | null = null;
  private endpoint: DaemonEndpoint | null = null;

  constructor(config: SharedMemoryBackendConfig) {
    this.localService = new MemoryService({
      storagePath: config.storagePath,
      vectorSearch: config.vectorSearch,
    });
    this.logger = createLogger({ role: 'client' });

    this.lockPath = join(config.storagePath, '.memhub-daemon.lock');
    this.endpointPath = join(config.storagePath, '.memhub-daemon.json');
  }

  async initialize(): Promise<void> {
    if (this.role) return;
    await fs.mkdir(dirname(this.lockPath), { recursive: true });
    await this.electRole();
    await this.logger.info('backend.initialize', 'Shared memory backend initialized', {
      meta: { role: this.role },
    });
  }

  async memoryLoad(input: MemoryLoadInput): Promise<MemoryLoadOutput> {
    await this.initialize();
    const requestId = randomUUID();
    const start = Date.now();
    await this.logger.info('memory_load.start', 'memory_load request started', {
      requestId,
      meta: {
        hasId: !!input.id,
        hasQuery: !!input.query,
        category: input.category,
        tagsCount: input.tags?.length ?? 0,
      },
    });

    if (this.role === 'daemon') {
      try {
        const result = await this.localService.memoryLoad(input);
        await this.logger.info('memory_load.success', 'memory_load served locally by daemon', {
          requestId,
          durationMs: Date.now() - start,
          meta: { items: result.total },
        });
        return result;
      } catch (error) {
        await this.logger.error('memory_load.fail', 'memory_load failed on daemon', {
          requestId,
          durationMs: Date.now() - start,
          meta: { error: error instanceof Error ? error.message : 'Unknown error' },
        });
        throw error;
      }
    }

    try {
      const result = (await this.sendRequest({
        id: randomUUID(),
        method: 'memory_load',
        params: input,
      })) as MemoryLoadOutput;
      await this.logger.info('memory_load.success', 'memory_load served via daemon IPC', {
        requestId,
        durationMs: Date.now() - start,
        meta: { items: result.total },
      });
      return result;
    } catch {
      await this.logger.warn('memory_load.retry', 'memory_load failed, trying daemon failover', {
        requestId,
      });
      await this.recoverFromDaemonFailure();
      if (this.role !== 'client') {
        const result = await this.localService.memoryLoad(input);
        await this.logger.info('memory_load.success', 'memory_load served after daemon failover', {
          requestId,
          durationMs: Date.now() - start,
          meta: { items: result.total },
        });
        return result;
      }
      const result = (await this.sendRequest({
        id: randomUUID(),
        method: 'memory_load',
        params: input,
      })) as MemoryLoadOutput;
      await this.logger.info(
        'memory_load.success',
        'memory_load served via daemon IPC after failover',
        {
          requestId,
          durationMs: Date.now() - start,
          meta: { items: result.total },
        }
      );
      return result;
    }
  }

  async memoryUpdate(input: MemoryUpdateInput): Promise<MemoryUpdateOutput> {
    await this.initialize();
    const requestId = randomUUID();
    const start = Date.now();
    await this.logger.info('memory_update.start', 'memory_update request started', {
      requestId,
      sessionId: input.sessionId,
      meta: {
        hasId: !!input.id,
        entryType: input.entryType,
        category: input.category,
        tagsCount: input.tags?.length ?? 0,
      },
    });

    if (this.role === 'daemon') {
      try {
        const result = await this.localService.memoryUpdate(input);
        await this.logger.info('memory_update.success', 'memory_update served locally by daemon', {
          requestId,
          sessionId: result.sessionId,
          durationMs: Date.now() - start,
          meta: { id: result.id, created: result.created, updated: result.updated },
        });
        return result;
      } catch (error) {
        await this.logger.error('memory_update.fail', 'memory_update failed on daemon', {
          requestId,
          sessionId: input.sessionId,
          durationMs: Date.now() - start,
          meta: { error: error instanceof Error ? error.message : 'Unknown error' },
        });
        throw error;
      }
    }

    try {
      const result = (await this.sendRequest({
        id: randomUUID(),
        method: 'memory_update',
        params: input,
      })) as MemoryUpdateOutput;
      await this.logger.info('memory_update.success', 'memory_update served via daemon IPC', {
        requestId,
        sessionId: result.sessionId,
        durationMs: Date.now() - start,
        meta: { id: result.id, created: result.created, updated: result.updated },
      });
      return result;
    } catch {
      await this.logger.warn(
        'memory_update.retry',
        'memory_update failed, trying daemon failover',
        {
          requestId,
        }
      );
      await this.recoverFromDaemonFailure();
      if (this.role !== 'client') {
        const result = await this.localService.memoryUpdate(input);
        await this.logger.info(
          'memory_update.success',
          'memory_update served after daemon failover',
          {
            requestId,
            sessionId: result.sessionId,
            durationMs: Date.now() - start,
            meta: { id: result.id, created: result.created, updated: result.updated },
          }
        );
        return result;
      }
      const result = (await this.sendRequest({
        id: randomUUID(),
        method: 'memory_update',
        params: input,
      })) as MemoryUpdateOutput;
      await this.logger.info(
        'memory_update.success',
        'memory_update served via daemon IPC after failover',
        {
          requestId,
          sessionId: result.sessionId,
          durationMs: Date.now() - start,
          meta: { id: result.id, created: result.created, updated: result.updated },
        }
      );
      return result;
    }
  }

  async close(): Promise<void> {
    if (this.server) {
      await new Promise<void>(resolve => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    if (this.role === 'daemon') {
      await safeUnlink(this.endpointPath);
      await safeUnlink(this.lockPath);
    }
    await this.logger.info('backend.close', 'Shared memory backend closed', {
      meta: { role: this.role },
    });

    this.role = null;
    this.endpoint = null;
  }

  _getRoleForTest(): BackendRole | null {
    return this.role;
  }

  private async electRole(): Promise<void> {
    const becameDaemon = await this.tryBecomeDaemon();

    if (becameDaemon) {
      this.role = 'daemon';
      this.logger.setRole('daemon');
      await this.logger.info('daemon.elected', 'Current process elected as daemon');
      return;
    }

    this.role = 'client';
    this.logger.setRole('client');
    this.endpoint = await this.waitForEndpoint();
    await this.logger.info('daemon.connected', 'Connected to existing daemon', {
      meta: { endpoint: this.endpoint },
    });
  }

  private async tryBecomeDaemon(): Promise<boolean> {
    const lockPayload = JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() });

    try {
      await fs.writeFile(this.lockPath, lockPayload, { encoding: 'utf8', flag: 'wx' });
      await this.logger.info('lock.acquire', 'Acquired daemon election lock', {
        meta: { lockPath: this.lockPath },
      });
    } catch (error) {
      const alreadyExists =
        !!error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: string }).code === 'EEXIST';

      if (!alreadyExists) throw error;

      const staleRecovered = await this.tryRecoverStaleLock();
      if (!staleRecovered) return false;

      await fs.writeFile(this.lockPath, lockPayload, { encoding: 'utf8', flag: 'wx' });
      await this.logger.warn('lock.recovered', 'Recovered stale daemon lock and acquired it');
    }

    try {
      const endpoint = await this.startDaemonServer();
      this.endpoint = endpoint;
      await fs.writeFile(this.endpointPath, JSON.stringify(endpoint), 'utf8');
      this.registerExitHooks();
      await this.logger.info('daemon.ready', 'Daemon endpoint published', {
        meta: { endpoint },
      });
      return true;
    } catch (error) {
      await safeUnlink(this.lockPath);
      throw error;
    }
  }

  private async tryRecoverStaleLock(): Promise<boolean> {
    let raw = '';
    try {
      raw = await fs.readFile(this.lockPath, 'utf8');
    } catch {
      return true;
    }

    let stale = true;
    try {
      const lock = parseJson<{ pid?: number }>(raw);
      stale = !isProcessAlive(lock.pid ?? -1);
    } catch {
      stale = true;
    }

    if (stale) {
      await safeUnlink(this.lockPath);
      await safeUnlink(this.endpointPath);
      await this.logger.warn('lock.stale_recovered', 'Recovered stale daemon lock');
      return true;
    }

    return false;
  }

  private async waitForEndpoint(): Promise<DaemonEndpoint> {
    for (let i = 0; i < 40; i += 1) {
      try {
        const raw = await fs.readFile(this.endpointPath, 'utf8');
        const endpoint = parseJson<DaemonEndpoint>(raw);
        if (endpoint.protocolVersion !== PROTOCOL_VERSION) {
          throw new Error(
            `Daemon protocol mismatch: expected ${PROTOCOL_VERSION}, got ${endpoint.protocolVersion}`
          );
        }

        if (!isProcessAlive(endpoint.pid)) {
          await safeUnlink(this.lockPath);
          await safeUnlink(this.endpointPath);
          await this.logger.warn(
            'daemon.dead',
            'Discovered dead daemon endpoint, triggering election'
          );
          break;
        }

        return endpoint;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }

    if (await this.tryBecomeDaemon()) {
      this.role = 'daemon';
      return this.endpoint!;
    }

    throw new Error('Failed to discover running daemon endpoint');
  }

  private async startDaemonServer(): Promise<DaemonEndpoint> {
    const server = createServer((socket: Socket) => {
      let buffer = '';

      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        buffer += chunk;

        while (true) {
          const newlineIndex = buffer.indexOf('\n');
          if (newlineIndex === -1) break;

          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (!line) continue;

          void this.handleSocketRequest(socket, line);
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, LOOPBACK_HOST, () => {
        server.off('error', reject);
        resolve();
      });
    });

    this.server = server;

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve daemon server address');
    }

    return {
      pid: process.pid,
      host: LOOPBACK_HOST,
      port: address.port,
      protocolVersion: PROTOCOL_VERSION,
    };
  }

  private async handleSocketRequest(socket: Socket, line: string): Promise<void> {
    let request: DaemonRequest;
    try {
      request = parseJson<DaemonRequest>(line);
    } catch {
      const response: DaemonResponse = { id: 'unknown', ok: false, error: 'Invalid JSON request' };
      socket.write(`${JSON.stringify(response)}\n`);
      await this.logger.error('ipc.request.invalid', 'Received invalid daemon request JSON');
      return;
    }

    try {
      const result =
        request.method === 'memory_load'
          ? await this.localService.memoryLoad(request.params)
          : await this.localService.memoryUpdate(request.params);

      const response: DaemonResponse = { id: request.id, ok: true, result };
      socket.write(`${JSON.stringify(response)}\n`);
      await this.logger.info('ipc.response', 'Daemon request served', {
        requestId: request.id,
        meta: { method: request.method },
      });
    } catch (error) {
      const response: DaemonResponse = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown daemon error',
      };
      socket.write(`${JSON.stringify(response)}\n`);
      await this.logger.error('ipc.response.fail', 'Daemon request failed', {
        requestId: request.id,
        meta: { method: request.method, error: response.error },
      });
    }
  }

  private async sendRequest(
    request: DaemonRequest
  ): Promise<MemoryLoadOutput | MemoryUpdateOutput> {
    const endpoint = this.endpoint ?? (await this.waitForEndpoint());

    return new Promise((resolve, reject) => {
      const socket = new Socket();
      let buffer = '';

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Daemon request timeout'));
      }, 5000);

      socket.setEncoding('utf8');

      socket.on('error', error => {
        clearTimeout(timeout);
        void this.logger.error('ipc.request.fail', 'Daemon request socket error', {
          requestId: request.id,
          meta: { error: error.message },
        });
        reject(error);
      });

      socket.on('data', (chunk: string) => {
        buffer += chunk;
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex === -1) return;

        const line = buffer.slice(0, newlineIndex).trim();
        clearTimeout(timeout);
        socket.end();

        if (!line) {
          reject(new Error('Daemon returned empty response'));
          return;
        }

        let response: DaemonResponse;
        try {
          response = parseJson<DaemonResponse>(line);
        } catch {
          reject(new Error('Daemon returned invalid JSON response'));
          return;
        }

        if (!response.ok) {
          reject(new Error(response.error ?? 'Daemon request failed'));
          return;
        }

        if (!response.result) {
          reject(new Error('Daemon response missing result'));
          return;
        }

        resolve(response.result);
      });

      socket.connect(endpoint.port, endpoint.host, () => {
        void this.logger.info('ipc.request', 'Sending daemon request', {
          requestId: request.id,
          meta: { method: request.method, endpoint },
        });
        socket.write(`${JSON.stringify(request)}\n`);
      });
    });
  }

  private async recoverFromDaemonFailure(): Promise<void> {
    this.endpoint = null;
    await this.logger.warn('daemon.failover', 'Attempting daemon failover recovery');

    if (await this.tryBecomeDaemon()) {
      this.role = 'daemon';
      this.logger.setRole('daemon');
      await this.logger.warn('daemon.failover.promoted', 'Promoted current process to daemon');
      return;
    }

    this.role = 'client';
    this.logger.setRole('client');
    this.endpoint = await this.waitForEndpoint();
    await this.logger.info('daemon.failover.connected', 'Connected to replacement daemon', {
      meta: { endpoint: this.endpoint },
    });
  }

  private registerExitHooks(): void {
    const cleanup = (): void => {
      void safeUnlink(this.endpointPath);
      void safeUnlink(this.lockPath);
    };

    process.once('exit', cleanup);
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }
}
