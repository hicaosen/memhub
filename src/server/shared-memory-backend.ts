import { promises as fs } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import type {
  MemoryLoadInput,
  MemoryLoadOutput,
  MemoryUpdateInput,
  MemoryUpdateOutput,
} from '../contracts/types.js';
import { MemoryService } from '../services/memory-service.js';
import type { RerankerMode } from '../services/retrieval/reranker.js';
import { createLogger, type Logger } from '../utils/logger.js';
import {
  IpcClient,
  IpcServer,
  DaemonManager,
  LOAD_CONNECT_TIMEOUT_MS,
  LOAD_RESPONSE_TIMEOUT_MS,
  UPDATE_CONNECT_TIMEOUT_MS,
  UPDATE_RESPONSE_TIMEOUT_MS,
  IPC_RETRY_DELAYS_MS,
} from './ipc/index.js';
import type { BackendRole, DaemonEndpoint, DaemonRequest } from './ipc/index.js';

export interface SharedMemoryBackendConfig {
  readonly storagePath: string;
  readonly vectorSearch?: boolean;
  readonly rerankerMode?: RerankerMode;
  readonly rerankerModelName?: string;
}

export interface MemoryBackend {
  initialize(): Promise<void>;
  memoryLoad(input: MemoryLoadInput): Promise<MemoryLoadOutput>;
  memoryUpdate(input: MemoryUpdateInput): Promise<MemoryUpdateOutput>;
  close(): Promise<void>;
}

export class SharedMemoryBackend implements MemoryBackend {
  private readonly localService: MemoryService;
  private readonly logger: Logger;
  private readonly daemonManager: DaemonManager;
  private readonly ipcClient: IpcClient;
  private readonly ipcServer: IpcServer;

  private role: BackendRole | null = null;
  private endpoint: DaemonEndpoint | null = null;

  constructor(config: SharedMemoryBackendConfig) {
    this.localService = new MemoryService({
      storagePath: config.storagePath,
      vectorSearch: config.vectorSearch,
      rerankerMode: config.rerankerMode,
      rerankerModelName: config.rerankerModelName,
    });
    this.logger = createLogger({ role: 'client' });

    this.daemonManager = new DaemonManager(config.storagePath, this.logger);
    this.ipcClient = new IpcClient(this.logger);
    this.ipcServer = new IpcServer(this.logger);

    // Set up request handler for the server
    this.ipcServer.setRequestHandler(async (request: DaemonRequest) => {
      return request.method === 'memory_load'
        ? await this.localService.memoryLoad(request.params)
        : await this.localService.memoryUpdate(request.params);
    });
  }

