/**
 * Archive Service - Memory archival and restoration.
 *
 * Implements the archive layer:
 * - Archive expired memories (remove from index, keep file)
 * - Restore archived memories (re-index)
 * - List archived memories
 *
 * Archived memories:
 * - Do not participate in vector search
 * - Can be accessed by ID
 * - Are stored in the archive/ directory
 *
 * @see docs/layered-index-design.md
 */

import { mkdir, readdir, readFile, writeFile, unlink, access } from 'fs/promises';
import { join, basename } from 'path';
import { constants } from 'fs';
import { stringify as stringifyYaml } from 'yaml';
import type { Memory, MemoryFrontMatter } from '../contracts/types.js';
import type { LayeredVectorIndex } from '../storage/layered-vector-index.js';
import type { MarkdownStorage } from '../storage/markdown-storage.js';
import { getArchivePath } from '../storage/paths.js';
import { parseFrontMatter, frontMatterToMemory } from '../storage/frontmatter-parser.js';
import type { MemoryLayer } from './retrieval/layer-types.js';
import { determineLayer } from './retrieval/layer-types.js';
import type { Logger } from '../utils/logger.js';
import { createLogger } from '../utils/logger.js';

/**
 * Extended frontmatter for archived memories
 */
interface ArchivedFrontMatter extends MemoryFrontMatter {
  archived_at?: string;
  previous_layer?: string;
  archive_reason?: string;
}

/**
 * Archived memory metadata
 */
export interface ArchivedMemory {
  /** Memory ID */
  readonly id: string;
  /** Original memory content */
  readonly memory: Memory;
  /** Layer before archiving */
  readonly previousLayer: MemoryLayer;
  /** Archive timestamp */
  readonly archivedAt: string;
  /** File path in archive */
  readonly archivePath: string;
}

/**
 * Archive options
 */
export interface ArchiveOptions {
  /** Reason for archival */
  readonly reason?: string;
}

/**
 * Archive result
 */
export interface ArchiveResult {
  /** Memory ID */
  readonly id: string;
  /** Whether archival was successful */
  readonly success: boolean;
  /** Archive path (if successful) */
  readonly archivePath?: string;
  /** Error message (if failed) */
  readonly error?: string;
}

/**
 * Restore options
 */
export interface RestoreOptions {
  /** New TTL level (default: restore original) */
  readonly newTTL?: Memory['ttl'];
}

/**
 * Restore result
 */
export interface RestoreResult {
  /** Memory ID */
  readonly id: string;
  /** Whether restoration was successful */
  readonly success: boolean;
  /** Restored memory */
  readonly memory?: Memory;
  /** Error message (if failed) */
  readonly error?: string;
}

/**
 * Service for archiving and restoring memories.
 */
export class ArchiveService {
  private readonly logger: Logger;
  private readonly archivePath: string;

  constructor(
    private readonly storage: MarkdownStorage,
    private readonly index: LayeredVectorIndex,
    storagePath: string
  ) {
    this.logger = createLogger();
    this.archivePath = getArchivePath(storagePath);
  }

  /**
   * Ensures the archive directory exists.
   */
  private async ensureArchiveDir(): Promise<void> {
    try {
      await access(this.archivePath, constants.F_OK);
    } catch {
      await mkdir(this.archivePath, { recursive: true });
    }
  }

