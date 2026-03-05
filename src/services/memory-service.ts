import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { readFile, writeFile, mkdir, rename } from 'fs/promises';
import { dirname, join } from 'path';
import type {
  Memory,
  CreateMemoryInput,
  ReadMemoryInput,
  UpdateMemoryInput,
  DeleteMemoryInput,
  ListMemoryInput,
  SearchMemoryInput,
  CreateResult,
  UpdateResult,
  DeleteResult,
  ListResult,
  SearchResult,
  GetCategoriesOutput,
  GetTagsOutput,
  SortField,
  SortOrder,
  MemoryLoadInput,
  MemoryUpdateInput,
  MemoryLoadOutput,
  MemoryUpdateOutput,
  TTLLevel,
} from '../contracts/types.js';
import { ErrorCode } from '../contracts/types.js';
import { MarkdownStorage, StorageError } from '../storage/markdown-storage.js';
import { WALStorage, createWALStorage } from '../storage/wal.js';
import lockfile from 'proper-lockfile';
import { RetrievalPipeline } from './retrieval/pipeline.js';
import type { VectorRetriever } from './retrieval/types.js';
import { VectorRetrieverAdapter } from './retrieval/vector-retriever.js';
import { createReranker, type RerankerMode } from './retrieval/reranker.js';
import { createLogger, type Logger } from '../utils/logger.js';

const LOCK_TIMEOUT = 5000; // 5 seconds

/** TTL durations in milliseconds */
const TTL_DURATIONS: Record<TTLLevel, number | null> = {
  permanent: null, // Never expire
  long: 90 * 24 * 60 * 60 * 1000, // 90 days
  medium: 30 * 24 * 60 * 60 * 1000, // 30 days
  short: 7 * 24 * 60 * 60 * 1000, // 7 days
  session: 24 * 60 * 60 * 1000, // 24 hours
};

/**
 * Calculates expiration timestamp from TTL level
 * @param ttl - The TTL level
 * @param createdAt - The creation timestamp
 * @returns ISO8601 expiration timestamp or undefined if permanent
 */
function calculateExpiresAt(ttl: TTLLevel, createdAt: string): string | undefined {
  const duration = TTL_DURATIONS[ttl];
  if (duration === null) return undefined;
  return new Date(new Date(createdAt).getTime() + duration).toISOString();
}

// Re-export for use in tests
export { calculateExpiresAt };

/** Minimal interface required from VectorIndex (avoids static import of native module) */
interface IVectorIndex {
  upsert(memory: Memory, vector: number[], walOffset: number): Promise<void>;
  delete(id: string): Promise<void>;
  search(vector: number[], limit?: number): Promise<Array<{ id: string; _distance: number }>>;
}

/** Minimal interface required from EmbeddingService */
interface IEmbeddingService {
  embedMemory(title: string, content: string): Promise<number[]>;
  embed(text: string): Promise<number[]>;
}

/**
 * Custom error for service operations
 */
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly data?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

/**
 * Memory service configuration
 */
export interface MemoryServiceConfig {
  storagePath: string;
  /**
   * Enable vector semantic search via LanceDB + local ONNX model.
   * Set to false in unit tests to avoid loading the model.
   * @default true
   */
  vectorSearch?: boolean;
  /**
   * Reranker mode for retrieval pipeline.
   * auto: try model and fallback to lightweight on failure.
   * @default auto
   */
  rerankerMode?: RerankerMode;
  /**
   * Optional model name for model reranker.
   * @default BAAI/bge-reranker-v2-m3
   */
  rerankerModelName?: string;
  /**
   * LLM assistant mode for intent routing, query rewrite and fact extraction.
   * @default auto
   */
  llmAssistantMode?: 'auto' | 'disabled';
  /**
   * Optional LLM model path override for assistant.
   */
  llmAssistantModelPath?: string;
  /**
   * Optional thread count for assistant LLM.
   */
  llmAssistantThreads?: number;
}