  async initialize(): Promise<void> {
    if (this.role) return;
    await fs.mkdir(dirname(this.daemonManager.getLockPath()), { recursive: true });
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
        hasIntents: !!input.intents,
        hasRewrites: !!input.rewrittenQueries,
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
      const result = await this.sendRequestWithRetry(
        {
          id: randomUUID(),
          method: 'memory_load',
          params: input,
        },
        {
          connectTimeoutMs: LOAD_CONNECT_TIMEOUT_MS,
          responseTimeoutMs: LOAD_RESPONSE_TIMEOUT_MS,
          retryDelaysMs: IPC_RETRY_DELAYS_MS,
        }
      );
      await this.logger.info('memory_load.success', 'memory_load served via daemon IPC', {
        requestId,
        durationMs: Date.now() - start,
        meta: { items: (result as MemoryLoadOutput).total },
      });
      return result as MemoryLoadOutput;
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
      const result = await this.sendRequestWithRetry(
        {
          id: randomUUID(),
          method: 'memory_load',
          params: input,
        },
        {
          connectTimeoutMs: LOAD_CONNECT_TIMEOUT_MS,
          responseTimeoutMs: LOAD_RESPONSE_TIMEOUT_MS,
          retryDelaysMs: IPC_RETRY_DELAYS_MS,
        }
      );
      await this.logger.info(
        'memory_load.success',
        'memory_load served via daemon IPC after failover',
        {
          requestId,
          durationMs: Date.now() - start,
          meta: { items: (result as MemoryLoadOutput).total },
        }
      );
      return result as MemoryLoadOutput;
    }
  }

  async memoryUpdate(input: MemoryUpdateInput): Promise<MemoryUpdateOutput> {
    await this.initialize();
    const requestId = randomUUID();
    const inputWithIdempotencyKey: MemoryUpdateInput = {
      ...input,
      idempotencyKey: input.idempotencyKey ?? requestId,
    };
    const start = Date.now();
    await this.logger.info('memory_update.start', 'memory_update request started', {
      requestId,
      sessionId: inputWithIdempotencyKey.sessionId,
      meta: {
        hasId: !!inputWithIdempotencyKey.id,
        entryType: inputWithIdempotencyKey.entryType,
        hasIdempotencyKey: !!inputWithIdempotencyKey.idempotencyKey,
      },
    });

    if (this.role === 'daemon') {
      try {
        const result = await this.localService.memoryUpdate(inputWithIdempotencyKey);
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
          sessionId: inputWithIdempotencyKey.sessionId,
          durationMs: Date.now() - start,
          meta: { error: error instanceof Error ? error.message : 'Unknown error' },
        });
        throw error;
      }
    }

    try {
      const result = await this.sendRequestWithRetry(
        {
          id: randomUUID(),
          method: 'memory_update',
          params: inputWithIdempotencyKey,
        },
        {
          connectTimeoutMs: UPDATE_CONNECT_TIMEOUT_MS,
          responseTimeoutMs: UPDATE_RESPONSE_TIMEOUT_MS,
          retryDelaysMs: IPC_RETRY_DELAYS_MS,
        }
      );
      await this.logger.info('memory_update.success', 'memory_update served via daemon IPC', {
        requestId,
        sessionId: (result as MemoryUpdateOutput).sessionId,
        durationMs: Date.now() - start,
        meta: {
          id: (result as MemoryUpdateOutput).id,
          created: (result as MemoryUpdateOutput).created,
          updated: (result as MemoryUpdateOutput).updated,
        },
      });
      return result as MemoryUpdateOutput;
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
        const result = await this.localService.memoryUpdate(inputWithIdempotencyKey);
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
      const result = await this.sendRequestWithRetry(
        {
          id: randomUUID(),
          method: 'memory_update',
          params: inputWithIdempotencyKey,
        },
        {
          connectTimeoutMs: UPDATE_CONNECT_TIMEOUT_MS,
          responseTimeoutMs: UPDATE_RESPONSE_TIMEOUT_MS,
          retryDelaysMs: IPC_RETRY_DELAYS_MS,
        }
      );
      await this.logger.info(
        'memory_update.success',
        'memory_update served via daemon IPC after failover',
        {
          requestId,
          sessionId: (result as MemoryUpdateOutput).sessionId,
          durationMs: Date.now() - start,
          meta: {
            id: (result as MemoryUpdateOutput).id,
            created: (result as MemoryUpdateOutput).created,
            updated: (result as MemoryUpdateOutput).updated,
          },
        }
      );
      return result as MemoryUpdateOutput;
    }
  }

  async close(): Promise<void> {
    await this.ipcServer.stop();

    if (this.role === 'daemon') {
      await this.daemonManager.cleanup();
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
    const result = await this.daemonManager.tryBecomeDaemon();

    if (result.becameDaemon) {
      // Start the IPC server
      const endpoint = await this.ipcServer.start();
      this.endpoint = endpoint;
      await this.daemonManager.publishEndpoint(endpoint);
      this.daemonManager.registerExitHooks();

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

  private async waitForEndpoint(): Promise<DaemonEndpoint> {
    const endpoint = await this.daemonManager.waitForEndpoint();
    if (endpoint) return endpoint;

    // Try to become daemon if no endpoint found
    const result = await this.daemonManager.tryBecomeDaemon();
    if (result.becameDaemon) {
      const serverEndpoint = await this.ipcServer.start();
      await this.daemonManager.publishEndpoint(serverEndpoint);
      this.daemonManager.registerExitHooks();
      this.role = 'daemon';
      return serverEndpoint;
    }

    throw new Error('Failed to discover running daemon endpoint');
  }

  private async sendRequestWithRetry(
    request: DaemonRequest,
    options: {
      connectTimeoutMs: number;
      responseTimeoutMs: number;
      retryDelaysMs: readonly number[];
    }
  ): Promise<MemoryLoadOutput | MemoryUpdateOutput> {
    const endpoint = this.endpoint ?? (await this.waitForEndpoint());
    return this.ipcClient.sendRequestWithRetry(request, { ...options, endpoint }, () =>
      this.waitForEndpoint()
    );
  }

  private async recoverFromDaemonFailure(): Promise<void> {
    this.endpoint = null;
    await this.logger.warn('daemon.failover', 'Attempting daemon failover recovery');

    const result = await this.daemonManager.tryBecomeDaemon();
    if (result.becameDaemon) {
      const endpoint = await this.ipcServer.start();
      await this.daemonManager.publishEndpoint(endpoint);
      this.daemonManager.registerExitHooks();

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
}