  /**
   * Stringifies archived frontmatter with extra fields.
   */
  private stringifyArchivedFrontMatter(
    frontMatter: ArchivedFrontMatter,
    title: string,
    content: string
  ): string {
    const yamlData: Record<string, unknown> = {
      id: frontMatter.id,
      created_at: frontMatter.created_at,
      updated_at: frontMatter.updated_at,
      importance: frontMatter.importance,
    };

    // Add optional base fields
    if (frontMatter.expires_at) yamlData.expires_at = frontMatter.expires_at;
    if (frontMatter.session_id) yamlData.session_id = frontMatter.session_id;
    if (frontMatter.entry_type) yamlData.entry_type = frontMatter.entry_type;
    if (frontMatter.ttl) yamlData.ttl = frontMatter.ttl;

    // Add archive-specific fields
    if (frontMatter.archived_at) yamlData.archived_at = frontMatter.archived_at;
    if (frontMatter.previous_layer) yamlData.previous_layer = frontMatter.previous_layer;
    if (frontMatter.archive_reason) yamlData.archive_reason = frontMatter.archive_reason;

    const yamlString = stringifyYaml(yamlData, {
      indent: 2,
      defaultKeyType: 'PLAIN',
      defaultStringType: 'QUOTE_DOUBLE',
    });

    const parts: string[] = ['---', yamlString.trim(), '---', ''];
    if (title) {
      parts.push(`# ${title}`, '');
    }
    if (content) {
      parts.push(content);
    }

    let result = parts.join('\n');
    if (!result.endsWith('\n')) {
      result += '\n';
    }
    return result;
  }

