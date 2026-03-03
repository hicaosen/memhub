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
      'MANDATORY STM step #1 (stability-first). Call memory_load as the FIRST tool call after each new user prompt, before analysis or planning. Goal: recover short-term memory for the current task so the next 1-3 turns stay coherent and do not repeat user input. Prefer { sessionId, scope:"stm", limit:20 }; add { date } for date-scoped tasks and { query } for keyword-driven tasks. If unavailable, continue the task and still provide a final answer.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional memory id for direct fetch' },
        sessionId: {
          type: 'string',
          description: 'Recommended. Stable session UUID for this task/thread. Reuse same value across memory_load/memory_update.',
        },
        date: { type: 'string', description: 'Optional date filter (YYYY-MM-DD)' },
        query: { type: 'string', description: 'Optional text query for relevant context' },
        category: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number', description: 'Max results, default 20' },
        scope: {
          type: 'string',
          enum: ['stm', 'all'],
          description: 'Use "stm" by default for current-task context expected to be reused in ~3 turns. Use "all" only when broad historical recall is required.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'memory_update',
    description:
      'MANDATORY STM step #2 (closed loop). Call memory_update as the FINAL tool call before your final user answer. Write only high-value short-term updates likely reused in the next 1-3 turns: decisions made, preference/constraint changes, task state transitions, and reusable conclusions. Keep content concise, factual, and task-bound. Never store secrets or credentials. If unavailable, still return the final user answer.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional id. Present = update existing record' },
        sessionId: { type: 'string', description: 'Recommended. Same session UUID used in memory_load. Auto-created if omitted.' },
        mode: { type: 'string', enum: ['append', 'upsert'], description: 'append = add new STM item (default). upsert = update existing item, usually with id.' },
        entryType: {
          type: 'string',
          enum: ['decision', 'preference', 'knowledge', 'todo', 'state_change'],
          description: 'Use the most specific type to improve next-turn retrieval quality: decision/preference/knowledge/todo/state_change.',
        },
        title: { type: 'string', description: 'Optional title' },
        content: { type: 'string', description: 'Required. Concise reusable summary (for next ~3 turns), not full transcript.' },
        tags: { type: 'array', items: { type: 'string' } },
        category: { type: 'string' },
        importance: { type: 'number', description: 'Optional priority score (1-5). Use higher values for likely near-term reuse.' },
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