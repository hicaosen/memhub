/**
 * Cleanup Service - Layer-aware memory cleanup.
 *
 * Implements independent cleanup strategies for each layer:
 * - Core: Never cleaned (permanent preferences/decisions)
 * - Journey: Cleaned after 90 days past expiry
 * - Moment: Cleaned after 7 days past expiry
 *
 * @see docs/layered-index-design.md
 */

import type { MemoryFile } from '../contracts/types.js';
import type { MemoryLayer } from './retrieval/layer-types.js';
import { determineLayer } from './retrieval/layer-types.js';
import type { LayeredVectorIndex } from '../storage/layered-vector-index.js';
import type { MarkdownStorage } from '../storage/markdown-storage.js';
import { parseFrontMatter } from '../storage/frontmatter-parser.js';
import type { Logger } from '../utils/logger.js';
import { createLogger } from '../utils/logger.js';

/**
 * Cleanup configuration for each layer.
 */
export interface LayerCleanupConfig {
  /** Whether to clean expired memories in this layer */
  enabled: boolean;
  /** Grace period in days after expiry before cleanup */
  gracePeriodDays: number;
}

/**
 * Default cleanup configurations by layer.
 */
export const DEFAULT_CLEANUP_CONFIGS: Record<MemoryLayer, LayerCleanupConfig> = {
  core: {
    enabled: false, // Never clean core memories
    gracePeriodDays: Infinity,
  },
  journey: {
    enabled: true,
    gracePeriodDays: 90,
  },
  moment: {
    enabled: true,
    gracePeriodDays: 7,
  },
} as const;

/**
 * Result of a cleanup operation.
 */
export interface CleanupResult {
  /** Layer that was cleaned */
  layer: MemoryLayer;
  /** Number of memories removed from vector index */
  indexRemoved: number;
  /** Number of memory files deleted */
  filesDeleted: number;
  /** Errors encountered during cleanup */
  errors: Array<{ id: string; error: Error }>;
}

/**
 * Configuration options for CleanupService.
 */
export interface CleanupServiceOptions {
  core?: Partial<LayerCleanupConfig>;
  journey?: Partial<LayerCleanupConfig>;
  moment?: Partial<LayerCleanupConfig>;
}

/**
 * Extract memory ID from file path.
 * File path format: {storagePath}/memories/{id}.md
 */
function extractMemoryId(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  const filename = parts[parts.length - 1];
  return filename.replace(/\.md$/, '');
}

/**
 * Service for cleaning up expired memories.
 */
export class CleanupService {
  private readonly logger: Logger;
  private readonly configs: Record<MemoryLayer, LayerCleanupConfig>;

  constructor(
    private readonly index: LayeredVectorIndex,
    private readonly storage: MarkdownStorage,
    options?: CleanupServiceOptions
  ) {
    this.logger = createLogger();
    this.configs = {
      core: { ...DEFAULT_CLEANUP_CONFIGS.core, ...options?.core },
      journey: { ...DEFAULT_CLEANUP_CONFIGS.journey, ...options?.journey },
      moment: { ...DEFAULT_CLEANUP_CONFIGS.moment, ...options?.moment },
    };
  }

  /**
   * Runs cleanup on all layers according to their configurations.
   *
   * @param now - Current timestamp (default: new Date())
   * @returns Results for each layer
   */
  async runCleanup(now = new Date()): Promise<CleanupResult[]> {
    const results: CleanupResult[] = [];

    for (const layer of ['core', 'journey', 'moment'] as const) {
      const result = await this.cleanupLayer(layer, now);
      results.push(result);
    }

    return results;
  }