  /**
   * Archives a memory by ID.
   *
   * Removes the memory from the vector index and moves it to the archive directory.
   * The memory file is preserved but no longer participates in search.
   *
   * @param id - Memory ID to archive
   * @param options - Archive options
   * @returns Archive result
   */
  async archive(id: string, options: ArchiveOptions = {}): Promise<ArchiveResult> {
    try {
      await this.ensureArchiveDir();

      // Read the memory from storage
      const memory = await this.storage.read(id);

      const previousLayer = determineLayer(memory.entryType, memory.ttl);
      const archiveFilePath = join(this.archivePath, `${id}.md`);

      // Add archive metadata to frontmatter
      const archivedAt = new Date().toISOString();

      // Read original file content
      const originalPath = await this.storage.findById(id);
      if (!originalPath) {
        return {
          id,
          success: false,
          error: 'Memory file not found',
        };
      }

      const originalContent = await readFile(originalPath, 'utf-8');
      const parsed = parseFrontMatter(originalContent);

      // Create extended frontmatter with archive metadata
      const archivedFrontMatter: ArchivedFrontMatter = {
        ...parsed.frontMatter,
        archived_at: archivedAt,
        previous_layer: previousLayer,
        archive_reason: options.reason ?? 'expired',
      };

      // Serialize updated content
      const updatedContent = this.stringifyArchivedFrontMatter(
        archivedFrontMatter,
        parsed.title,
        parsed.content
      );

      // Write to archive
      await writeFile(archiveFilePath, updatedContent, 'utf-8');

      // Delete from vector index
      await this.index.delete(id);

      // Delete from storage (move, not copy)
      await this.storage.delete(id);

      await this.logger.info('archive', `Archived memory: ${id}`, {
        meta: { previousLayer, archivePath: archiveFilePath },
      });

      return {
        id,
        success: true,
        archivePath: archiveFilePath,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.logger.error('archive', `Failed to archive memory: ${id}`, {
        meta: { error: errorMessage },
      });
      return {
        id,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Restores an archived memory.
   *
   * Moves the memory back to active storage and re-indexes it.
   *
   * @param id - Memory ID to restore
   * @param options - Restore options
   * @returns Restore result
   */
  async restore(id: string, options: RestoreOptions = {}): Promise<RestoreResult> {
    try {
      const archiveFilePath = join(this.archivePath, `${id}.md`);

      // Check if archived file exists
      try {
        await access(archiveFilePath, constants.F_OK);
      } catch {
        return {
          id,
          success: false,
          error: 'Memory not found in archive',
        };
      }

      // Read archived content
      const archivedContent = await readFile(archiveFilePath, 'utf-8');
      const parsed = parseFrontMatter(archivedContent);

      // Remove archive metadata from frontmatter and restore original
      const originalFrontMatter = { ...parsed.frontMatter } as MemoryFrontMatter;
      delete (originalFrontMatter as ArchivedFrontMatter).archived_at;
      delete (originalFrontMatter as ArchivedFrontMatter).previous_layer;
      delete (originalFrontMatter as ArchivedFrontMatter).archive_reason;

      // Apply new TTL if specified
      if (options.newTTL) {
        originalFrontMatter.ttl = options.newTTL;
      }

      // Update timestamps
      originalFrontMatter.updated_at = new Date().toISOString();

      // Reconstruct memory and write to storage
      const memory = frontMatterToMemory(originalFrontMatter, parsed.title, parsed.content);
      await this.storage.write(memory);

      // Delete from archive
      await unlink(archiveFilePath);

      await this.logger.info('archive', `Restored memory: ${id}`, {
        meta: { newTTL: options.newTTL },
      });

      return {
        id,
        success: true,
        memory,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.logger.error('archive', `Failed to restore memory: ${id}`, {
        meta: { error: errorMessage },
      });
      return {
        id,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Lists all archived memories.
   *
   * @returns List of archived memories
   */
  async listArchived(): Promise<ArchivedMemory[]> {
    try {
      await this.ensureArchiveDir();

      const files = await readdir(this.archivePath);
      const archivedMemories: ArchivedMemory[] = [];

      for (const file of files) {
        if (!file.endsWith('.md')) continue;

        const filePath = join(this.archivePath, file);
        const content = await readFile(filePath, 'utf-8');
        const parsed = parseFrontMatter(content);

        const id = basename(file, '.md');
        const frontMatter = parsed.frontMatter as ArchivedFrontMatter;
        const archivedAt = frontMatter.archived_at ?? new Date(0).toISOString();
        const previousLayer = (frontMatter.previous_layer as MemoryLayer) ?? 'moment';

        // Reconstruct memory object from frontmatter
        const memory = frontMatterToMemory(parsed.frontMatter, parsed.title, parsed.content);

        archivedMemories.push({
          id,
          memory,
          previousLayer,
          archivedAt,
          archivePath: filePath,
        });
      }

      return archivedMemories;
    } catch (error) {
      await this.logger.error('archive', 'Failed to list archived memories', {
        meta: { error: error instanceof Error ? error.message : 'Unknown error' },
      });
      return [];
    }
  }

  /**
   * Checks if a memory is archived.
   *
   * @param id - Memory ID to check
   * @returns Whether the memory is archived
   */
  async isArchived(id: string): Promise<boolean> {
    try {
      const archiveFilePath = join(this.archivePath, `${id}.md`);
      await access(archiveFilePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reads an archived memory by ID.
   *
   * @param id - Memory ID to read
   * @returns Archived memory or undefined
   */
  async readArchived(id: string): Promise<ArchivedMemory | undefined> {
    try {
      const archiveFilePath = join(this.archivePath, `${id}.md`);
      const content = await readFile(archiveFilePath, 'utf-8');
      const parsed = parseFrontMatter(content);
      const frontMatter = parsed.frontMatter as ArchivedFrontMatter;

      const archivedAt = frontMatter.archived_at ?? new Date(0).toISOString();
      const previousLayer = (frontMatter.previous_layer as MemoryLayer) ?? 'moment';

      const memory = frontMatterToMemory(parsed.frontMatter, parsed.title, parsed.content);

      return {
        id,
        memory,
        previousLayer,
        archivedAt,
        archivePath: archiveFilePath,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Permanently deletes an archived memory.
   *
   * @param id - Memory ID to delete
   * @returns Whether deletion was successful
   */
  async deleteArchived(id: string): Promise<boolean> {
    try {
      const archiveFilePath = join(this.archivePath, `${id}.md`);
      await unlink(archiveFilePath);

      await this.logger.info('archive', `Permanently deleted archived memory: ${id}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Gets the count of archived memories.
   */
  async count(): Promise<number> {
    try {
      const files = await readdir(this.archivePath);
      return files.filter(f => f.endsWith('.md')).length;
    } catch {
      return 0;
    }
  }
}
