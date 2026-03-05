import { Socket } from 'net';
import type { MemoryLoadOutput, MemoryUpdateOutput } from '../../contracts/types.js';
import type { Logger } from '../../utils/logger.js';
import type {
  DaemonEndpoint,
  DaemonRequest,
  DaemonResponse,
  SendRequestOptions,
  RetryRequestOptions,
} from './types.js';

/**
 * Checks if an error is retriable for IPC operations
 */
export function isRetriableIpcError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code && ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(code)) {
    return true;
  }

  return (
    error.message.includes('Daemon request timeout') ||
    error.message.includes('Daemon connect timeout') ||
    error.message.includes('socket hang up')
  );
}

/**
 * Sleep utility
 */
export async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse JSON safely
 */
export function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

/**
 * IPC Client for daemon communication
 */
export class IpcClient {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Sends a request with retry logic
   */
  async sendRequestWithRetry(
    request: DaemonRequest,
    options: RetryRequestOptions,
    getEndpoint: () => Promise<DaemonEndpoint>
  ): Promise<MemoryLoadOutput | MemoryUpdateOutput> {
    const endpoint = options.endpoint ?? (await getEndpoint());
    let lastError: unknown;

    for (let attempt = 0; attempt <= options.retryDelaysMs.length; attempt += 1) {
      try {
        return await this.sendRequest(request, {
          endpoint,
          connectTimeoutMs: options.connectTimeoutMs,
          responseTimeoutMs: options.responseTimeoutMs,
        });
      } catch (error) {
        lastError = error;
        if (!isRetriableIpcError(error) || attempt === options.retryDelaysMs.length) {
          throw error;
        }
        await this.logger.warn('ipc.request.retry', 'Retrying daemon request on same endpoint', {
          requestId: request.id,
          meta: {
            method: request.method,
            attempt: attempt + 1,
            delayMs: options.retryDelaysMs[attempt],
            endpoint,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        });
        await sleep(options.retryDelaysMs[attempt] ?? 0);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Unknown daemon request error');
  }

  /**
   * Sends a single request to the daemon
   */
  async sendRequest(
    request: DaemonRequest,
    options: SendRequestOptions
  ): Promise<MemoryLoadOutput | MemoryUpdateOutput> {
    const endpoint = options.endpoint!;

    return new Promise((resolve, reject) => {
      const socket = new Socket();
      let buffer = '';
      let settled = false;
      // eslint-disable-next-line prefer-const
      let connectTimeout: NodeJS.Timeout | undefined;
      // eslint-disable-next-line prefer-const
      let responseTimeout: NodeJS.Timeout | undefined;

      const settleError = (error: Error): void => {
        if (settled) return;
        settled = true;
        if (connectTimeout) clearTimeout(connectTimeout);
        if (responseTimeout) clearTimeout(responseTimeout);
        reject(error);
      };

      const settleSuccess = (result: MemoryLoadOutput | MemoryUpdateOutput): void => {
        if (settled) return;
        settled = true;
        if (connectTimeout) clearTimeout(connectTimeout);
        if (responseTimeout) clearTimeout(responseTimeout);
        resolve(result);
      };

      connectTimeout = setTimeout(() => {
        const error = new Error('Daemon connect timeout');
        (error as NodeJS.ErrnoException).code = 'ETIMEDOUT';
        socket.destroy();
        settleError(error);
      }, options.connectTimeoutMs);

      socket.setEncoding('utf8');

      socket.on('error', error => {
        void this.logger.error('ipc.request.fail', 'Daemon request socket error', {
          requestId: request.id,
          meta: { error: error.message },
        });
        settleError(error);
      });

      socket.on('data', (chunk: string) => {
        buffer += chunk;
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex === -1) return;

        const line = buffer.slice(0, newlineIndex).trim();
        socket.end();

        if (!line) {
          settleError(new Error('Daemon returned empty response'));
          return;
        }

        let response: DaemonResponse;
        try {
          response = parseJson<DaemonResponse>(line);
        } catch {
          settleError(new Error('Daemon returned invalid JSON response'));
          return;
        }

        if (!response.ok) {
          settleError(new Error(response.error ?? 'Daemon request failed'));
          return;
        }

        if (!response.result) {
          settleError(new Error('Daemon response missing result'));
          return;
        }

        settleSuccess(response.result);
      });

      socket.connect(endpoint.port, endpoint.host, () => {
        if (connectTimeout) clearTimeout(connectTimeout);
        responseTimeout = setTimeout(() => {
          const error = new Error('Daemon request timeout');
          (error as NodeJS.ErrnoException).code = 'ETIMEDOUT';
          socket.destroy();
          settleError(error);
        }, options.responseTimeoutMs);
        void this.logger.info('ipc.request', 'Sending daemon request', {
          requestId: request.id,
          meta: { method: request.method, endpoint },
        });
        socket.write(`${JSON.stringify(request)}\n`);
      });
    });
  }
}
