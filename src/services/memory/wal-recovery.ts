import type { Memory } from '../../contracts/types.js';
import type { WALStorage } from '../../storage/wal.js';
import type { Logger } from '../../utils/logger.js';

/** Minimal interface required from VectorIndex */
interface IVectorIndex {
  upsert(memory: Memory, vector: number[], walOffset: number): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Minimal interface required from EmbeddingService */
interface IEmbeddingService {
  embedMemory(title: string, content: string): Promise<number[]>;
}

/** Minimal interface for storage read operations */
interface IStorage {
  read(id: string): Promise<Memory>;
}

/**
 * Context dependencies for WAL recovery
 */
export interface WALRecoveryContext {
  readonly wal: WALStorage;
  readonly storage: IStorage;
  readonly vectorIndex: IVectorIndex | null;
  readonly embedding: IEmbeddingService | null;
  readonly logger: Logger;
}

/**
 * Handles WAL recovery operations
 */
export class WALRecovery {
  private readonly context: WALRecoveryContext;

  constructor(context: WALRecoveryContext) {
    this.context = context;
  }

  /**
   * Recovers from WAL by replaying unindexed entries.
   * Called during initialization to ensure crash recovery.
   */
  async recover(): Promise<void> {
    const unindexed = await this.context.wal.getUnindexed();
    if (unindexed.length === 0) return;

    void this.context.logger.info(
      'wal_recovery_start',
      `Recovering ${unindexed.length} unindexed WAL entries`
    );

    for (const entry of unindexed) {
      try {
        // Skip deleted entries - they don't need indexing
        if (entry.operation === 'delete') {
          await this.context.wal.markIndexed(entry.offset);
          continue;
        }

        // Read the memory from disk and re-index
        const memory = await this.context.storage.read(entry.memoryId);
        if (this.context.vectorIndex && this.context.embedding) {
          const vec = await this.context.embedding.embedMemory(
            memory.title,
            memory.content
          );
          await this.context.vectorIndex.upsert(memory, vec, entry.offset);
          await this.context.wal.markIndexed(entry.offset);
        }
      } catch {
        // Memory may have been deleted, or indexing failed
        // Mark as indexed to skip next time
        void this.context.logger.warn(
          'wal_recovery_entry_failed',
          `Failed to recover WAL entry ${entry.offset}`
        );
        await this.context.wal.markIndexed(entry.offset);
      }
    }

    void this.context.logger.info('wal_recovery_complete', 'WAL recovery complete');
  }
}