interface MemoryUpdateIdempotencyRecord {
  readonly fingerprint: string;
  readonly recordedAt: string;
  readonly result: MemoryUpdateOutput;
}

/**
 * Memory service implementation
 */
export class MemoryService {
  private readonly storagePath: string;
  private readonly storage: MarkdownStorage;
  private readonly wal: WALStorage;
  private readonly vectorIndex: IVectorIndex | null;
  private readonly embedding: IEmbeddingService | null;
  private readonly vectorSearchEnabled: boolean;
  private readonly retrievalPipeline: RetrievalPipeline;
  private readonly idempotencyFilePath: string;
  private readonly logger: Logger;
  // eslint-disable-next-line @typescript-eslint/prefer-readonly
  private initPromise: Promise<void> | null = null;

  constructor(config: MemoryServiceConfig) {
    this.storagePath = config.storagePath;
    this.logger = createLogger({ role: 'daemon' });
    this.idempotencyFilePath = join(
      config.storagePath,
      '.memhub-idempotency',
      'memory-update-index.json'
    );
    this.storage = new MarkdownStorage({ storagePath: config.storagePath });
    this.wal = createWALStorage(config.storagePath);
    this.vectorSearchEnabled = config.vectorSearch !== false;

    // Initialize WAL
    this.initPromise = this.wal.initialize().then(() => {
      // Run recovery for unindexed entries
      return this.recoverFromWAL();
    });

    if (this.vectorSearchEnabled) {
      // Lazily resolved at runtime — do not use top-level static imports so that
      // native modules (onnxruntime-node, sharp) are never loaded when vectorSearch=false.
      let resolvedVectorIndex: IVectorIndex | null = null;
      let resolvedEmbedding: IEmbeddingService | null = null;

      // Kick off async initialisation without blocking the constructor.
      // The proxy objects below delegate to the real instances once ready.
      const storagePath = config.storagePath;
      const initPromise = this.initPromise;
      const vectorInitPromise = (async () => {
        await initPromise;
        const [{ VectorIndex }, { EmbeddingService }] = await Promise.all([
          import('../storage/vector-index.js'),
          import('./embedding-service.js'),
        ]);
        resolvedVectorIndex = new VectorIndex(storagePath);
        resolvedEmbedding = EmbeddingService.getInstance();
      })();

      // Lightweight proxy that waits for init before delegating
      this.vectorIndex = {
        upsert: async (memory, vector, walOffset) => {
          await vectorInitPromise;
          return resolvedVectorIndex!.upsert(memory, vector, walOffset);
        },
        delete: async id => {
          await vectorInitPromise;
          return resolvedVectorIndex!.delete(id);
        },
        search: async (vector, limit) => {
          await vectorInitPromise;
          return resolvedVectorIndex!.search(vector, limit);
        },
      };

      this.embedding = {
        embedMemory: async (title, content) => {
          await vectorInitPromise;
          return resolvedEmbedding!.embedMemory(title, content);
        },
        embed: async text => {
          await vectorInitPromise;
          return resolvedEmbedding!.embed(text);
        },
      };
    } else {
      this.vectorIndex = null;
      this.embedding = null;
    }

    const vectorRetriever: VectorRetriever | undefined =
      this.vectorSearchEnabled && this.vectorIndex && this.embedding
        ? new VectorRetrieverAdapter({
            embedding: this.embedding,
            vectorIndex: this.vectorIndex,
            readMemoryById: async id => {
              try {
                const { memory } = await this.read({ id });
                return memory;
              } catch {
                return null;
              }
            },
          })
        : undefined;

    this.retrievalPipeline = new RetrievalPipeline(
      {
        listMemories: async () => {
          const listed = await this.list({ limit: 1000 });
          return listed.memories;
        },
        vectorRetriever,
      },
      {
        reranker: createReranker({
          mode: config.rerankerMode ?? 'auto',
        }),
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Asynchronously embeds a memory and upserts it into the vector index.
   * After successful upsert, marks the WAL entry as indexed.
   * Fire-and-forget: failures are logged but do not propagate.
   */
  private scheduleVectorUpsert(memory: Memory, walOffset: number): void {
    if (!this.vectorIndex || !this.embedding) return;

    const vectorIndex = this.vectorIndex;
    const embedding = this.embedding;
    const wal = this.wal;

    // Intentionally not awaited
    embedding
      .embedMemory(memory.title, memory.content)
      .then(vec => vectorIndex.upsert(memory, vec, walOffset))
      .then(() => wal.markIndexed(walOffset))
      .catch(_err => {
        // Non-fatal: Markdown file is the source of truth
        void this.logger.error('vector_upsert_failed', 'Vector upsert failed (non-fatal)');
      });
  }

  /**
   * Removes a memory from the vector index.
   * Called synchronously (awaited) on delete.
   */
  private async removeFromVectorIndex(id: string): Promise<void> {
    if (!this.vectorIndex) return;
    try {
      await this.vectorIndex.delete(id);
    } catch (_err) {
      void this.logger.error('vector_delete_failed', 'Vector delete failed (non-fatal)');
    }
  }

  /**
   * Recovers from WAL by replaying unindexed entries.
   * Called during initialization to ensure crash recovery.
   */
  private async recoverFromWAL(): Promise<void> {
    const unindexed = await this.wal.getUnindexed();
    if (unindexed.length === 0) return;

    void this.logger.info('wal_recovery_start', `Recovering ${unindexed.length} unindexed WAL entries`);

    for (const entry of unindexed) {
      try {
        // Skip deleted entries - they don't need indexing
        if (entry.operation === 'delete') {
          await this.wal.markIndexed(entry.offset);
          continue;
        }

        // Read the memory from disk and re-index
        const memory = await this.storage.read(entry.memoryId);
        if (this.vectorIndex && this.embedding) {
          const vec = await this.embedding.embedMemory(memory.title, memory.content);
          await this.vectorIndex.upsert(memory, vec, entry.offset);
          await this.wal.markIndexed(entry.offset);
        }
      } catch (_err) {
        // Memory may have been deleted, or indexing failed - mark as indexed to skip next time
        void this.logger.warn('wal_recovery_entry_failed', `Failed to recover WAL entry ${entry.offset}`);
        await this.wal.markIndexed(entry.offset);
      }
    }

    void this.logger.info('wal_recovery_complete', 'WAL recovery complete');
  }

  // ---------------------------------------------------------------------------
  // CRUD operations
  // ---------------------------------------------------------------------------

  /**
   * Creates a new memory entry
   */
  async create(input: CreateMemoryInput): Promise<CreateResult> {
    const release = await lockfile.lock(this.storagePath, {
      retries: { retries: 100, minTimeout: 50, maxTimeout: LOCK_TIMEOUT / 100 },
    });
    try {
      const now = new Date().toISOString();
      const id = randomUUID();

      const memory: Memory = {
        id,
        createdAt: now,
        updatedAt: now,
        tags: input.tags ?? [],
        category: input.category ?? 'general',
        importance: input.importance ?? 3,
        title: input.title,
        content: input.content,
      };

      try {
        // Wait for WAL initialization before any write
        if (this.initPromise) {
          await this.initPromise;
        }

        // WAL append first for durability
        const walOffset = await this.wal.append('create', id);

        // Persist to disk
        const filePath = await this.storage.write(memory);

        // Async vector index (with walOffset)
        this.scheduleVectorUpsert(memory, walOffset);

        return { id, filePath, memory };
      } catch (error) {
        throw new ServiceError(
          `Failed to create memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ErrorCode.STORAGE_ERROR
        );
      }
    } finally {
      await release();
    }
  }

  /**
   * Reads a memory by ID
   */
  async read(input: ReadMemoryInput): Promise<{ memory: Memory }> {
    try {
      const memory = await this.storage.read(input.id);
      return { memory };
    } catch (error) {
      if (error instanceof StorageError && error.message.includes('not found')) {
        throw new ServiceError(`Memory not found: ${input.id}`, ErrorCode.NOT_FOUND);
      }
      throw new ServiceError(
        `Failed to read memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCode.STORAGE_ERROR
      );
    }
  }

  /**
   * Updates an existing memory
   */
  async update(input: UpdateMemoryInput): Promise<UpdateResult> {
    const release = await lockfile.lock(this.storagePath, {
      retries: { retries: 100, minTimeout: 50, maxTimeout: LOCK_TIMEOUT / 100 },
    });
    try {
      let existing: Memory;
      try {
        existing = await this.storage.read(input.id);
      } catch (error) {
        if (error instanceof StorageError && error.message.includes('not found')) {
          throw new ServiceError(`Memory not found: ${input.id}`, ErrorCode.NOT_FOUND);
        }
        throw new ServiceError(
          `Failed to read memory for update: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ErrorCode.STORAGE_ERROR
        );
      }

      const updated: Memory = {
        ...existing,
        updatedAt: new Date().toISOString(),
        ...(input.title !== undefined && { title: input.title }),
        ...(input.content !== undefined && { content: input.content }),
        ...(input.tags !== undefined && { tags: input.tags }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.importance !== undefined && { importance: input.importance }),
      };

      try {
        // Wait for WAL init
        if (this.initPromise) await this.initPromise;

        // WAL append first for durability
        const walOffset = await this.wal.append('update', updated.id);

        // Persist to disk
        await this.storage.write(updated);

        // Async vector index (with walOffset)
        this.scheduleVectorUpsert(updated, walOffset);

        return { memory: updated };
      } catch (error) {
        throw new ServiceError(
          `Failed to update memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ErrorCode.STORAGE_ERROR
        );
      }
    } finally {
      await release();
    }
  }

  /**
   * Deletes a memory by ID
   */
  async delete(input: DeleteMemoryInput): Promise<DeleteResult> {
    const release = await lockfile.lock(this.storagePath, {
      retries: { retries: 100, minTimeout: 50, maxTimeout: LOCK_TIMEOUT / 100 },
    });
    try {
      // Wait for WAL init
      if (this.initPromise) await this.initPromise;

      // WAL append first for durability
      const walOffset = await this.wal.append('delete', input.id);

      const filePath = await this.storage.delete(input.id);
      await this.removeFromVectorIndex(input.id);

      // Mark WAL entry as indexed (no vector to index for deletes)
      await this.wal.markIndexed(walOffset);

      return { success: true, filePath };
    } catch (error) {
      if (error instanceof StorageError && error.message.includes('not found')) {
        throw new ServiceError(`Memory not found: ${input.id}`, ErrorCode.NOT_FOUND);
      }
      throw new ServiceError(
        `Failed to delete memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCode.STORAGE_ERROR
      );
    } finally {
      await release();
    }
  }

  // ---------------------------------------------------------------------------
  // List / Search
  // ---------------------------------------------------------------------------

  /**
   * Lists memories with filtering and pagination
   */
  async list(input: ListMemoryInput): Promise<ListResult> {
    try {
      const files = await this.storage.list();

      let memories: Memory[] = [];
      for (const file of files) {
        try {
          const memory = await this.storage.read(this.extractIdFromContent(file.content));
          memories.push(memory);
        } catch {
          continue;
        }
      }

      if (input.category) {
        memories = memories.filter(m => m.category === input.category);
      }
      if (input.tags && input.tags.length > 0) {
        memories = memories.filter(m => input.tags!.every(tag => m.tags.includes(tag)));
      }
      if (input.fromDate) {
        memories = memories.filter(m => m.createdAt >= input.fromDate!);
      }
      if (input.toDate) {
        memories = memories.filter(m => m.createdAt <= input.toDate!);
      }

      const sortBy: SortField = input.sortBy ?? 'createdAt';
      const sortOrder: SortOrder = input.sortOrder ?? 'desc';

      memories.sort((a, b) => {
        let comparison = 0;
        switch (sortBy) {
          case 'createdAt':
            comparison = a.createdAt.localeCompare(b.createdAt);
            break;
          case 'updatedAt':
            comparison = a.updatedAt.localeCompare(b.updatedAt);
            break;
          case 'title':
            comparison = a.title.localeCompare(b.title);
            break;
          case 'importance':
            comparison = a.importance - b.importance;
            break;
        }
        return sortOrder === 'asc' ? comparison : -comparison;
      });

      const total = memories.length;
      const limit = input.limit ?? 20;
      const offset = input.offset ?? 0;
      const paginatedMemories = memories.slice(offset, offset + limit);

      return {
        memories: paginatedMemories,
        total,
        hasMore: offset + limit < total,
      };
    } catch (error) {
      throw new ServiceError(
        `Failed to list memories: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCode.STORAGE_ERROR
      );
    }
  }

  /**
   * Searches memories by query.
   * Uses vector semantic search when available, falls back to keyword search.
   */
  async search(input: SearchMemoryInput): Promise<{ results: SearchResult[]; total: number }> {
    try {
      const result = await this.retrievalPipeline.search({
        query: input.query,
        category: input.category,
        intents: {
          primary: 'semantic',
          fallbacks: ['keyword', 'hybrid'],
        },
        limit: input.limit ?? 10,
      });
      if (result.results.length > 0) {
        return result;
      }
      return this.keywordSearch(input);
    } catch (error) {
      void this.logger.error('retrieval_pipeline_failed', 'Retrieval pipeline failed, falling back to keyword search');
      return this.keywordSearch(input);
    }
  }

  /**
   * Legacy keyword-based search (used as fallback when vector search is unavailable).
   */
  private async keywordSearch(
    input: SearchMemoryInput
  ): Promise<{ results: SearchResult[]; total: number }> {
    const listResult = await this.list({
      category: input.category,
      tags: input.tags,
      limit: 1000,
    });

    const query = input.query.toLowerCase();
    const keywords = query.split(/\s+/).filter(k => k.length > 0);
    const results: SearchResult[] = [];

    for (const memory of listResult.memories) {
      let score = 0;
      const matches: string[] = [];

      const titleLower = memory.title.toLowerCase();
      if (titleLower.includes(query)) {
        score += 10;
        matches.push(memory.title);
      } else {
        for (const keyword of keywords) {
          if (titleLower.includes(keyword)) {
            score += 5;
            if (!matches.includes(memory.title)) matches.push(memory.title);
          }
        }
      }

      const contentLower = memory.content.toLowerCase();
      if (contentLower.includes(query)) {
        score += 3;
        const index = contentLower.indexOf(query);
        const start = Math.max(0, index - 50);
        const end = Math.min(contentLower.length, index + query.length + 50);
        matches.push(memory.content.slice(start, end));
      } else {
        for (const keyword of keywords) {
          if (contentLower.includes(keyword)) {
            score += 1;
            const index = contentLower.indexOf(keyword);
            const start = Math.max(0, index - 30);
            const end = Math.min(contentLower.length, index + keyword.length + 30);
            const snippet = memory.content.slice(start, end);
            if (!matches.some(m => m.includes(snippet))) matches.push(snippet);
          }
        }
      }

      for (const tag of memory.tags) {
        if (
          tag.toLowerCase().includes(query) ||
          keywords.some(k => tag.toLowerCase().includes(k))
        ) {
          score += 2;
          matches.push(`Tag: ${tag}`);
        }
      }

      if (score > 0) {
        results.push({
          memory,
          score: Math.min(score / 20, 1),
          matches: matches.slice(0, 3),
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const limit = input.limit ?? 10;
    return { results: results.slice(0, limit), total: results.length };
  }

  // ---------------------------------------------------------------------------
  // MCP unified tools
  // ---------------------------------------------------------------------------

  /**
   * memory_load — unified read API.
   *
   * Requires either `id` (exact lookup) or `query` (semantic search).
   * Calling without either returns an empty result.
   */
  async memoryLoad(input: MemoryLoadInput): Promise<MemoryLoadOutput> {
    // By-ID lookup
    if (input.id) {
      const { memory } = await this.read({ id: input.id });
      return { items: [memory], total: 1 };
    }

    // Semantic / keyword search with caller-provided intents and rewrites
    if (input.query) {
      // Default intents if not provided by caller
      const intents = input.intents ?? {
        primary: 'hybrid' as const,
        fallbacks: ['semantic' as const, 'keyword' as const],
      };

      const result = await this.retrievalPipeline.search({
        query: input.query,
        intents,
        rewrittenQueries: input.rewrittenQueries,
        limit: input.limit ?? 10,
      });
      const items = result.results.map(r => r.memory);
      return { items, total: items.length };
    }

    // No id and no query — return empty (not supported)
    return { items: [], total: 0 };
  }

  /**
   * memory_update — unified write API (append/upsert)
   */
  async memoryUpdate(input: MemoryUpdateInput): Promise<MemoryUpdateOutput> {
    const release = await lockfile.lock(this.storagePath, {
      retries: { retries: 100, minTimeout: 50, maxTimeout: LOCK_TIMEOUT / 100 },
    });
    try {
      // Wait for WAL init
      if (this.initPromise) await this.initPromise;

      const now = new Date().toISOString();
      const sessionId = input.sessionId ?? randomUUID();
      const idempotencyKey = input.idempotencyKey;
      const fingerprint = idempotencyKey ? this.computeMemoryUpdateFingerprint(input) : null;

      if (idempotencyKey && fingerprint) {
        const replay = await this.findIdempotentReplay(idempotencyKey, fingerprint);
        if (replay) {
          return {
            ...replay,
            idempotentReplay: true,
          };
        }
      }

      let result: MemoryUpdateOutput;

      if (input.id) {
        // Inline update logic to avoid nested lock
        let existing: Memory;
        try {
          existing = await this.storage.read(input.id);
        } catch (error) {
          if (error instanceof StorageError && error.message.includes('not found')) {
            throw new ServiceError(`Memory not found: ${input.id}`, ErrorCode.NOT_FOUND);
          }
          throw new ServiceError(
            `Failed to read memory for update: ${error instanceof Error ? error.message : 'Unknown error'}`,
            ErrorCode.STORAGE_ERROR
          );
        }

        const updatedMemory: Memory = {
          ...existing,
          updatedAt: now,
          sessionId,
          entryType: input.entryType,
          ...(input.title !== undefined && { title: input.title }),
          ...(input.content !== undefined && { content: input.content }),
          ...(input.tags !== undefined && { tags: input.tags }),
          ...(input.category !== undefined && { category: input.category }),
          ...(input.importance !== undefined && { importance: input.importance }),
        };

        // WAL append first for durability
        const walOffset = await this.wal.append('update', updatedMemory.id);

        // Persist to disk
        const filePath = await this.storage.write(updatedMemory);

        // Async vector index (with walOffset)
        this.scheduleVectorUpsert(updatedMemory, walOffset);

        result = {
          id: updatedMemory.id,
          sessionId,
          filePath,
          created: false,
          updated: true,
          memory: updatedMemory,
        };
      } else {
        const id = randomUUID();
        const createdMemory: Memory = {
          id,
          createdAt: now,
          updatedAt: now,
          sessionId,
          entryType: input.entryType,
          tags: input.tags ?? [],
          category: input.category ?? 'general',
          importance: input.importance ?? 3,
          title: input.title ?? 'memory note',
          content: input.content,
        };

        // WAL append first for durability
        const walOffset = await this.wal.append('create', id);

        // Persist to disk
        const filePath = await this.storage.write(createdMemory);

        // Async vector index (with walOffset)
        this.scheduleVectorUpsert(createdMemory, walOffset);

        result = {
          id,
          sessionId,
          filePath,
          created: true,
          updated: false,
          memory: createdMemory,
        };
      }

      if (idempotencyKey && fingerprint) {
        await this.persistIdempotencyRecord(idempotencyKey, fingerprint, result);
      }

      return result;
    } finally {
      await release();
    }
  }

  private computeMemoryUpdateFingerprint(input: MemoryUpdateInput): string {
    const canonical = {
      id: input.id ?? null,
      sessionId: input.sessionId ?? null,
      mode: input.mode ?? 'append',
      entryType: input.entryType ?? null,
      title: input.title ?? null,
      content: input.content,
      tags: input.tags ?? [],
      category: input.category ?? null,
      importance: input.importance ?? null,
    };

    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  private async findIdempotentReplay(
    key: string,
    fingerprint: string
  ): Promise<MemoryUpdateOutput | null> {
    const index = await this.loadIdempotencyIndex();
    const record = index[key];
    if (!record) return null;

    if (record.fingerprint !== fingerprint) {
      throw new ServiceError(
        `Idempotency key conflict: ${key}`,
        ErrorCode.DUPLICATE_ERROR,
        { idempotencyKey: key }
      );
    }

    return record.result;
  }

  private async persistIdempotencyRecord(
    key: string,
    fingerprint: string,
    result: MemoryUpdateOutput
  ): Promise<void> {
    const index = await this.loadIdempotencyIndex();
    index[key] = {
      fingerprint,
      recordedAt: new Date().toISOString(),
      result,
    };
    await this.saveIdempotencyIndex(index);
  }

  private async loadIdempotencyIndex(): Promise<Record<string, MemoryUpdateIdempotencyRecord>> {
    try {
      const raw = await readFile(this.idempotencyFilePath, 'utf-8');
      return JSON.parse(raw) as Record<string, MemoryUpdateIdempotencyRecord>;
    } catch (error) {
      const errorCode =
        error && typeof error === 'object' && 'code' in error
          ? (error as { code?: string }).code
          : undefined;
      if (errorCode === 'ENOENT') {
        return {};
      }
      throw new ServiceError(
        `Failed to load idempotency index: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCode.STORAGE_ERROR
      );
    }
  }

  private async saveIdempotencyIndex(
    index: Record<string, MemoryUpdateIdempotencyRecord>
  ): Promise<void> {
    await mkdir(dirname(this.idempotencyFilePath), { recursive: true });
    const tempPath = `${this.idempotencyFilePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, JSON.stringify(index), 'utf-8');
    await rename(tempPath, this.idempotencyFilePath);
  }

  // ---------------------------------------------------------------------------
  // Metadata helpers
  // ---------------------------------------------------------------------------

  async getCategories(): Promise<GetCategoriesOutput> {
    try {
      const listResult = await this.list({ limit: 1000 });
      const categories = new Set<string>();
      for (const memory of listResult.memories) {
        categories.add(memory.category);
      }
      return { categories: Array.from(categories).sort() };
    } catch (error) {
      throw new ServiceError(
        `Failed to get categories: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCode.STORAGE_ERROR
      );
    }
  }

  async getTags(): Promise<GetTagsOutput> {
    try {
      const listResult = await this.list({ limit: 1000 });
      const tags = new Set<string>();
      for (const memory of listResult.memories) {
        for (const tag of memory.tags) {
          tags.add(tag);
        }
      }
      return { tags: Array.from(tags).sort() };
    } catch (error) {
      throw new ServiceError(
        `Failed to get tags: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCode.STORAGE_ERROR
      );
    }
  }

  private extractIdFromContent(content: string): string {
    const match = content.match(/id:\s*"?([^"\n]+)"?/);
    if (!match) {
      throw new Error('Could not extract ID from content');
    }
    return match[1].trim();
  }
}
