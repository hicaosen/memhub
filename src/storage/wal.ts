/**
 * WAL (Write-Ahead Log) Storage - Provides durability and crash recovery
 *
 * All write operations are first appended to the WAL, then persisted to disk.
 * On startup, the WAL is replayed to recover any unindexed entries.
 */

import { readFile, writeFile, appendFile, stat, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import type { WALEntry, WALConfig, UUID } from '../contracts/types.js';

/**
 * Default WAL file name
 */
const WAL_FILENAME = 'wal.log';

/**
 * WAL entry separator for parsing
 */
const ENTRY_SEPARATOR = '\n---WAL_ENTRY---\n';

/**
 * WAL Storage implementation
 */
export class WALStorage {
  private readonly walPath: string;
  private currentOffset = 0;

  constructor(config: WALConfig) {
    this.walPath = config.walPath;
  }

  /**
   * Initializes the WAL file
   */
  async initialize(): Promise<void> {
    // Ensure directory exists
    const dir = dirname(this.walPath);
    try {
      await mkdir(dir, { recursive: true });
    } catch {
      // Directory may already exist
    }

    // Open or create WAL file
    try {
      const stats = await stat(this.walPath);
      this.currentOffset = stats.size;
    } catch {
      // File doesn't exist, will be created on first append
      this.currentOffset = 0;
    }
  }

  /**
   * Appends a new entry to the WAL
   *
   * @param operation - The type of operation
   * @param memoryId - The memory ID being operated on
   * @param data - Optional serialized memory data
   * @returns The offset of the appended entry
   */
  async append(
    operation: 'create' | 'update' | 'delete',
    memoryId: UUID,
    data?: string
  ): Promise<number> {
    const offset = this.currentOffset;
    const timestamp = new Date().toISOString();

    const entry: WALEntry = {
      offset,
      operation,
      memoryId,
      timestamp,
      data,
      indexed: false,
    };

    const serialized = JSON.stringify(entry) + ENTRY_SEPARATOR;

    try {
      await appendFile(this.walPath, serialized, 'utf-8');
      this.currentOffset += Buffer.byteLength(serialized, 'utf-8');
      return offset;
    } catch (error) {
      throw new WALError(
        `Failed to append to WAL: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Marks an entry as indexed by its offset
   *
   * @param offset - The offset of the entry to mark
   */
  async markIndexed(offset: number): Promise<void> {
    const entries = await this.readAll();

    for (let i = 0; i < entries.length; i++) {
      if (entries[i].offset === offset) {
        entries[i].indexed = true;
      }
    }

    // Only keep unindexed entries, cleaning up completed records
    const unindexed = entries.filter(e => !e.indexed);
    await this.rewrite(unindexed);
  }

  /**
   * Reads all entries from the WAL
   *
   * @returns Array of WAL entries
   */
  async readAll(): Promise<WALEntry[]> {
    try {
      const content = await readFile(this.walPath, 'utf-8');
      return this.parse(content);
    } catch (error) {
      // If file doesn't exist, return empty array
      const errorCode =
        error && typeof error === 'object' && 'code' in error
          ? (error as { code?: string }).code
          : undefined;
      if (errorCode === 'ENOENT') {
        return [];
      }
      throw new WALError(
        `Failed to read WAL: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Gets all unindexed entries from the WAL
   *
   * @returns Array of unindexed WAL entries
   */
  async getUnindexed(): Promise<WALEntry[]> {
    const entries = await this.readAll();
    return entries.filter(e => !e.indexed);
  }

  /**
   * Gets the last entry in the WAL
   *
   * @returns The last entry or null if empty
   */
  async getLast(): Promise<WALEntry | null> {
    const entries = await this.readAll();
    return entries.length > 0 ? entries[entries.length - 1] : null;
  }

  /**
   * Clears all entries from the WAL
   * Use with caution - only after confirming all entries are indexed
   */
  async clear(): Promise<void> {
    try {
      await writeFile(this.walPath, '', 'utf-8');
      this.currentOffset = 0;
    } catch (error) {
      throw new WALError(
        `Failed to clear WAL: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Rewrites the WAL with the given entries
   * Used when updating indexed status
   */
  private async rewrite(entries: WALEntry[]): Promise<void> {
    const serialized =
      entries.map(e => JSON.stringify(e)).join(ENTRY_SEPARATOR) +
      (entries.length > 0 ? ENTRY_SEPARATOR : '');

    try {
      await writeFile(this.walPath, serialized, 'utf-8');
      this.currentOffset = Buffer.byteLength(serialized, 'utf-8');
    } catch (error) {
      throw new WALError(
        `Failed to rewrite WAL: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Parses WAL content into entries
   */
  private parse(content: string): WALEntry[] {
    if (!content.trim()) {
      return [];
    }

    const entries: WALEntry[] = [];
    const parts = content.split(ENTRY_SEPARATOR).filter(p => p.trim());

    for (const part of parts) {
      try {
        entries.push(JSON.parse(part) as WALEntry);
      } catch {
        // Skip malformed entries
        console.warn('[MemHub] Skipping malformed WAL entry');
      }
    }

    return entries;
  }
}

/**
 * Custom error for WAL operations
 */
export class WALError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'WALError';
  }
}

/**
 * Creates a WAL storage instance with the default path
 */
export function createWALStorage(storagePath: string): WALStorage {
  return new WALStorage({
    walPath: join(storagePath, 'wal', WAL_FILENAME),
  });
}
