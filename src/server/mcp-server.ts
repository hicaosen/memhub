#!/usr/bin/env node
/**
 * MCP Server - Model Context Protocol server implementation
 * Communicates via stdio
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  RequestId,
  InitializeParams,
  InitializeResult,
  ToolCallRequest,
  ToolCallResult,
  TextContent,
} from '../contracts/mcp.js';
import {
  MCP_PROTOCOL_VERSION,
  SERVER_INFO,
  TOOL_DEFINITIONS,
  MCP_METHODS,
  ERROR_CODES,
} from '../contracts/mcp.js';
import { ErrorCode } from '../contracts/types.js';
import { MemoryService, ServiceError } from '../services/memory-service.js';
import {
  MemoryLoadInputSchema,
  MemoryUpdateInputV2Schema,
} from '../contracts/schemas.js';

// Get package version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
interface PackageJson {
  version?: string;
}

// npm package runtime: dist/src/server -> package root
const packageJsonPath = join(__dirname, '../../../package.json');

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageJson;

/**
 * MCP Server implementation
 */
export class McpServer {
  private readonly memoryService: MemoryService;

  constructor() {
    const storagePath = process.env.MEMHUB_STORAGE_PATH || './memories';
    this.memoryService = new MemoryService({ storagePath });
  }

  /**
   * Starts the MCP server and begins listening for requests on stdin
   */
  start(): void {
    this.log('info', 'MemHub MCP Server starting...');

    process.stdin.setEncoding('utf-8');

    let buffer = '';

    process.stdin.on('data', (chunk: string) => {
      buffer += chunk;

      // Process complete lines (JSON-RPC messages)
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          void this.handleMessage(line.trim());
        }
      }
    });

    process.stdin.on('end', () => {
      this.log('info', 'Stdin closed, shutting down...');
      process.exit(0);
    });

    process.on('SIGINT', () => {
      this.log('info', 'Received SIGINT, shutting down...');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      this.log('info', 'Received SIGTERM, shutting down...');
      process.exit(0);
    });
  }

  /**
   * Handles an incoming JSON-RPC message
   *
   * @param message - The JSON-RPC message string
   */
  private async handleMessage(message: string): Promise<void> {
    let request: JsonRpcRequest | null = null;

    try {
      request = JSON.parse(message) as JsonRpcRequest;
    } catch {
      this.sendError(null, ERROR_CODES.PARSE_ERROR, 'Parse error: Invalid JSON');
      return;
    }

    // Validate JSON-RPC request
    if (request.jsonrpc !== '2.0' || !request.method) {
      this.sendError(
        request.id ?? null,
        ERROR_CODES.INVALID_REQUEST,
        'Invalid Request'
      );
      return;
    }

    try {
      const result = await this.handleMethod(request.method, request.params);

      // Send response (only for requests with id, not notifications)
      if (request.id !== undefined) {
        this.sendResponse(request.id, result);
      }
    } catch (error) {
      this.handleError(request.id ?? null, error);
    }
  }

  /**
   * Handles a specific method call
   *
   * @param method - The method name
   * @param params - The method parameters
   * @returns The method result
   */
  private async handleMethod(
    method: string,
    params: unknown
  ): Promise<unknown> {
    switch (method) {
      case MCP_METHODS.INITIALIZE:
        return this.handleInitialize(params as InitializeParams);

      case MCP_METHODS.INITIALIZED:
        // Notification, no response needed
        this.log('info', 'Client initialized');
        return null;

      case MCP_METHODS.SHUTDOWN:
        return null;

      case MCP_METHODS.EXIT:
        process.exit(0);
        return null;

      case MCP_METHODS.TOOLS_LIST:
        return { tools: TOOL_DEFINITIONS };

      case MCP_METHODS.TOOLS_CALL:
        return this.handleToolCall(params as ToolCallRequest);

      default:
        throw new ServiceError(
          `Method not found: ${method}`,
          ErrorCode.METHOD_NOT_FOUND
        );
    }
  }

  /**
   * Handles the initialize method
   *
   * @param params - Initialize parameters
   * @returns Initialize result
   */
  private handleInitialize(params: InitializeParams): InitializeResult {
    this.log('info', `Client initializing: ${params.clientInfo.name} v${params.clientInfo.version}`);

    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
        logging: {},
      },
      serverInfo: {
        name: SERVER_INFO.name,
        version: packageJson.version || SERVER_INFO.version,
      },
    };
  }

  /**
   * Handles tool calls
   *
   * @param request - Tool call request
   * @returns Tool call result
   */
  private async handleToolCall(request: ToolCallRequest): Promise<ToolCallResult> {
    const { name, arguments: args } = request;

    try {
      let result: unknown;

      switch (name) {
        case 'memory_load': {
          const input = MemoryLoadInputSchema.parse(args ?? {});
          result = await this.memoryService.memoryLoad(input);
          break;
        }

        case 'memory_update': {
          const input = MemoryUpdateInputV2Schema.parse(args ?? {});
          result = await this.memoryService.memoryUpdate(input);
          break;
        }

        default:
          throw new ServiceError(
            `Unknown tool: ${name}`,
            ErrorCode.METHOD_NOT_FOUND
          );
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          } as TextContent,
        ],
      };
    } catch (error) {
      if (error instanceof ServiceError) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: error.message }, null, 2),
            } as TextContent,
          ],
          isError: true,
        };
      }

      // Re-throw for generic error handling
      throw error;
    }
  }

  /**
   * Handles errors and sends appropriate error response
   *
   * @param id - Request ID
   * @param error - The error that occurred
   */
  private handleError(id: RequestId | null, error: unknown): void {
    if (error instanceof ServiceError) {
      this.sendError(id, error.code, error.message, error.data);
    } else if (error instanceof Error && error.name === 'ZodError') {
      this.sendError(
        id,
        ERROR_CODES.INVALID_PARAMS,
        `Invalid parameters: ${error.message}`
      );
    } else {
      this.sendError(
        id,
        ERROR_CODES.INTERNAL_ERROR,
        `Internal error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Sends a JSON-RPC response
   *
   * @param id - Request ID
   * @param result - Response result
   */
  private sendResponse(id: RequestId, result: unknown): void {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      result,
    };
    this.sendMessage(response);
  }

  /**
   * Sends a JSON-RPC error
   *
   * @param id - Request ID
   * @param code - Error code
   * @param message - Error message
   * @param data - Additional error data
   */
  private sendError(
    id: RequestId | null,
    code: number,
    message: string,
    data?: Record<string, unknown>
  ): void {
    const error: JsonRpcError = {
      code,
      message,
      data,
    };

    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: id ?? null,
      error,
    };

    this.sendMessage(response);
  }

  /**
   * Sends a message to stdout
   *
   * @param message - The message to send
   */
  private sendMessage(message: JsonRpcResponse | JsonRpcRequest): void {
    const json = JSON.stringify(message);
    process.stdout.write(json + '\n');
  }

  /**
   * Logs a message
   *
   * @param level - Log level
   * @param message - Log message
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const logLevel = process.env.MEMHUB_LOG_LEVEL || 'info';
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };

    if (levels[level] >= levels[logLevel as keyof typeof levels]) {
      console.error(`[${level.toUpperCase()}] ${message}`);
    }
  }
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new McpServer();
  server.start();
}
