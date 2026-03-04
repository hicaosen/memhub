/**
 * Markdown Storage - Handles file system operations for memory storage
 */

import { readFile, writeFile, unlink, readdir, stat, access, mkdir } from 'fs/promises';
import { join, extname } from 'path';
import { constants } from 'fs';
import type { Memory, MemoryFile } from '../contracts/types.js';
import {
  parseFrontMatter,
  stringifyFrontMatter,
  memoryToFrontMatter,
  frontMatterToMemory,
  FrontMatterError,
} from './frontmatter-parser.js';
import { slugify } from '../utils/slugify.js';

/**
 * Custom error for storage operations
 */
export class StorageError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

/**
 * Storage configuration
 */
export interface StorageConfig {
  /** Root directory for memory storage */
  storagePath: string;
}

/**
 * Markdown file storage implementation
 */
export class MarkdownStorage {
  private readonly storagePath: string;

  constructor(config: StorageConfig) {
    this.storagePath = config.storagePath;
  }

  /**
   * Ensures the storage directory exists
   */
  async initialize(): Promise<void> {
    try {
      await access(this.storagePath, constants.F_OK);
    } catch {
      // Directory doesn't exist, create it
      await mkdir(this.storagePath, { recursive: true });
    }
  }

  /**
   * Writes a memory to a markdown file
   *
   * @param memory - The memory to write
   * @returns The file path where the memory was stored
   * @throws StorageError if write fails
   */
  async write(memory: Memory): Promise<string> {
    await this.initialize();

    const { directoryPath, filename } = this.generatePathParts(memory);
    const filePath = join(directoryPath, filename);
    const frontMatter = memoryToFrontMatter(memory);
    const content = stringifyFrontMatter(frontMatter, memory.title, memory.content);

    try {
      await mkdir(directoryPath, { recursive: true });
      await writeFile(filePath, content, 'utf-8');
      return filePath;
    } catch (error) {
      throw new StorageError(`Failed to write memory file: ${filename}`, error);
    }
  }

  /**
   * Reads a memory by its ID
   *
   * @param id - The memory ID
   * @returns The memory object
   * @throws StorageError if memory not found or read fails
   */
  async read(id: string): Promise<Memory> {
    const filePath = await this.findById(id);

    if (!filePath) {
      throw new StorageError(`Memory not found: ${id}`);
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const { frontMatter, title, content: bodyContent } = parseFrontMatter(content);
      return frontMatterToMemory(frontMatter, title, bodyContent);
    } catch (error) {
      if (error instanceof FrontMatterError) {
        throw new StorageError(`Invalid memory file format: ${filePath}`, error);
      }
      throw new StorageError(`Failed to read memory file: ${filePath}`, error);
    }
  }

  /**
   * Deletes a memory by its ID
   *
   * @param id - The memory ID
   * @returns The file path of the deleted memory
   * @throws StorageError if memory not found or delete fails
   */
  async delete(id: string): Promise<string> {
    const filePath = await this.findById(id);

    if (!filePath) {
      throw new StorageError(`Memory not found: ${id}`);
    }

    try {
      await unlink(filePath);
      return filePath;
    } catch (error) {
      throw new StorageError(`Failed to delete memory file: ${filePath}`, error);
    }
  }

  /**
   * Lists all memory files
   *
   * @returns Array of memory file information
   * @throws StorageError if listing fails
   */
  async list(): Promise<MemoryFile[]> {
    await this.initialize();

    try {
      const markdownPaths = await this.collectMarkdownFiles(this.storagePath);
      const files: MemoryFile[] = [];

      for (const filePath of markdownPaths) {
        const stats = await stat(filePath);
        const content = await readFile(filePath, 'utf-8');

        files.push({
          path: filePath,
          filename: filePath.split(/[/\\]/).pop() ?? filePath,
          content,
          modifiedAt: stats.mtime.toISOString(),
        });
      }

      return files;
    } catch (error) {
      throw new StorageError('Failed to list memory files', error);
    }
  }

  /**
   * Finds a memory file by ID
   *
   * @param id - The memory ID to find
   * @returns The file path or null if not found
   * @throws StorageError if search fails
   */
  async findById(id: string): Promise<string | null> {
    await this.initialize();

    try {
      const markdownPaths = await this.collectMarkdownFiles(this.storagePath);

      for (const filePath of markdownPaths) {
        try {
          const content = await readFile(filePath, 'utf-8');
          const { frontMatter } = parseFrontMatter(content);
          if (frontMatter.id === id) {
            return filePath;
          }
        } catch {
          // Skip files that can't be parsed
          continue;
        }
      }

      return null;
    } catch (error) {
      throw new StorageError('Failed to search for memory file', error);
    }
  }

  /**
   * Generates nested path parts for a memory
   *
   * Format: {storage}/{YYYY-MM-DD}/{session_uuid}/{timestamp}-{slug}.md
   */
  private generatePathParts(memory: Memory): { directoryPath: string; filename: string } {
    const date = memory.createdAt.split('T')[0];
    const sessionId = memory.sessionId ?? 'default-session';
    const titleSlug = slugify(memory.title) || 'untitled';
    const timestamp = memory.createdAt.replace(/[:.]/g, '-');
    const filename = `${timestamp}-${titleSlug}.md`;
    const directoryPath = join(this.storagePath, date, sessionId);

    return { directoryPath, filename };
  }

  private async collectMarkdownFiles(rootDir: string): Promise<string[]> {
    const entries = await readdir(rootDir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const entryPath = join(rootDir, entry.name);
      if (entry.isDirectory()) {
        const nested = await this.collectMarkdownFiles(entryPath);
        files.push(...nested);
      } else if (entry.isFile() && extname(entry.name) === '.md') {
        files.push(entryPath);
      }
    }

    return files;
  }
}
