import { randomUUID } from 'crypto';
import type {
  Memory,
  CreateMemoryInput,
  ReadMemoryInput,
  UpdateMemoryInput,
  DeleteMemoryInput,
  ListMemoryInput,
  ListResult,
  SortField,
  SortOrder,
} from '../../contracts/types.js';
import { ErrorCode } from '../../contracts/types.js';
import { ServiceError } from '../errors.js';
import { MarkdownStorage, StorageError } from '../../storage/markdown-storage.js';
import type { WALStorage } from '../../storage/wal.js';
import type { Logger } from '../../utils/logger.js';
import lockfile from 'proper-lockfile';

const LOCK_TIMEOUT = 5000; // 5 seconds

/**
 * Context dependencies for repository operations
 */
export interface MemoryRepositoryContext {
  readonly storage: MarkdownStorage;
  readonly wal: WALStorage;
  readonly storagePath: string;
  readonly initPromise: Promise<void> | null;
  readonly logger: Logger;
}

/** Interface for vector index scheduling */
export interface VectorIndexScheduler {
  scheduleUpsert(memory: Memory, walOffset: number): void;
  removeFromIndex(id: string): Promise<void>;
}

/**
 * Result of repository create operation
 */
export interface RepositoryCreateResult {
  readonly memory: Memory;
  readonly filePath: string;
  readonly walOffset: number;
}

/**
 * Result of repository update operation
 */
export interface RepositoryUpdateResult {
  readonly memory: Memory;
  readonly walOffset: number;
}

/**
 * Result of repository delete operation
 */
export interface RepositoryDeleteResult {
  readonly filePath: string;
  readonly walOffset: number;
}

/**
 * Memory repository - handles CRUD operations with lock management
 */
export class MemoryRepository {
  private readonly context: MemoryRepositoryContext;
  private readonly vectorScheduler: VectorIndexScheduler | null;

  constructor(context: MemoryRepositoryContext, vectorScheduler?: VectorIndexScheduler | null) {
    this.context = context;
    this.vectorScheduler = vectorScheduler ?? null;
  }

  /**
   * Creates a new memory entry (internal, caller handles locking)
   */
  async create(input: CreateMemoryInput): Promise<RepositoryCreateResult> {
    await this.waitForInit();

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

    // WAL append first for durability
    const walOffset = await this.context.wal.append('create', id);

    // Persist to disk
    const filePath = await this.context.storage.write(memory);

    return { memory, filePath, walOffset };
  }

  /**
   * Reads a memory by ID
   */
  async read(input: ReadMemoryInput): Promise<{ memory: Memory }> {
    try {
      const memory = await this.context.storage.read(input.id);
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
   * Updates an existing memory (internal, caller handles locking)
   */
  async update(input: UpdateMemoryInput): Promise<RepositoryUpdateResult> {
    await this.waitForInit();

    let existing: Memory;
    try {
      existing = await this.context.storage.read(input.id);
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

    // WAL append first for durability
    const walOffset = await this.context.wal.append('update', updated.id);

    // Persist to disk
    await this.context.storage.write(updated);

    return { memory: updated, walOffset };
  }

  /**
   * Deletes a memory by ID (internal, caller handles locking)
   */
  async delete(input: DeleteMemoryInput): Promise<RepositoryDeleteResult> {
    await this.waitForInit();

    // WAL append first for durability
    const walOffset = await this.context.wal.append('delete', input.id);

    const filePath = await this.context.storage.delete(input.id);

    // Remove from vector index synchronously
    if (this.vectorScheduler) {
      await this.vectorScheduler.removeFromIndex(input.id);
    }

    // Mark WAL entry as indexed (no vector to index for deletes)
    await this.context.wal.markIndexed(walOffset);

    return { filePath, walOffset };
  }

  /**
   * Lists memories with filtering and pagination
   */
  async list(input: ListMemoryInput): Promise<ListResult> {
    try {
      const files = await this.context.storage.list();

      let memories: Memory[] = [];
      for (const file of files) {
        try {
          const memory = await this.context.storage.read(
            this.extractIdFromContent(file.content)
          );
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
   * Acquires a lock and executes the operation
   */
  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const release = await lockfile.lock(this.context.storagePath, {
      retries: { retries: 100, minTimeout: 50, maxTimeout: LOCK_TIMEOUT / 100 },
    });
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  /**
   * Waits for WAL initialization
   */
  private async waitForInit(): Promise<void> {
    if (this.context.initPromise) {
      await this.context.initPromise;
    }
  }

  /**
   * Extracts memory ID from content
   */
  private extractIdFromContent(content: string): string {
    const match = content.match(/id:\s*"?([^"\n]+)"?/);
    if (!match) {
      throw new Error('Could not extract ID from content');
    }
    return match[1].trim();
  }
}
