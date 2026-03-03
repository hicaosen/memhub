/**
 * Memory Service - Business logic for memory operations
 */

import { randomUUID } from 'crypto';
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
} from '../contracts/types.js';
import { ErrorCode } from '../contracts/types.js';
import { MarkdownStorage, StorageError } from '../storage/markdown-storage.js';

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
}

/**
 * Memory service implementation
 */
export class MemoryService {
  private readonly storage: MarkdownStorage;

  constructor(config: MemoryServiceConfig) {
    this.storage = new MarkdownStorage({ storagePath: config.storagePath });
  }

  /**
   * Creates a new memory entry
   *
   * @param input - Create memory input
   * @returns Create result with ID, file path, and memory object
   * @throws ServiceError if creation fails
   */
  async create(input: CreateMemoryInput): Promise<CreateResult> {
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
      const filePath = await this.storage.write(memory);
      return {
        id,
        filePath,
        memory,
      };
    } catch (error) {
      throw new ServiceError(
        `Failed to create memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCode.STORAGE_ERROR
      );
    }
  }

  /**
   * Reads a memory by ID
   *
   * @param input - Read memory input
   * @returns Memory object
   * @throws ServiceError if memory not found
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
   *
   * @param input - Update memory input
   * @returns Updated memory object
   * @throws ServiceError if memory not found
   */
  async update(input: UpdateMemoryInput): Promise<UpdateResult> {
    // First read the existing memory
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

    // Apply updates
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
      await this.storage.write(updated);
      return { memory: updated };
    } catch (error) {
      throw new ServiceError(
        `Failed to update memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCode.STORAGE_ERROR
      );
    }
  }

  /**
   * Deletes a memory by ID
   *
   * @param input - Delete memory input
   * @returns Delete result
   * @throws ServiceError if memory not found
   */
  async delete(input: DeleteMemoryInput): Promise<DeleteResult> {
    try {
      const filePath = await this.storage.delete(input.id);
      return {
        success: true,
        filePath,
      };
    } catch (error) {
      if (error instanceof StorageError && error.message.includes('not found')) {
        throw new ServiceError(`Memory not found: ${input.id}`, ErrorCode.NOT_FOUND);
      }
      throw new ServiceError(
        `Failed to delete memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCode.STORAGE_ERROR
      );
    }
  }

  /**
   * Lists memories with filtering and pagination
   *
   * @param input - List memory input
   * @returns List result with memories, total count, and hasMore flag
   */
  async list(input: ListMemoryInput): Promise<ListResult> {
    try {
      const files = await this.storage.list();

      // Parse all files into memories
      let memories: Memory[] = [];
      for (const file of files) {
        try {
          const memory = await this.storage.read(
            this.extractIdFromContent(file.content)
          );
          memories.push(memory);
        } catch {
          // Skip invalid files
          continue;
        }
      }

      // Apply filters
      if (input.category) {
        memories = memories.filter(m => m.category === input.category);
      }

      if (input.tags && input.tags.length > 0) {
        memories = memories.filter(m =>
          input.tags!.every(tag => m.tags.includes(tag))
        );
      }

      if (input.fromDate) {
        memories = memories.filter(m => m.createdAt >= input.fromDate!);
      }

      if (input.toDate) {
        memories = memories.filter(m => m.createdAt <= input.toDate!);
      }

      // Sort
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

      // Apply pagination
      const total = memories.length;
      const limit = input.limit ?? 20;
      const offset = input.offset ?? 0;

      const paginatedMemories = memories.slice(offset, offset + limit);
      const hasMore = offset + limit < total;

      return {
        memories: paginatedMemories,
        total,
        hasMore,
      };
    } catch (error) {
      throw new ServiceError(
        `Failed to list memories: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCode.STORAGE_ERROR
      );
    }
  }

  /**
   * Searches memories by query
   *
   * @param input - Search memory input
   * @returns Search results with scores and matches
   */
  async search(input: SearchMemoryInput): Promise<{ results: SearchResult[]; total: number }> {
    try {
      const listResult = await this.list({
        category: input.category,
        tags: input.tags,
        limit: 1000, // Get all for search
      });

      const query = input.query.toLowerCase();
      const keywords = query.split(/\s+/).filter(k => k.length > 0);

      const results: SearchResult[] = [];

      for (const memory of listResult.memories) {
        let score = 0;
        const matches: string[] = [];

        // Search in title (higher weight)
        const titleLower = memory.title.toLowerCase();
        if (titleLower.includes(query)) {
          score += 10;
          matches.push(memory.title);
        } else {
          // Check individual keywords in title
          for (const keyword of keywords) {
            if (titleLower.includes(keyword)) {
              score += 5;
              if (!matches.includes(memory.title)) {
                matches.push(memory.title);
              }
            }
          }
        }

        // Search in content
        const contentLower = memory.content.toLowerCase();
        if (contentLower.includes(query)) {
          score += 3;
          // Extract matching snippet
          const index = contentLower.indexOf(query);
          const start = Math.max(0, index - 50);
          const end = Math.min(contentLower.length, index + query.length + 50);
          const snippet = memory.content.slice(start, end);
          matches.push(snippet);
        } else {
          // Check individual keywords in content
          for (const keyword of keywords) {
            if (contentLower.includes(keyword)) {
              score += 1;
              const index = contentLower.indexOf(keyword);
              const start = Math.max(0, index - 30);
              const end = Math.min(contentLower.length, index + keyword.length + 30);
              const snippet = memory.content.slice(start, end);
              if (!matches.some(m => m.includes(snippet))) {
                matches.push(snippet);
              }
            }
          }
        }

        // Search in tags
        for (const tag of memory.tags) {
          if (tag.toLowerCase().includes(query) || keywords.some(k => tag.toLowerCase().includes(k))) {
            score += 2;
            matches.push(`Tag: ${tag}`);
          }
        }

        if (score > 0) {
          results.push({
            memory,
            score: Math.min(score / 20, 1), // Normalize to 0-1
            matches: matches.slice(0, 3), // Limit matches
          });
        }
      }

      // Sort by score descending
      results.sort((a, b) => b.score - a.score);

      // Apply limit
      const limit = input.limit ?? 10;
      const limitedResults = results.slice(0, limit);

      return {
        results: limitedResults,
        total: results.length,
      };
    } catch (error) {
      throw new ServiceError(
        `Failed to search memories: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCode.STORAGE_ERROR
      );
    }
  }

  /**
   * memory_load unified read API (STM-first)
   */
  async memoryLoad(input: MemoryLoadInput): Promise<MemoryLoadOutput> {
    if (input.id) {
      const { memory } = await this.read({ id: input.id });
      return { items: [memory], total: 1 };
    }

    if (input.query) {
      const searched = await this.search({
        query: input.query,
        category: input.category,
        tags: input.tags,
        limit: input.limit,
      });
      let items = searched.results.map(r => r.memory);
      if (input.sessionId) {
        items = items.filter(m => m.sessionId === input.sessionId);
      }
      return { items, total: items.length };
    }

    const listResult = await this.list({
      category: input.category,
      tags: input.tags,
      limit: input.limit ?? 20,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });

    let items = [...listResult.memories];

    if (input.sessionId) {
      items = items.filter(m => m.sessionId === input.sessionId);
    }

    if (input.date) {
      const date = input.date;
      items = items.filter(m => m.createdAt.startsWith(date));
    }

    return { items, total: items.length };
  }

  /**
   * memory_update unified write API (append/upsert)
   */
  async memoryUpdate(input: MemoryUpdateInput): Promise<MemoryUpdateOutput> {
    const now = new Date().toISOString();
    const sessionId = input.sessionId ?? randomUUID();

    if (input.id) {
      const updatedResult = await this.update({
        id: input.id,
        title: input.title,
        content: input.content,
        tags: input.tags,
        category: input.category,
        importance: input.importance,
      });

      const updatedMemory: Memory = {
        ...updatedResult.memory,
        sessionId,
        entryType: input.entryType,
      };

      const filePath = await this.storage.write(updatedMemory);
      return {
        id: updatedMemory.id,
        sessionId,
        filePath,
        created: false,
        updated: true,
        memory: updatedMemory,
      };
    }

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

    const filePath = await this.storage.write(createdMemory);
    return {
      id,
      sessionId,
      filePath,
      created: true,
      updated: false,
      memory: createdMemory,
    };
  }

  /**
   * Gets all unique categories
   *
   * @returns Array of category names
   */
  async getCategories(): Promise<GetCategoriesOutput> {
    try {
      const listResult = await this.list({ limit: 1000 });
      const categories = new Set<string>();

      for (const memory of listResult.memories) {
        categories.add(memory.category);
      }

      return {
        categories: Array.from(categories).sort(),
      };
    } catch (error) {
      throw new ServiceError(
        `Failed to get categories: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCode.STORAGE_ERROR
      );
    }
  }

  /**
   * Gets all unique tags
   *
   * @returns Array of tag names
   */
  async getTags(): Promise<GetTagsOutput> {
    try {
      const listResult = await this.list({ limit: 1000 });
      const tags = new Set<string>();

      for (const memory of listResult.memories) {
        for (const tag of memory.tags) {
          tags.add(tag);
        }
      }

      return {
        tags: Array.from(tags).sort(),
      };
    } catch (error) {
      throw new ServiceError(
        `Failed to get tags: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCode.STORAGE_ERROR
      );
    }
  }

  /**
   * Extracts ID from file content
   *
   * @param content - File content
   * @returns ID string
   */
  private extractIdFromContent(content: string): string {
    const match = content.match(/id:\s*"?([^"\n]+)"?/);
    if (!match) {
      throw new Error('Could not extract ID from content');
    }
    return match[1].trim();
  }
}
