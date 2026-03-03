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
    description: `Retrieve stored memories to recall user preferences, past decisions, project context, and learned knowledge.

WHEN TO USE (call proactively):
• Starting a new conversation or task
• User references past discussions ("remember when...", "as I mentioned before")
• Need context about user's coding style, preferences, or project decisions
• Uncertain about user's existing preferences or constraints
• Before making assumptions about user requirements

WHAT IT PROVIDES:
• User preferences (coding style, frameworks, naming conventions)
• Past decisions and their rationale
• Project-specific context and constraints
• Previously learned knowledge about the user

Call this early to provide personalized, context-aware responses.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search query to find relevant memories. Examples: "react preferences", "error handling approach", "database choice"',
        },
        id: {
          type: 'string',
          description: 'Direct lookup by memory ID (if known)',
        },
        category: {
          type: 'string',
          description:
            'Filter by category: "general" (default), "preference", "decision", "knowledge", "project"',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags. Example: ["typescript", "backend"]',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20, max: 100)',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'memory_update',
    description: `Store important information to remember for future conversations.

WHEN TO USE (call when learning something worth remembering):
• User explicitly states a preference ("I prefer functional components")
• User makes a decision with rationale ("We'll use PostgreSQL because...")
• You discover important project context (tech stack, constraints, patterns)
• User corrects your assumption ("Actually, I don't use Redux")
• Task state changes that should persist

WHAT TO STORE:
• Preferences: coding style, frameworks, naming conventions
• Decisions: architecture choices, library selections, with reasoning
• Knowledge: project-specific patterns, gotchas, conventions
• Context: team structure, deployment process, testing approach

TIPS:
• content is required and most important
• title helps with search (auto-generated if omitted)
• Use entryType to categorize: "preference", "decision", "context", "fact"
• importance: 1-5 (default: 3), higher = more critical to remember`,
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description:
            'The information to remember. Be specific and include context. Example: "User prefers TypeScript with strict mode. Uses functional React components with hooks. Avoids class components."',
        },
        title: {
          type: 'string',
          description:
            'Brief title for the memory (auto-generated from content if omitted). Example: "TypeScript and React preferences"',
        },
        entryType: {
          type: 'string',
          enum: ['preference', 'decision', 'context', 'fact'],
          description:
            'Type of memory. "preference" for user likes/dislikes, "decision" for choices made, "context" for project info, "fact" for learned facts',
        },
        category: {
          type: 'string',
          description:
            'Category for grouping. Default: "general". Example: "frontend", "backend", "project-alpha"',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for filtering. Example: ["typescript", "react", "coding-style"]',
        },
        importance: {
          type: 'number',
          description: 'Importance level 1-5. 5 = critical, always recall. Default: 3',
        },
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
      query?: string;
      category?: string;
      tags?: string[];
      limit?: number;
    }
  : T extends 'memory_update'
    ? {
        id?: string;
        sessionId?: string;
        mode?: 'append' | 'upsert';
        entryType?: 'preference' | 'decision' | 'context' | 'fact';
        title?: string;
        content: string;
        tags?: string[];
        category?: string;
        importance?: number;
      }
    : never;