  /**
   * Cleans up expired memories in a specific layer.
   *
   * @param layer - Layer to clean
   * @param now - Current timestamp
   * @returns Cleanup result
   */
  async cleanupLayer(layer: MemoryLayer, now = new Date()): Promise<CleanupResult> {
    const config = this.configs[layer];
    const result: CleanupResult = {
      layer,
      indexRemoved: 0,
      filesDeleted: 0,
      errors: [],
    };

    if (!config.enabled) {
      await this.logger.debug('cleanup', 'Cleanup disabled for layer: ' + layer);
      return result;
    }

    await this.logger.info('cleanup', 'Starting cleanup for layer: ' + layer, {
      meta: { gracePeriodDays: config.gracePeriodDays },
    });

    // Calculate the cutoff time (now - grace period)
    const cutoffTime = new Date(now.getTime() - config.gracePeriodDays * 24 * 60 * 60 * 1000);

    try {
      // Get all memory files from storage
      const memoryFiles = await this.storage.list();

      // Filter for memories in this layer that are past the grace period
      const expiredFiles: Array<{ id: string; file: MemoryFile }> = [];
      for (const file of memoryFiles) {
        try {
          // Parse frontmatter from content
          const parsed = parseFrontMatter(file.content);
          const frontmatter = parsed.frontMatter;

          // Extract ID from file path
          const id = extractMemoryId(file.path);

          // Check if memory belongs to this layer (frontmatter uses snake_case)
          const memoryLayer = determineLayer(frontmatter.entry_type, frontmatter.ttl);
          if (memoryLayer !== layer) continue;

          // Check if memory has expired past the grace period (frontmatter uses snake_case)
          if (!frontmatter.expires_at) continue;

          const expiresAt = new Date(frontmatter.expires_at);
          if (expiresAt < cutoffTime) {
            expiredFiles.push({ id, file });
          }
        } catch {
          // Skip files that can't be parsed
          await this.logger.debug('cleanup', 'Skipping unparseable file: ' + file.path);
        }
      }

      // Delete from vector index
      for (const { id } of expiredFiles) {
        try {
          await this.index.delete(id);
          result.indexRemoved++;
        } catch (error) {
          result.errors.push({
            id,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }

      // Delete from storage (markdown files)
      for (const { id } of expiredFiles) {
        try {
          await this.storage.delete(id);
          result.filesDeleted++;
        } catch (error) {
          result.errors.push({
            id,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }

      await this.logger.info('cleanup', 'Cleanup complete for layer: ' + layer, {
        meta: {
          indexRemoved: result.indexRemoved,
          filesDeleted: result.filesDeleted,
          errorCount: result.errors.length,
        },
      });
    } catch (error) {
      await this.logger.error('cleanup', 'Cleanup failed for layer: ' + layer, {
        meta: { error: error instanceof Error ? error.message : String(error) },
      });
    }

    return result;
  }

  /**
   * Gets the next scheduled cleanup time for a layer.
   *
   * @param layer - Layer to check
   * @param now - Current timestamp
   * @returns ISO timestamp of next cleanup, or null if cleanup is disabled
   */
  getNextCleanupTime(layer: MemoryLayer, now = new Date()): string | null {
    const config = this.configs[layer];
    if (!config.enabled) return null;

    // Schedule next cleanup at the end of the grace period from now
    // This is a simple heuristic; actual scheduling should be done by the caller
    const nextCleanup = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Daily cleanup
    return nextCleanup.toISOString();
  }

  /**
   * Gets statistics about memories that would be cleaned up.
   *
   * @param layer - Layer to analyze
   * @param now - Current timestamp
   * @returns Statistics about pending cleanup
   */
  async getCleanupStats(
    layer: MemoryLayer,
    now = new Date()
  ): Promise<{
    total: number;
    expired: number;
    pendingCleanup: number;
  }> {
    const config = this.configs[layer];
    const cutoffTime = new Date(now.getTime() - config.gracePeriodDays * 24 * 60 * 60 * 1000);

    const memoryFiles = await this.storage.list();

    let total = 0;
    let expired = 0;
    let pendingCleanup = 0;

    for (const file of memoryFiles) {
      try {
        // Parse frontmatter from content
        const parsed = parseFrontMatter(file.content);
        const frontmatter = parsed.frontMatter;

        // Check if memory belongs to this layer (frontmatter uses snake_case)
        const memoryLayer = determineLayer(frontmatter.entry_type, frontmatter.ttl);
        if (memoryLayer !== layer) continue;

        total++;

        // Check expiration (frontmatter uses snake_case)
        if (frontmatter.expires_at) {
          const expiresAt = new Date(frontmatter.expires_at);
          if (expiresAt < now) {
            expired++;
            if (expiresAt < cutoffTime) {
              pendingCleanup++;
            }
          }
        }
      } catch {
        // Skip unparseable files
      }
    }

    return { total, expired, pendingCleanup };
  }
}
