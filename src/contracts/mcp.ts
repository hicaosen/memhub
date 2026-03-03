/**
 * MCP (Model Context Protocol) specific types and constants
 * Tool definitions and business-level types (protocol types provided by SDK)
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
// MCP Tool Definitions (kept for SDK use)
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
// Error Codes (MemHub Custom)
// ============================================================================

/** MemHub custom error codes */
export const MEMHUB_ERROR_CODES = {
  NOT_FOUND: -32001,
  STORAGE_ERROR: -32002,
  VALIDATION_ERROR: -32003,
  DUPLICATE_ERROR: -32004,
} as const;

/** Combined error codes (includes JSON-RPC standard codes) */
export const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
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