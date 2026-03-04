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
  private role: BackendRole | null = null;
  private server: ReturnType<typeof createServer> | null = null;
  private endpoint: DaemonEndpoint | null = null;

  constructor(config: SharedMemoryBackendConfig) {
    this.localService = new MemoryService({
      storagePath: config.storagePath,
      vectorSearch: config.vectorSearch,
    });

    this.lockPath = join(config.storagePath, '.memhub-daemon.lock');
    this.endpointPath = join(config.storagePath, '.memhub-daemon.json');
  }

  async initialize(): Promise<void> {
    if (this.role) return;
    await fs.mkdir(dirname(this.lockPath), { recursive: true });
    await this.electRole();
  }

  async memoryLoad(input: MemoryLoadInput): Promise<MemoryLoadOutput> {
    await this.initialize();

    if (this.role === 'daemon') {
      return this.localService.memoryLoad(input);
    }

    try {
      return (await this.sendRequest({
        id: randomUUID(),
        method: 'memory_load',
        params: input,
      })) as MemoryLoadOutput;
    } catch {
      await this.recoverFromDaemonFailure();
      if (this.role !== 'client') {
        return this.localService.memoryLoad(input);
      }
      return (await this.sendRequest({
        id: randomUUID(),
        method: 'memory_load',
        params: input,
      })) as MemoryLoadOutput;
    }
  }

  async memoryUpdate(input: MemoryUpdateInput): Promise<MemoryUpdateOutput> {
    await this.initialize();

    if (this.role === 'daemon') {
      return this.localService.memoryUpdate(input);
    }

    try {
      return (await this.sendRequest({
        id: randomUUID(),
        method: 'memory_update',
        params: input,
      })) as MemoryUpdateOutput;
    } catch {
      await this.recoverFromDaemonFailure();
      if (this.role !== 'client') {
        return this.localService.memoryUpdate(input);
      }
      return (await this.sendRequest({
        id: randomUUID(),
        method: 'memory_update',
        params: input,
      })) as MemoryUpdateOutput;
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
      return;
    }

    this.role = 'client';
    this.endpoint = await this.waitForEndpoint();
  }

  private async tryBecomeDaemon(): Promise<boolean> {
    const lockPayload = JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() });

    try {
      await fs.writeFile(this.lockPath, lockPayload, { encoding: 'utf8', flag: 'wx' });
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
    }

    try {
      const endpoint = await this.startDaemonServer();
      this.endpoint = endpoint;
      await fs.writeFile(this.endpointPath, JSON.stringify(endpoint), 'utf8');
      this.registerExitHooks();
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
      return;
    }

    try {
      const result =
        request.method === 'memory_load'
          ? await this.localService.memoryLoad(request.params)
          : await this.localService.memoryUpdate(request.params);

      const response: DaemonResponse = { id: request.id, ok: true, result };
      socket.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      const response: DaemonResponse = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown daemon error',
      };
      socket.write(`${JSON.stringify(response)}\n`);
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
        socket.write(`${JSON.stringify(request)}\n`);
      });
    });
  }

  private async recoverFromDaemonFailure(): Promise<void> {
    this.endpoint = null;

    if (await this.tryBecomeDaemon()) {
      this.role = 'daemon';
      return;
    }

    this.role = 'client';
    this.endpoint = await this.waitForEndpoint();
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
