import { createHash } from 'crypto';
import { readFile, writeFile, mkdir, rename } from 'fs/promises';
import { dirname } from 'path';
import type { MemoryUpdateInput, MemoryUpdateOutput } from '../../contracts/types.js';
import { ErrorCode } from '../../contracts/types.js';
import { ServiceError } from '../errors.js';

/**
 * Idempotency record for memory_update operations
 */
export interface MemoryUpdateIdempotencyRecord {
  readonly fingerprint: string;
  readonly recordedAt: string;
  readonly result: MemoryUpdateOutput;
}

/**
 * Store interface for idempotency operations
 */
export interface IdempotencyStore {
  computeFingerprint(input: MemoryUpdateInput): string;
  findReplay(key: string, fingerprint: string): Promise<MemoryUpdateOutput | null>;
  persistRecord(key: string, fingerprint: string, result: MemoryUpdateOutput): Promise<void>;
}

/**
 * File-based idempotency store implementation
 */
export class FileIdempotencyStore implements IdempotencyStore {
  private readonly filePath: string;
  private cache: Record<string, MemoryUpdateIdempotencyRecord> | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Computes a fingerprint for the memory update input
   */
  computeFingerprint(input: MemoryUpdateInput): string {
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

  /**
   * Finds an existing idempotent replay result
   * @throws ServiceError if key exists with different fingerprint (conflict)
   */
  async findReplay(key: string, fingerprint: string): Promise<MemoryUpdateOutput | null> {
    const index = await this.loadIndex();
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

  /**
   * Persists an idempotency record
   */
  async persistRecord(
    key: string,
    fingerprint: string,
    result: MemoryUpdateOutput
  ): Promise<void> {
    const index = await this.loadIndex();
    index[key] = {
      fingerprint,
      recordedAt: new Date().toISOString(),
      result,
    };
    await this.saveIndex(index);
  }

  /**
   * Loads the idempotency index from disk (with caching)
   */
  private async loadIndex(): Promise<Record<string, MemoryUpdateIdempotencyRecord>> {
    if (this.cache) return this.cache;

    try {
      const raw = await readFile(this.filePath, 'utf-8');
      this.cache = JSON.parse(raw) as Record<string, MemoryUpdateIdempotencyRecord>;
      return this.cache;
    } catch (error) {
      const errorCode =
        error && typeof error === 'object' && 'code' in error
          ? (error as { code?: string }).code
          : undefined;
      if (errorCode === 'ENOENT') {
        this.cache = {};
        return this.cache;
      }
      throw new ServiceError(
        `Failed to load idempotency index: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCode.STORAGE_ERROR
      );
    }
  }

  /**
   * Saves the idempotency index to disk atomically
   */
  private async saveIndex(
    index: Record<string, MemoryUpdateIdempotencyRecord>
  ): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, JSON.stringify(index), 'utf-8');
    await rename(tempPath, this.filePath);
    this.cache = index;
  }

  /**
   * Clears the in-memory cache (useful for testing)
   */
  clearCache(): void {
    this.cache = null;
  }
}
