/**
 * Zod schemas for runtime validation
 * All schemas correspond to types defined in types.ts
 */

import { z } from 'zod';

// ============================================================================
// Primitive Schemas
// ============================================================================

/** UUID v4 validation schema */
export const UUIDSchema = z.string().uuid().brand<'UUID'>();

/** ISO 8601 timestamp validation */
export const ISO8601TimestampSchema = z.string().datetime().brand<'ISO8601'>();

/** Slug validation (URL-friendly string) */
export const SlugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be a valid URL slug');

/** Tag name validation */
export const TagSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9-]+$/, 'Tags can only contain lowercase letters, numbers, and hyphens');

/** Category name validation */
export const CategorySchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9-]+$/, 'Category can only contain lowercase letters, numbers, and hyphens');

/** Importance level validation (1-5) */
export const ImportanceSchema = z.number().int().min(1).max(5);

/** STM memory entry type */
export const MemoryEntryTypeSchema = z.enum([
  'decision',
  'preference',
  'knowledge',
  'todo',
  'state_change',
]);

// ============================================================================
// Memory Schemas
// ============================================================================

/** Memory front matter schema (YAML portion) */
export const MemoryFrontMatterSchema = z.object({
  id: UUIDSchema,
  created_at: ISO8601TimestampSchema,
  updated_at: ISO8601TimestampSchema,
  session_id: UUIDSchema.optional(),
  entry_type: MemoryEntryTypeSchema.optional(),
  tags: z.array(TagSchema).default([]),
  category: CategorySchema.default('general'),
  importance: ImportanceSchema.default(3),
});

/** Complete memory schema */
export const MemorySchema = z.object({
  id: UUIDSchema,
  createdAt: ISO8601TimestampSchema,
  updatedAt: ISO8601TimestampSchema,
  sessionId: UUIDSchema.optional(),
  entryType: MemoryEntryTypeSchema.optional(),
  tags: z.array(z.string()).readonly(),
  category: CategorySchema,
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
  matches: z.array(z.string()),
});

/** List result schema */
export const ListResultSchema = z.object({
  memories: z.array(MemorySchema),
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
  category: CategorySchema.optional(),
  tags: z.array(TagSchema).optional(),
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
  title: z.string().min(1).max(200),
  content: z.string().max(100000),
  tags: z.array(TagSchema).default([]),
  category: CategorySchema.default('general'),
  importance: ImportanceSchema.default(3),
});

/** Read memory input schema */
export const ReadMemoryInputSchema = z.object({
  id: UUIDSchema,
});

/** Update memory input schema */
export const UpdateMemoryInputSchema = z.object({
  id: UUIDSchema,
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(100000).optional(),
  tags: z.array(TagSchema).optional(),
  category: CategorySchema.optional(),
  importance: ImportanceSchema.optional(),
});

/** Delete memory input schema */
export const DeleteMemoryInputSchema = z.object({
  id: UUIDSchema,
});

/** List memory input schema */
export const ListMemoryInputSchema = z.object({
  category: CategorySchema.optional(),
  tags: z.array(TagSchema).optional(),
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
  category: CategorySchema.optional(),
  tags: z.array(TagSchema).optional(),
});

/** memory_load input schema */
export const MemoryLoadInputSchema = z.object({
  id: UUIDSchema.optional(),
  sessionId: UUIDSchema.optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  query: z.string().min(1).max(1000).optional(),
  category: CategorySchema.optional(),
  tags: z.array(TagSchema).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  scope: z.enum(['stm', 'all']).optional(),
});

/** memory_update (upsert/append) input schema */
export const MemoryUpdateInputV2Schema = z.object({
  id: UUIDSchema.optional(),
  sessionId: UUIDSchema.optional(),
  mode: z.enum(['append', 'upsert']).default('append'),
  entryType: MemoryEntryTypeSchema.optional(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(100000),
  tags: z.array(TagSchema).optional(),
  category: CategorySchema.optional(),
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
  items: z.array(MemorySchema),
  total: z.number().int().nonnegative(),
});

export const MemoryUpdateOutputSchema = z.object({
  id: UUIDSchema,
  sessionId: UUIDSchema,
  filePath: z.string().min(1),
  created: z.boolean(),
  updated: z.boolean(),
  memory: MemorySchema,
});

/** Delete memory output schema */
export const DeleteMemoryOutputSchema = DeleteResultSchema;

/** List memory output schema */
export const ListMemoryOutputSchema = ListResultSchema;

/** Search memory output schema */
export const SearchMemoryOutputSchema = z.object({
  results: z.array(SearchResultSchema),
  total: z.number().int().nonnegative(),
});

/** Get categories output schema */
export const GetCategoriesOutputSchema = z.object({
  categories: z.array(CategorySchema),
});

/** Get tags output schema */
export const GetTagsOutputSchema = z.object({
  tags: z.array(TagSchema),
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
// Type Extraction from Schemas
// ============================================================================

/** Inferred Memory type from schema */
export type MemoryFromSchema = z.infer<typeof MemorySchema>;

/** Inferred CreateInput type from schema */
export type CreateMemoryInputFromSchema = z.infer<typeof CreateMemoryInputSchema>;

/** Inferred UpdateInput type from schema */
export type UpdateMemoryInputFromSchema = z.infer<typeof UpdateMemoryInputSchema>;

/** Inferred ListInput type from schema */
export type ListMemoryInputFromSchema = z.infer<typeof ListMemoryInputSchema>;

/** Inferred SearchInput type from schema */
export type SearchMemoryInputFromSchema = z.infer<typeof SearchMemoryInputSchema>;
