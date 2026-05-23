import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { MemoryService } from '../services/memory-service.js';
import type { RerankerMode } from '../services/retrieval/reranker.js';
import { createLogger, type Logger } from '../utils/logger.js';
import { DaemonManager, IpcServer, isProcessAlive } from './ipc/index.js';
import type { DaemonEndpoint, DaemonRequest } from './ipc/index.js';

const DEFAULT_DAEMON_START_TIMEOUT_MS = 10_000;
const DAEMON_STOP_TIMEOUT_MS = 5_000;

export interface DaemonConfig {
  readonly storagePath: string;
  readonly vectorSearch?: boolean;
  readonly rerankerMode?: RerankerMode;
  readonly rerankerModelName?: string;
  readonly logger?: Logger;
}

export interface DaemonStatus {
  readonly running: boolean;
  readonly endpoint?: DaemonEndpoint;
  readonly lockPath: string;
  readonly endpointPath: string;
}

export interface StartBackgroundResult {
  readonly started: boolean;
  readonly endpoint: DaemonEndpoint;
}

export class DaemonAlreadyRunningError extends Error {
  constructor(readonly endpoint: DaemonEndpoint) {
    super(`MemHub daemon is already running (pid=${endpoint.pid})`);
    this.name = 'DaemonAlreadyRunningError';
  }
}

export class DaemonNotRunningError extends Error {
  constructor() {
    super('MemHub daemon is not running');
    this.name = 'DaemonNotRunningError';
  }
}

export class DaemonController {
  private readonly logger: Logger;
  private readonly manager: DaemonManager;
  private runtime: { server: IpcServer } | null = null;

  constructor(private readonly config: DaemonConfig) {
    this.logger = config.logger ?? createLogger({ role: 'daemon' });
    this.manager = new DaemonManager(config.storagePath, this.logger);
  }

  getLockPath(): string {
    return this.manager.getLockPath();
  }

  getEndpointPath(): string {
    return this.manager.getEndpointPath();
  }

  async status(): Promise<DaemonStatus> {
    const endpoint = await this.manager.waitForEndpoint(100, 25);
    return {
      running: endpoint !== null,
      ...(endpoint && { endpoint }),
      lockPath: this.manager.getLockPath(),
      endpointPath: this.manager.getEndpointPath(),
    };
  }

  async startForeground(): Promise<DaemonEndpoint> {
    await fs.mkdir(dirname(this.manager.getLockPath()), { recursive: true });

    const lock = await this.manager.tryAcquireDaemonLock();
    if (!lock.acquired) {
      const endpoint = await this.manager.waitForEndpoint();
      if (endpoint) throw new DaemonAlreadyRunningError(endpoint);
      throw new Error('Failed to acquire daemon lock and no running daemon was discovered');
    }

    const service = new MemoryService({
      storagePath: this.config.storagePath,
      vectorSearch: this.config.vectorSearch,
      rerankerMode: this.config.rerankerMode,
      rerankerModelName: this.config.rerankerModelName,
    });
    const server = new IpcServer(this.logger);
    server.setRequestHandler(async (request: DaemonRequest) => {
      return request.method === 'memory_load'
        ? await service.memoryLoad(request.params)
        : await service.memoryUpdate(request.params);
    });

    const endpoint = await server.start();
    this.runtime = { server };
    await this.manager.publishEndpoint(endpoint);
    this.manager.registerExitHooks();
    await this.logger.info('daemon.started', 'MemHub daemon started', {
      meta: { endpoint },
    });

    return endpoint;
  }

  async startBackground(
    cliEntryPath: string,
    timeoutMs = DEFAULT_DAEMON_START_TIMEOUT_MS
  ): Promise<StartBackgroundResult> {
    const current = await this.status();
    if (current.endpoint) {
      return { started: false, endpoint: current.endpoint };
    }

    await fs.mkdir(dirname(this.manager.getLockPath()), { recursive: true });

    const child = spawn(process.execPath, [cliEntryPath, 'daemon', 'run'], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        MEMHUB_STORAGE_PATH: this.config.storagePath,
      },
    });
    child.unref();

    const endpoint = await this.manager.waitForEndpoint(timeoutMs);
    if (!endpoint) {
      throw new Error('Timed out waiting for MemHub daemon to start');
    }

    return { started: true, endpoint };
  }

  async stop(): Promise<void> {
    const status = await this.status();
    if (!status.endpoint) {
      throw new DaemonNotRunningError();
    }

    process.kill(status.endpoint.pid, 'SIGTERM');
    const deadline = Date.now() + DAEMON_STOP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!isProcessAlive(status.endpoint.pid)) {
        await this.manager.cleanup();
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    throw new Error(`Timed out waiting for daemon pid ${status.endpoint.pid} to stop`);
  }

  async restart(cliEntryPath: string): Promise<StartBackgroundResult> {
    try {
      await this.stop();
    } catch (error) {
      if (!(error instanceof DaemonNotRunningError)) throw error;
    }
    return this.startBackground(cliEntryPath);
  }

  async closeForeground(): Promise<void> {
    if (!this.runtime) return;
    await this.runtime.server.stop();
    await this.manager.cleanup();
    this.runtime = null;
  }
}

export function getDaemonLogDir(): string {
  return process.env.MEMHUB_LOG_DIR ?? join(homedir(), '.memhub', 'logs');
}
