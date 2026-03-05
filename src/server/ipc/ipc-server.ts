import { createServer, Socket } from 'net';
import type { Logger } from '../../utils/logger.js';
import type { DaemonEndpoint, DaemonRequest, DaemonResponse } from './types.js';
import { PROTOCOL_VERSION, LOOPBACK_HOST } from './types.js';
import { parseJson } from './ipc-client.js';

/** Handler for daemon requests */
export type RequestHandler = (
  request: DaemonRequest
) => Promise<DaemonResponse['result'] | undefined>;

/**
 * IPC Server for daemon mode
 */
export class IpcServer {
  private readonly logger: Logger;
  private server: ReturnType<typeof createServer> | null = null;
  private requestHandler: RequestHandler | null = null;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Sets the request handler
   */
  setRequestHandler(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  /**
   * Starts the IPC server
   */
  async start(): Promise<DaemonEndpoint> {
    const server = createServer((socket: Socket) => {
      let buffer = '';

      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        buffer += chunk;

        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (!line) continue;

          void this.handleSocketRequest(socket, line);
          newlineIndex = buffer.indexOf('\n');
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

  /**
   * Stops the IPC server
   */
  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>(resolve => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
  }

  /**
   * Handles incoming socket requests
   */
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

    if (!this.requestHandler) {
      const response: DaemonResponse = {
        id: request.id,
        ok: false,
        error: 'No request handler configured',
      };
      socket.write(`${JSON.stringify(response)}\n`);
      return;
    }

    try {
      const result = await this.requestHandler(request);
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
}
