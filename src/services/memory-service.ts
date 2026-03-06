import { randomUUID } from 'crypto';
import { join } from 'path';
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
  MemoryLoadInput,
  MemoryUpdateInput,
  MemoryLoadOutput,
  MemoryUpdateOutput,
} from '../contracts/types.js';
import { ErrorCode } from '../contracts/types.js';
import { MarkdownStorage, StorageError } from '../storage/markdown-storage.js';
import { createWALStorage } from '../storage/wal.js';
import { RetrievalPipeline } from './retrieval/pipeline.js';
import type { VectorRetriever } from './retrieval/types.js';
import { VectorRetrieverAdapter } from './retrieval/vector-retriever.js';
import { createReranker, type RerankerMode } from './retrieval/reranker.js';
import { createLogger, type Logger } from '../utils/logger.js';
import { ServiceError } from './errors.js';
import {
  FileIdempotencyStore,
  KeywordSearcher,
  MemoryRepository,
  WALRecovery,
  type VectorIndexScheduler,
  calculateExpiresAt,
  isExpired,
} from './memory/index.js';

// Re-export ServiceError for backward compatibility
export { ServiceError } from './errors.js';

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

/**
 * Memory service implementation - coordinator for memory operations
 */
export class MemoryService implements VectorIndexScheduler {
  private readonly storagePath: string;
  private readonly storage: MarkdownStorage;
  private readonly wal: ReturnType<typeof createWALStorage>;
  private readonly vectorIndex: IVectorIndex | null;
  private readonly embedding: IEmbeddingService | null;
  private readonly vectorSearchEnabled: boolean;
  private readonly retrievalPipeline: RetrievalPipeline;
  private readonly logger: Logger;

  // Extracted components
  private readonly repository: MemoryRepository;
  private readonly idempotencyStore: FileIdempotencyStore;
  private readonly keywordSearcher: KeywordSearcher;
  private readonly walRecovery: WALRecovery;

  // eslint-disable-next-line @typescript-eslint/prefer-readonly
  private initPromise: Promise<void> | null = null;

