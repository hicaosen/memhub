import { randomUUID } from 'crypto';
import type {
  MemoryLoadInput,
  MemoryLoadOutput,
  MemoryUpdateInput,
  MemoryUpdateOutput,
} from '../contracts/types.js';
import type { RerankerMode } from '../services/retrieval/reranker.js';
import { createLogger, type Logger } from '../utils/logger.js';
import { DaemonController } from './daemon.js';
import {
  IpcClient,
  LOAD_CONNECT_TIMEOUT_MS,
  LOAD_RESPONSE_TIMEOUT_MS,
  UPDATE_CONNECT_TIMEOUT_MS,
  UPDATE_RESPONSE_TIMEOUT_MS,
  IPC_RETRY_DELAYS_MS,
} from './ipc/index.js';
import type { DaemonEndpoint, DaemonRequest } from './ipc/index.js';
import type { MemoryBackend } from './memory-backend.js';

export interface DaemonClientBackendConfig {
  readonly storagePath: string;
  readonly vectorSearch?: boolean;
  readonly rerankerMode?: RerankerMode;
  readonly rerankerModelName?: string;
  readonly autoStart?: boolean;
  readonly cliEntryPath: string;
}

/**
 * Thin MCP backend. It never becomes the daemon; it only discovers or starts the
 * explicit daemon process and forwards tool calls over IPC.
 */
export class DaemonClientBackend implements MemoryBackend {
  private readonly logger: Logger;
  private readonly controller: DaemonController;
  private readonly ipcClient: IpcClient;
  private readonly autoStart: boolean;
  private endpoint: DaemonEndpoint | null = null;

  constructor(private readonly config: DaemonClientBackendConfig) {
    this.logger = createLogger({ role: 'client' });
    this.controller = new DaemonController({
      storagePath: config.storagePath,
      vectorSearch: config.vectorSearch,
      rerankerMode: config.rerankerMode,
      rerankerModelName: config.rerankerModelName,
      logger: this.logger,
    });
    this.ipcClient = new IpcClient(this.logger);
    this.autoStart = config.autoStart ?? true;
  }

  async initialize(): Promise<void> {
    if (this.endpoint) return;
    this.endpoint = await this.resolveEndpoint();
    await this.logger.info('backend.initialize', 'Connected to MemHub daemon', {
      meta: { endpoint: this.endpoint },
    });
  }

  async memoryLoad(input: MemoryLoadInput): Promise<MemoryLoadOutput> {
    await this.initialize();
    const result = await this.sendRequestWithDaemonRecovery(
      {
        id: randomUUID(),
        method: 'memory_load',
        params: input,
      },
      {
        connectTimeoutMs: LOAD_CONNECT_TIMEOUT_MS,
        responseTimeoutMs: LOAD_RESPONSE_TIMEOUT_MS,
      }
    );
    return result as MemoryLoadOutput;
  }

  async memoryUpdate(input: MemoryUpdateInput): Promise<MemoryUpdateOutput> {
    await this.initialize();
    const requestId = randomUUID();
    const result = await this.sendRequestWithDaemonRecovery(
      {
        id: requestId,
        method: 'memory_update',
        params: {
          ...input,
          idempotencyKey: input.idempotencyKey ?? requestId,
        },
      },
      {
        connectTimeoutMs: UPDATE_CONNECT_TIMEOUT_MS,
        responseTimeoutMs: UPDATE_RESPONSE_TIMEOUT_MS,
      }
    );
    return result as MemoryUpdateOutput;
  }

  close(): Promise<void> {
    this.endpoint = null;
    return Promise.resolve();
  }

  _getEndpointForTest(): DaemonEndpoint | null {
    return this.endpoint;
  }

  private async sendRequestWithDaemonRecovery(
    request: DaemonRequest,
    options: {
      readonly connectTimeoutMs: number;
      readonly responseTimeoutMs: number;
    }
  ): Promise<MemoryLoadOutput | MemoryUpdateOutput> {
    try {
      return await this.ipcClient.sendRequestWithRetry(
        request,
        {
          endpoint: this.endpoint ?? undefined,
          connectTimeoutMs: options.connectTimeoutMs,
          responseTimeoutMs: options.responseTimeoutMs,
          retryDelaysMs: IPC_RETRY_DELAYS_MS,
        },
        () => this.resolveEndpoint()
      );
    } catch (error) {
      await this.logger.warn('daemon.reconnect', 'Daemon request failed, rediscovering daemon', {
        requestId: request.id,
        meta: { error: error instanceof Error ? error.message : 'Unknown error' },
      });
      this.endpoint = null;
      this.endpoint = await this.resolveEndpoint();
      return this.ipcClient.sendRequestWithRetry(
        request,
        {
          endpoint: this.endpoint,
          connectTimeoutMs: options.connectTimeoutMs,
          responseTimeoutMs: options.responseTimeoutMs,
          retryDelaysMs: IPC_RETRY_DELAYS_MS,
        },
        () => this.resolveEndpoint()
      );
    }
  }

  private async resolveEndpoint(): Promise<DaemonEndpoint> {
    const status = await this.controller.status();
    if (status.endpoint) return status.endpoint;

    if (!this.autoStart) {
      throw new Error('MemHub daemon is not running. Start it with `memhub daemon`.');
    }

    const result = await this.controller.startBackground(this.config.cliEntryPath);
    return result.endpoint;
  }
}
