/**
 * Zod schemas for runtime validation
 * All schemas correspond to types defined in types.ts
 */

import { z } from 'zod';

// ============================================================================
// Primitive Schemas
// ============================================================================

/** UUID v4 validation schema */
export const UUIDSchema = z.string().uuid();

/** ISO 8601 timestamp validation */
export const ISO8601TimestampSchema = z.string().datetime();

/** Slug validation (URL-friendly string) */
export const SlugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be a valid URL slug');

/** Importance level validation (1-5) */
export const ImportanceSchema = z.number().int().min(1).max(5);

/** STM memory entry type */
export const MemoryEntryTypeSchema = z.enum([
  'preference', // User preferences, habits
  'decision', // Technical choices with reasoning
  'procedure', // Reusable processes/workflows
  'constraint', // Project constraints/boundaries
  'session', // Temporary context for current session
]);

/** TTL level schema */
export const TTLLevelSchema = z.enum([
  'permanent', // Never expire
  'long', // 90 days
  'medium', // 30 days
  'short', // 7 days
  'session', // 24 hours
]);

// ============================================================================
// Memory Schemas
// ============================================================================

/** Memory front matter schema (YAML portion) */
export const MemoryFrontMatterSchema = z.object({
  id: UUIDSchema,
  created_at: ISO8601TimestampSchema,
  updated_at: ISO8601TimestampSchema,
  expires_at: ISO8601TimestampSchema.optional(),
  session_id: UUIDSchema.optional(),
  entry_type: MemoryEntryTypeSchema.optional(),
  ttl: TTLLevelSchema.optional(),
  importance: ImportanceSchema.default(3),
});

/** Complete memory schema */
export const MemorySchema = z.object({
  id: UUIDSchema,
  createdAt: ISO8601TimestampSchema,
  updatedAt: ISO8601TimestampSchema,
  expiresAt: ISO8601TimestampSchema.optional(),
  sessionId: UUIDSchema.optional(),
  entryType: MemoryEntryTypeSchema.optional(),
  ttl: TTLLevelSchema.optional(),
  importance: ImportanceSchema,
  title: z.string().min(1).max(200),
  content: z.string().max(100000),
});

/** Memory file schema */
export const MemoryFileSchema = z.object({
  path: z.string().min(1),
  filename: z.string().min(1),
  content: z.string(),
  modifiedAt: ISO8601TimestampSchema,
});

// ============================================================================
// Result Schemas
// ============================================================================

/** Search result schema */
export const SearchResultSchema = z.object({
  memory: MemorySchema,
  score: z.number().min(0).max(1),
  matches: z.array(z.string()).readonly(),
});

/** List result schema */
export const ListResultSchema = z.object({
  memories: z.array(MemorySchema).readonly(),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

/** Create result schema */
export const CreateResultSchema = z.object({
  id: UUIDSchema,
  filePath: z.string().min(1),
  memory: MemorySchema,
});

/** Update result schema */
export const UpdateResultSchema = z.object({
  memory: MemorySchema,
});

/** Delete result schema */
export const DeleteResultSchema = z.object({
  success: z.boolean(),
  filePath: z.string().min(1),
});

// ============================================================================
// Filter and Query Schemas
// ============================================================================

/** Sort field enum */
export const SortFieldSchema = z.enum(['createdAt', 'updatedAt', 'title', 'importance']);

/** Sort order enum */
export const SortOrderSchema = z.enum(['asc', 'desc']);

/** Memory filter schema */
export const MemoryFilterSchema = z.object({
  fromDate: ISO8601TimestampSchema.optional(),
  toDate: ISO8601TimestampSchema.optional(),
});

/** Pagination options schema */
export const PaginationOptionsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

/** Sort options schema */
export const SortOptionsSchema = z.object({
  sortBy: SortFieldSchema.default('createdAt'),
  sortOrder: SortOrderSchema.default('desc'),
});

// ============================================================================
// MCP Tool Input Schemas
// ============================================================================

/** Create memory input schema */
export const CreateMemoryInputSchema = z.object({
  ttl: TTLLevelSchema.optional(),
  title: z.string().min(1).max(200),
  content: z.string().max(100000),
  importance: ImportanceSchema.default(3),
});

/** Read memory input schema */
export const ReadMemoryInputSchema = z.object({
  id: UUIDSchema,
});

/** Update memory input schema */
export const UpdateMemoryInputSchema = z.object({
  ttl: TTLLevelSchema.optional(),
  id: UUIDSchema,
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(100000).optional(),
  importance: ImportanceSchema.optional(),
});

/** Delete memory input schema */
export const DeleteMemoryInputSchema = z.object({
  id: UUIDSchema,
});

/** List memory input schema */
export const ListMemoryInputSchema = z.object({
  fromDate: ISO8601TimestampSchema.optional(),
  toDate: ISO8601TimestampSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
  sortBy: SortFieldSchema.optional(),
  sortOrder: SortOrderSchema.optional(),
});

/** Search memory input schema */
export const SearchMemoryInputSchema = z.object({
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(100).optional(),
});

/** Retrieval intent schema */
export const RetrievalIntentSchema = z.enum(['semantic', 'keyword', 'hybrid']);

/** memory_load input schema */
export const MemoryLoadInputSchema = z.object({
  id: UUIDSchema.optional(),
  query: z.string().min(1).max(1000).optional(),
  intents: z
    .object({
      primary: RetrievalIntentSchema,
      fallbacks: z.tuple([RetrievalIntentSchema, RetrievalIntentSchema]),
    })
    .optional(),
  rewrittenQueries: z.tuple([z.string(), z.string(), z.string()]),
  limit: z.number().int().min(1).max(100).default(10),
});

/** memory_update (upsert/append) input schema */
export const MemoryUpdateInputV2Schema = z.object({
  id: UUIDSchema.optional(),
  sessionId: UUIDSchema.optional(),
  idempotencyKey: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9:_-]+$/, 'idempotencyKey can only contain letters, numbers, :, _, -')
    .optional(),
  mode: z.enum(['append', 'upsert']).default('append'),
  entryType: MemoryEntryTypeSchema.optional(),
  ttl: TTLLevelSchema,
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(100000),
  importance: ImportanceSchema.optional(),
});