  constructor(config: MemoryServiceConfig) {
    this.storagePath = config.storagePath;
    this.logger = createLogger({ role: 'daemon' });

    this.storage = new MarkdownStorage({ storagePath: config.storagePath });
    this.wal = createWALStorage(config.storagePath);
    this.vectorSearchEnabled = config.vectorSearch !== false;

    // Initialize idempotency store
    const idempotencyFilePath = join(
      config.storagePath,
      'idempotency',
      'memory-update-index.json'
    );
    this.idempotencyStore = new FileIdempotencyStore(idempotencyFilePath);

    // Placeholder init promise - will be set below
    let initPromiseRef: Promise<void> | null = null;

    if (this.vectorSearchEnabled) {
      // Lazily resolved at runtime — do not use top-level static imports so that
      // native modules (onnxruntime-node, sharp) are never loaded when vectorSearch=false.
      let resolvedVectorIndex: IVectorIndex | null = null;
      let resolvedEmbedding: IEmbeddingService | null = null;

      // Kick off async initialisation without blocking the constructor.
      const storagePath = config.storagePath;
      const vectorInitPromise = (async () => {
        await initPromiseRef!;
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

    // Initialize WAL recovery (must be before initPromise)
    this.walRecovery = new WALRecovery({
      wal: this.wal,
      storage: this.storage,
      vectorIndex: this.vectorIndex,
      embedding: this.embedding,
      logger: this.logger,
    });

    // Set up init promise for WAL
    this.initPromise = this.wal.initialize().then(() => {
      return this.walRecovery.recover();
    });
    initPromiseRef = this.initPromise;

    // Initialize repository with vector scheduler
    this.repository = new MemoryRepository(
      {
        storage: this.storage,
        wal: this.wal,
        storagePath: this.storagePath,
        initPromise: this.initPromise,
        logger: this.logger,
      },
      this
    );

    // Initialize keyword searcher
    this.keywordSearcher = new KeywordSearcher({
      list: input => this.list(input),
      listAll: () => this.repository.listAll(),
    });

    // Initialize retrieval pipeline
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
        listMemories: () => this.repository.listAll(),
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
  // VectorIndexScheduler implementation
  // ---------------------------------------------------------------------------

  /**
   * Asynchronously embeds a memory and upserts it into the vector index.
   * After successful upsert, marks the WAL entry as indexed.
   * Fire-and-forget: failures are logged but do not propagate.
   */
  scheduleUpsert(memory: Memory, walOffset: number): void {
    if (!this.vectorIndex || !this.embedding) return;

    const vectorIndex = this.vectorIndex;
    const embedding = this.embedding;
    const wal = this.wal;

    // Intentionally not awaited
    embedding
      .embedMemory(memory.title, memory.content)
      .then(vec => vectorIndex.upsert(memory, vec, walOffset))
      .then(() => wal.markIndexed(walOffset))
      .catch(() => {
        // Non-fatal: Markdown file is the source of truth
        void this.logger.error('vector_upsert_failed', 'Vector upsert failed (non-fatal)');
      });
  }

  /**
   * Removes a memory from the vector index.
   * Called synchronously (awaited) on delete.
   */
  async removeFromIndex(id: string): Promise<void> {
    if (!this.vectorIndex) return;
    try {
      await this.vectorIndex.delete(id);
    } catch {
      void this.logger.error('vector_delete_failed', 'Vector delete failed (non-fatal)');
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD operations
  // ---------------------------------------------------------------------------

  /**
   * Creates a new memory entry
   */
  async create(input: CreateMemoryInput): Promise<CreateResult> {
    return this.repository.withLock(async () => {
      try {
        const { memory, filePath, walOffset } = await this.repository.create(input);

        // Async vector index (with walOffset)
        this.scheduleUpsert(memory, walOffset);

        return { id: memory.id, filePath, memory };
      } catch (error) {
        throw new ServiceError(
          `Failed to create memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ErrorCode.STORAGE_ERROR
        );
      }
    });
  }

  /**
   * Reads a memory by ID
   */
  async read(input: ReadMemoryInput): Promise<{ memory: Memory }> {
    return this.repository.read(input);
  }

  /**
   * Updates an existing memory
   */
  async update(input: UpdateMemoryInput): Promise<UpdateResult> {
    return this.repository.withLock(async () => {
      try {
        const { memory, walOffset } = await this.repository.update(input);

        // Async vector index (with walOffset)
        this.scheduleUpsert(memory, walOffset);

        return { memory };
      } catch (error) {
        if (error instanceof ServiceError) throw error;
        throw new ServiceError(
          `Failed to update memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ErrorCode.STORAGE_ERROR
        );
      }
    });
  }

  /**
   * Deletes a memory by ID
   */
  async delete(input: DeleteMemoryInput): Promise<DeleteResult> {
    return this.repository.withLock(async () => {
      try {
        const { filePath } = await this.repository.delete(input);
        return { success: true, filePath };
      } catch (error) {
        if (error instanceof ServiceError) throw error;
        throw new ServiceError(
          `Failed to delete memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ErrorCode.STORAGE_ERROR
        );
      }
    });
  }

  // ---------------------------------------------------------------------------
  // List / Search
  // ---------------------------------------------------------------------------

  /**
   * Lists memories with filtering and pagination
   */
  async list(input: ListMemoryInput): Promise<ListResult> {
    return this.repository.list(input);
  }

  /**
   * Searches memories by query.
   * Uses vector semantic search when available, falls back to keyword search.
   */
  async search(input: SearchMemoryInput): Promise<{ results: SearchResult[]; total: number }> {
    try {
      const result = await this.retrievalPipeline.search({
        query: input.query,
        intents: {
          primary: 'semantic',
          fallbacks: ['keyword', 'hybrid'],
        },
        limit: input.limit ?? 10,
      });
      if (result.results.length > 0) {
        return result;
      }
      return this.keywordSearcher.search(input);
    } catch {
      void this.logger.error(
        'retrieval_pipeline_failed',
        'Retrieval pipeline failed, falling back to keyword search'
      );
      return this.keywordSearcher.search(input);
    }
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
    return this.repository.withLock(async () => {
      // Wait for WAL init
      if (this.initPromise) await this.initPromise;

      const now = new Date().toISOString();
      const sessionId = input.sessionId ?? randomUUID();
      const idempotencyKey = input.idempotencyKey;
      const fingerprint = idempotencyKey ? this.idempotencyStore.computeFingerprint(input) : null;

      if (idempotencyKey && fingerprint) {
        const replay = await this.idempotencyStore.findReplay(idempotencyKey, fingerprint);
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

        // Handle TTL update - recalculate expiresAt if ttl is provided
        if (isExpired(existing.expiresAt, new Date(now))) {
          throw new ServiceError(`Memory not found: ${input.id}`, ErrorCode.NOT_FOUND);
        }

        // Handle TTL - recalculate expiresAt if ttl is provided
        let expiresAt = existing.expiresAt;
        let ttl = existing.ttl;
        if (input.ttl !== undefined) {
          ttl = input.ttl;
          expiresAt = calculateExpiresAt(input.ttl, now);
        }

        const updatedMemory: Memory = {
          ...existing,
          updatedAt: now,
          expiresAt,
          sessionId,
          entryType: input.entryType,
          ...(input.title !== undefined && { title: input.title }),
          ...(input.content !== undefined && { content: input.content }),
          ...(input.importance !== undefined && { importance: input.importance }),
          ...(ttl !== undefined && { ttl }),
        };

        // WAL append first for durability
        const walOffset = await this.wal.append(
          'update',
          updatedMemory.id,
          JSON.stringify(updatedMemory)
        );

        // Persist to disk
        const filePath = await this.storage.write(updatedMemory);

        // Async vector index (with walOffset)
        this.scheduleUpsert(updatedMemory, walOffset);

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
        const expiresAt = input.ttl ? calculateExpiresAt(input.ttl, now) : undefined;

        const createdMemory: Memory = {
          id,
          createdAt: now,
          updatedAt: now,
          expiresAt,
          sessionId,
          entryType: input.entryType,
          importance: input.importance ?? 3,
          title: input.title ?? 'memory note',
          content: input.content,
          ...(input.ttl !== undefined && { ttl: input.ttl }),
        };

        // WAL append first for durability
        const walOffset = await this.wal.append('create', id, JSON.stringify(createdMemory));

        // Persist to disk
        const filePath = await this.storage.write(createdMemory);

        // Async vector index (with walOffset)
        this.scheduleUpsert(createdMemory, walOffset);

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
        await this.idempotencyStore.persistRecord(idempotencyKey, fingerprint, result);
      }

      return result;
    });
  }
}
