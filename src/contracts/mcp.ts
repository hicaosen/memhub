/**
 * MCP (Model Context Protocol) specific types and constants
 * Defines the protocol structures for stdio-based communication
 */

import type { Memory } from './types.js';

// ============================================================================
// MCP Protocol Version
// ============================================================================

/** Current MCP protocol version */
export const MCP_PROTOCOL_VERSION = '2024-11-05';

/** Server information */
export const SERVER_INFO = {
  name: 'memhub',
  version: '0.1.0',
} as const;

// ============================================================================
// MCP Request/Response Types
// ============================================================================

/** JSON-RPC request ID */
export type RequestId = string | number;

/** Base JSON-RPC request structure */
export interface JsonRpcRequest<T = unknown> {
  jsonrpc: '2.0';
  id?: RequestId;
  method: string;
  params?: T;
}

/** Base JSON-RPC response structure */
export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: RequestId | null;
  result?: T;
  error?: JsonRpcError;
}

/** JSON-RPC error structure */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** JSON-RPC notification (no response expected) */
export interface JsonRpcNotification<T = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: T;
}

// ============================================================================
// MCP Lifecycle Messages
// ============================================================================

/** Initialize request parameters */
export interface InitializeParams {
  protocolVersion: string;
  capabilities: ClientCapabilities;
  clientInfo: Implementation;
}

/** Initialize result */
export interface InitializeResult {
  protocolVersion: string;
  capabilities: ServerCapabilities;
  serverInfo: Implementation;
}

/** Implementation information */
export interface Implementation {
  name: string;
  version: string;
}

/** Client capabilities */
export interface ClientCapabilities {
  // Client can handle these features
  readonly experimental?: Record<string, unknown>;
  readonly roots?: { listChanged?: boolean };
  readonly sampling?: Record<string, unknown>;
}

/** Server capabilities */
export interface ServerCapabilities {
  // Server provides these features
  readonly experimental?: Record<string, unknown>;
  readonly logging?: Record<string, unknown>;
  readonly prompts?: { listChanged?: boolean };
  readonly resources?: { subscribe?: boolean; listChanged?: boolean };
  readonly tools?: { listChanged?: boolean };
}

// ============================================================================
// MCP Tool Definitions
// ============================================================================

/** Tool definition for tool/list */
export interface Tool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
}

/** Tool input schema (JSON Schema) */
export interface ToolInputSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/** Tool call request */
export interface ToolCallRequest {
  name: string;
  arguments?: Record<string, unknown>;
}

/** Tool call result */
export interface ToolCallResult {
  content: ToolContent[];
  isError?: boolean;
}

/** Tool content types */
export type ToolContent = TextContent | ImageContent;

/** Text content */
export interface TextContent {
  type: 'text';
  text: string;
}

/** Image content */
export interface ImageContent {
  type: 'image';
  data: string; // base64 encoded
  mimeType: string;
}

// ============================================================================
// MCP Tool List
// ============================================================================

/** All available tool names */
export const TOOL_NAMES = ['memory_load', 'memory_update'] as const;

/** Tool name type */
export type ToolName = (typeof TOOL_NAMES)[number];

/** Tool definitions for MCP server */
export const TOOL_DEFINITIONS: readonly Tool[] = [
  {
    name: 'memory_load',
    description:
      'STM first step. Call at the first turn after receiving user prompt to load short-term memory context for this session/task.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional memory id for direct fetch' },
        sessionId: {
          type: 'string',
          description: 'Optional session UUID to load current CLI/task context',
        },
        date: { type: 'string', description: 'Optional date filter (YYYY-MM-DD)' },
        query: { type: 'string', description: 'Optional text query for relevant context' },
        category: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number', description: 'Max results, default 20' },
        scope: {
          type: 'string',
          enum: ['stm', 'all'],
          description: 'stm for short-term context window; all for broader retrieval',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'memory_update',
    description:
      'STM write-back step. Call at the final turn to append/upsert new decisions, preferences, task-state changes, and key outputs.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional id. Present = update existing record' },
        sessionId: { type: 'string', description: 'Session UUID. Auto-created if omitted' },
        mode: { type: 'string', enum: ['append', 'upsert'], description: 'Default append' },
        entryType: {
          type: 'string',
          enum: ['decision', 'preference', 'knowledge', 'todo', 'state_change'],
        },
        title: { type: 'string', description: 'Optional title' },
        content: { type: 'string', description: 'Required memory body' },
        tags: { type: 'array', items: { type: 'string' } },
        category: { type: 'string' },
        importance: { type: 'number' },
      },
      required: ['content'],
      additionalProperties: false,
    },
  },
] as const;

// ============================================================================
// MCP Methods
// ============================================================================

/** All MCP method names */
export const MCP_METHODS = {
  // Lifecycle
  INITIALIZE: 'initialize',
  INITIALIZED: 'notifications/initialized',
  SHUTDOWN: 'shutdown',
  EXIT: 'exit',

  // Tools
  TOOLS_LIST: 'tools/list',
  TOOLS_CALL: 'tools/call',

  // Logging
  LOGGING_MESSAGE: 'notifications/message',

  // Progress
  PROGRESS: 'notifications/progress',
} as const;

// ============================================================================
// Error Codes (Standard MCP + Custom)
// ============================================================================

/** Standard JSON-RPC error codes */
export const JSONRPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/** MemHub custom error codes */
export const MEMHUB_ERROR_CODES = {
  NOT_FOUND: -32001,
  STORAGE_ERROR: -32002,
  VALIDATION_ERROR: -32003,
  DUPLICATE_ERROR: -32004,
} as const;

/** Combined error codes */
export const ERROR_CODES = {
  ...JSONRPC_ERROR_CODES,
  ...MEMHUB_ERROR_CODES,
} as const;

// ============================================================================
// Utility Types
// ============================================================================

/** Helper type to extract result type from a tool name */
export type ToolResult<T extends ToolName> = T extends 'memory_load'
  ? { items: Memory[]; total: number }
  : T extends 'memory_update'
    ? {
        id: string;
        sessionId: string;
        filePath: string;
        created: boolean;
        updated: boolean;
        memory: Memory;
      }
    : never;

/** Helper type to extract input type from a tool name */
export type ToolInput<T extends ToolName> = T extends 'memory_load'
  ? {
      id?: string;
      sessionId?: string;
      date?: string;
      query?: string;
      category?: string;
      tags?: string[];
      limit?: number;
      scope?: 'stm' | 'all';
    }
  : T extends 'memory_update'
    ? {
        id?: string;
        sessionId?: string;
        mode?: 'append' | 'upsert';
        entryType?: 'decision' | 'preference' | 'knowledge' | 'todo' | 'state_change';
        title?: string;
        content: string;
        tags?: string[];
        category?: string;
        importance?: number;
      }
    : never;
