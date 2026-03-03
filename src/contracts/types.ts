/**
 * Core type definitions for MemHub
 * These types represent the data models used throughout the application
 */

// ============================================================================
// Identity Types
// ============================================================================

/** UUID v4 string format */
export type UUID = string;

/** ISO 8601 timestamp string */
export type ISO8601Timestamp = string;

/** URL-friendly slug string */
export type Slug = string;

// ============================================================================
// Memory Types
// ============================================================================

/**
 * Represents a memory entry stored in Markdown format
 * Content is split between YAML Front Matter (metadata) and Markdown body
 */
export type MemoryEntryType =
  | 'preference'  // User likes/dislikes
  | 'decision'    // Technical choices with reasoning
  | 'context'     // Project/environment information
  | 'fact';       // Objective knowledge

export interface Memory {
  /** UUID v4 unique identifier */
  readonly id: UUID;

  // Metadata (stored in YAML Front Matter)
  /** Creation timestamp in ISO 8601 format */
  readonly createdAt: ISO8601Timestamp;
  /** Last update timestamp in ISO 8601 format */
  updatedAt: ISO8601Timestamp;
  /** Session UUID for concurrent CLI isolation */
  sessionId?: UUID;
  /** Memory entry type */
  entryType?: MemoryEntryType;
  /** Tags for categorization and search */
  tags: readonly string[];
  /** Category for organization */
  category: string;
  /** Importance level from 1 (low) to 5 (high) */
  importance: number;

  // Content (stored in Markdown body)
  /** Title as H1 heading in Markdown */
  title: string;
  /** Markdown formatted content */
  content: string;
}

/**
 * Raw memory data as stored in YAML Front Matter + Markdown
 * Used for serialization/deserialization
 */
export interface MemoryFrontMatter {
  id: UUID;
  created_at: ISO8601Timestamp;
  updated_at: ISO8601Timestamp;
  session_id?: UUID;
  entry_type?: MemoryEntryType;
  tags: readonly string[];
  category: string;
  importance: number;
}

/**
 * Complete file content representation
 */
export interface MemoryFile {
  /** Relative path from storage root */
  readonly path: string;
  /** Filename with extension */
  readonly filename: string;
  /** Raw file content */
  readonly content: string;
  /** Last modification timestamp */
  readonly modifiedAt: ISO8601Timestamp;
}

// ============================================================================
// Operation Result Types
// ============================================================================

/**
 * Result of a search operation
 */
export interface SearchResult {
  /** The matched memory */
  readonly memory: Memory;
  /** Relevance score between 0 and 1 */
  readonly score: number;
  /** Matching text snippets with context */
  readonly matches: readonly string[];
}

/**
 * Result of a list/query operation with pagination
 */
export interface ListResult {
  /** Memory entries for current page */
  readonly memories: readonly Memory[];
  /** Total count without pagination */
  readonly total: number;
  /** Whether more results exist */
  readonly hasMore: boolean;
}

/**
 * Result of create operation
 */
export interface CreateResult {
  /** ID of created memory */
  readonly id: UUID;
  /** Path to stored file */
  readonly filePath: string;
  /** Complete memory object */
  readonly memory: Memory;
}

/**
 * Result of update operation
 */
export interface UpdateResult {
  /** Updated memory object */
  readonly memory: Memory;
}

/**
 * Result of delete operation
 */
export interface DeleteResult {
  /** Whether deletion was successful */
  readonly success: boolean;
  /** Path of deleted file */
  readonly filePath: string;
}

// ============================================================================
// Filter and Query Types
// ============================================================================

/** Sortable fields for memory listing */
export type SortField = 'createdAt' | 'updatedAt' | 'title' | 'importance';

/** Sort direction */
export type SortOrder = 'asc' | 'desc';

/**
 * Filter options for listing memories
 */
export interface MemoryFilter {
  /** Filter by category */
  readonly category?: string;
  /** Filter by tags (AND relationship) */
  readonly tags?: readonly string[];
  /** Filter by creation date range start */
  readonly fromDate?: ISO8601Timestamp;
  /** Filter by creation date range end */
  readonly toDate?: ISO8601Timestamp;
}

/**
 * Pagination options
 */
export interface PaginationOptions {
  /** Number of results to return (max 100) */
  readonly limit: number;
  /** Number of results to skip */
  readonly offset: number;
}

/**
 * Sorting options
 */
export interface SortOptions {
  /** Field to sort by */
  readonly sortBy: SortField;
  /** Sort direction */
  readonly sortOrder: SortOrder;
}

// ============================================================================
// MCP Tool Input Types
// ============================================================================

/**
 * Input for memory_create tool
 */
export interface CreateMemoryInput {
  readonly title: string;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly category?: string;
  readonly importance?: number;
}

/**
 * Input for memory_read tool
 */
export interface ReadMemoryInput {
  readonly id: UUID;
}

/**
 * Input for memory_update tool
 */
export interface UpdateMemoryInput {
  readonly id: UUID;
  readonly title?: string;
  readonly content?: string;
  readonly tags?: readonly string[];
  readonly category?: string;
  readonly importance?: number;
}

/**
 * Input for memory_delete tool
 */
export interface DeleteMemoryInput {
  readonly id: UUID;
}

/**
 * Input for memory_list tool
 */
export interface ListMemoryInput
  extends Partial<MemoryFilter>, Partial<PaginationOptions>, Partial<SortOptions> {}

/**
 * Input for memory_search tool
 */
export interface SearchMemoryInput extends Partial<MemoryFilter> {
  readonly query: string;
  readonly limit?: number;
}

/**
 * Input for memory_load tool
 */
export interface MemoryLoadInput extends Partial<MemoryFilter> {
  readonly id?: UUID;
  readonly query?: string;
  readonly limit?: number;
}

/**
 * Input for memory_update tool (upsert/append)
 */
export interface MemoryUpdateInput {
  readonly id?: UUID;
  readonly sessionId?: UUID;
  readonly mode?: 'append' | 'upsert';
  readonly entryType?: MemoryEntryType;
  readonly title?: string;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly category?: string;
  readonly importance?: number;
}

// ============================================================================
// MCP Tool Output Types
// ============================================================================

/**
 * Output for memory_create tool
 */
export interface CreateMemoryOutput extends CreateResult {}

/**
 * Output for memory_read tool
 */
export interface ReadMemoryOutput {
  readonly memory: Memory;
}

/**
 * Output for memory_update tool
 */
export interface UpdateMemoryOutput extends UpdateResult {}

export interface MemoryLoadOutput {
  readonly items: readonly Memory[];
  readonly total: number;
}

export interface MemoryUpdateOutput {
  readonly id: UUID;
  readonly sessionId: UUID;
  readonly filePath: string;
  readonly created: boolean;
  readonly updated: boolean;
  readonly memory: Memory;
}

/**
 * Output for memory_delete tool
 */
export interface DeleteMemoryOutput extends DeleteResult {}

/**
 * Output for memory_list tool
 */
export interface ListMemoryOutput extends ListResult {}

/**
 * Output for memory_search tool
 */
export interface SearchMemoryOutput {
  readonly results: readonly SearchResult[];
  readonly total: number;
}

/**
 * Output for memory_get_categories tool
 */
export interface GetCategoriesOutput {
  readonly categories: readonly string[];
}

/**
 * Output for memory_get_tags tool
 */
export interface GetTagsOutput {
  readonly tags: readonly string[];
}

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
// Configuration Types
// ============================================================================

/**
 * Application configuration
 */
export interface Config {
  /** Storage directory path */
  readonly storagePath: string;
  /** Log level */
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
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