// ============================================================================
// MCP Tool Output Schemas
// ============================================================================

/** Create memory output schema */
export const CreateMemoryOutputSchema = CreateResultSchema;

/** Read memory output schema */
export const ReadMemoryOutputSchema = z.object({
  memory: MemorySchema,
});

/** Update memory output schema */
export const UpdateMemoryOutputSchema = UpdateResultSchema;

export const MemoryLoadOutputSchema = z.object({
  items: z.array(MemorySchema).readonly(),
  total: z.number().int().nonnegative(),
});

export const MemoryUpdateOutputSchema = z.object({
  id: UUIDSchema,
  sessionId: UUIDSchema,
  filePath: z.string().min(1),
  created: z.boolean(),
  updated: z.boolean(),
  idempotentReplay: z.boolean().optional(),
  memory: MemorySchema,
});

/** Delete memory output schema */
export const DeleteMemoryOutputSchema = DeleteResultSchema;

/** List memory output schema */
export const ListMemoryOutputSchema = ListResultSchema;

/** Search memory output schema */
export const SearchMemoryOutputSchema = z.object({
  results: z.array(SearchResultSchema).readonly(),
  total: z.number().int().nonnegative(),
});

// ============================================================================
// Configuration Schemas
// ============================================================================

/** Configuration schema */
export const ConfigSchema = z.object({
  storagePath: z.string().min(1),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

// ============================================================================
// Type Exports (inferred from schemas)
// ============================================================================

// Enum types
export type MemoryEntryType = z.infer<typeof MemoryEntryTypeSchema>;
export type TTLLevel = z.infer<typeof TTLLevelSchema>;
export type SortField = z.infer<typeof SortFieldSchema>;
export type SortOrder = z.infer<typeof SortOrderSchema>;
export type RetrievalIntent = z.infer<typeof RetrievalIntentSchema>;

// Memory types
export type Memory = z.infer<typeof MemorySchema>;
export type MemoryFrontMatter = z.infer<typeof MemoryFrontMatterSchema>;
export type MemoryFile = z.infer<typeof MemoryFileSchema>;

// Result types
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type ListResult = z.infer<typeof ListResultSchema>;
export type CreateResult = z.infer<typeof CreateResultSchema>;
export type UpdateResult = z.infer<typeof UpdateResultSchema>;
export type DeleteResult = z.infer<typeof DeleteResultSchema>;

// Filter and query types
export type MemoryFilter = z.infer<typeof MemoryFilterSchema>;
export type PaginationOptions = z.infer<typeof PaginationOptionsSchema>;
export type SortOptions = z.infer<typeof SortOptionsSchema>;

// MCP tool input types
export type CreateMemoryInput = z.infer<typeof CreateMemoryInputSchema>;
export type ReadMemoryInput = z.infer<typeof ReadMemoryInputSchema>;
export type UpdateMemoryInput = z.infer<typeof UpdateMemoryInputSchema>;
export type DeleteMemoryInput = z.infer<typeof DeleteMemoryInputSchema>;
export type ListMemoryInput = z.infer<typeof ListMemoryInputSchema>;
export type SearchMemoryInput = z.infer<typeof SearchMemoryInputSchema>;
export type MemoryLoadInput = z.infer<typeof MemoryLoadInputSchema>;
export type MemoryUpdateInput = z.infer<typeof MemoryUpdateInputV2Schema>;

// MCP tool output types
export type CreateMemoryOutput = z.infer<typeof CreateMemoryOutputSchema>;
export type ReadMemoryOutput = z.infer<typeof ReadMemoryOutputSchema>;
export type UpdateMemoryOutput = z.infer<typeof UpdateMemoryOutputSchema>;
export type MemoryLoadOutput = z.infer<typeof MemoryLoadOutputSchema>;
export type MemoryUpdateOutput = z.infer<typeof MemoryUpdateOutputSchema>;
export type DeleteMemoryOutput = z.infer<typeof DeleteMemoryOutputSchema>;
export type ListMemoryOutput = z.infer<typeof ListMemoryOutputSchema>;
export type SearchMemoryOutput = z.infer<typeof SearchMemoryOutputSchema>;

// Configuration type
export type Config = z.infer<typeof ConfigSchema>;
