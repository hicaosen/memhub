/**
 * Core type definitions for MemHub
 *
 * Business types are inferred from Zod schemas in schemas.ts using z.infer.
 * This file re-exports them for backward compatibility and keeps utility types,
 * simple type aliases, and types that don't need runtime validation.
 *
 * Pattern: Define schema in schemas.ts → Export inferred type here
 */

// ============================================================================
// Re-export types inferred from Zod schemas
// ============================================================================

export type {
  // Enum types
  MemoryEntryType,
  TTLLevel,
  SortField,
  SortOrder,
  RetrievalIntent,
  // Memory types
  Memory,
  MemoryFrontMatter,
  MemoryFile,
  // Result types
  SearchResult,
  ListResult,
  CreateResult,
  UpdateResult,
  DeleteResult,
  // Filter and query types
  MemoryFilter,
  PaginationOptions,
  SortOptions,
  // MCP tool input types
  CreateMemoryInput,
  ReadMemoryInput,
  UpdateMemoryInput,
  DeleteMemoryInput,
  ListMemoryInput,
  SearchMemoryInput,
  MemoryLoadInput,
  MemoryUpdateInput,
  // MCP tool output types
  CreateMemoryOutput,
  ReadMemoryOutput,
  UpdateMemoryOutput,
  MemoryLoadOutput,
  MemoryUpdateOutput,
  DeleteMemoryOutput,
  ListMemoryOutput,
  SearchMemoryOutput,
  // Configuration type
  Config,
} from './schemas.js';

// ============================================================================
// Identity Types (simple string aliases - no runtime validation needed)
// ============================================================================

/** UUID v4 string format */
export type UUID = string;

/** ISO 8601 timestamp string */
export type ISO8601Timestamp = string;

/** URL-friendly slug string */
export type Slug = string;

// ============================================================================
// Error Types
// ============================================================================

/**
 * MemHub custom error codes (MCP standard + custom)
 */
export enum ErrorCode {
  // Standard MCP error codes
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,

  // MemHub custom error codes
  NOT_FOUND = -32001,
  STORAGE_ERROR = -32002,
  VALIDATION_ERROR = -32003,
  DUPLICATE_ERROR = -32004,
}

/**
 * Alias for backward compatibility
 * @deprecated Use ErrorCode.METHOD_NOT_FOUND instead
 */
export const MethodNotFoundError = ErrorCode.METHOD_NOT_FOUND;

/**
 * Error data structure for additional context
 */
export interface ErrorData {
  readonly details?: unknown;
  readonly field?: string;
  readonly suggestion?: string;
}

/**
 * MCP Error structure
 */
export interface McpError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly data?: ErrorData;
}

// ============================================================================
// Utility Types
// ============================================================================

/** Deep readonly version of a type */
export type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};

/** Nullable type */
export type Nullable<T> = T | null;

/** Optional fields made required */
export type RequiredFields<T, K extends keyof T> = Required<Pick<T, K>> & Omit<T, K>;

// ============================================================================
// WAL Types (no runtime validation needed)
// ============================================================================

/**
 * WAL entry representing a single write operation
 */
export interface WALEntry {
  /** Sequential offset in the WAL file */
  readonly offset: number;
  /** Operation type */
  readonly operation: 'create' | 'update' | 'delete';
  /** Memory ID being operated on */
  readonly memoryId: UUID;
  /** Timestamp of the operation */
  readonly timestamp: ISO8601Timestamp;
  /** Serialized memory data (for create/update) */
  readonly data?: string;
  /** Whether this entry has been indexed */
  indexed: boolean;
}

/**
 * WAL configuration
 */
export interface WALConfig {
  /** Path to the WAL file */
  readonly walPath: string;
}
