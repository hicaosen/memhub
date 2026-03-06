/**
 * Memory Service Edge Case Tests
 * Additional tests for better coverage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryService } from '../../src/services/memory-service.js';

describe('MemoryService Edge Cases', () => {
  let tempDir: string;
  let memoryService: MemoryService;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'memhub-edge-test-'));
    memoryService = new MemoryService({
      storagePath: tempDir,
      vectorSearch: false,
      llmAssistantMode: 'disabled',
      rerankerMode: 'lightweight',
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('create with edge cases', () => {
    it('should handle empty content', async () => {
      const result = await memoryService.create({
        title: 'Empty Content',
        content: '',
      });
      expect(result.memory.content).toBe('');
    });

    it('should handle very long title', async () => {
      const longTitle = 'A'.repeat(200);
      const result = await memoryService.create({
        title: longTitle,
        content: 'Content',
      });
      expect(result.memory.title).toBe(longTitle);
    });

    it('should handle special characters in title', async () => {
      const result = await memoryService.create({
        title: 'Title with @#$%^&*() special chars!',
        content: 'Content',
      });
      expect(result.memory.title).toBe('Title with @#$%^&*() special chars!');
    });
  });

  describe('update edge cases', () => {
    it('should update only importance', async () => {
      const created = await memoryService.create({
        title: 'Title',
        content: 'Content',
        importance: 1,
      });
      const updated = await memoryService.update({
        id: created.id,
        importance: 5,
      });
      expect(updated.memory.importance).toBe(5);
    });
  });

  describe('list with various filters', () => {
    beforeEach(async () => {
      // Create test data with various dates
      const baseDate = new Date('2024-01-15');
      for (let i = 0; i < 5; i++) {
        const date = new Date(baseDate);
        date.setDate(date.getDate() + i);
        await memoryService.create({
          title: `Memory ${i}`,
          content: 'Content',
        });
      }
    });

    it('should filter by date range', async () => {
      // The created memories will have current timestamp, so we need to use a wide range
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const result = await memoryService.list({
        fromDate: yesterday.toISOString(),
        toDate: tomorrow.toISOString(),
      });
      expect(result.memories.length).toBeGreaterThan(0);
    });

    it('should handle empty result with strict filters', async () => {
      const result = await memoryService.list({
        fromDate: '3024-01-01T00:00:00.000Z',
      });
      expect(result.memories).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it('should sort by importance', async () => {
      await memoryService.create({
        title: 'High Importance',
        content: 'Content',
        importance: 5,
      });
      await memoryService.create({
        title: 'Low Importance',
        content: 'Content',
        importance: 1,
      });

      const result = await memoryService.list({
        sortBy: 'importance',
        sortOrder: 'desc',
      });
      expect(result.memories[0].importance).toBe(5);
    });

    it('should handle pagination across multiple pages', async () => {
      const page1 = await memoryService.list({ limit: 2, offset: 0 });
      expect(page1.memories).toHaveLength(2);
      expect(page1.hasMore).toBe(true);

      const page2 = await memoryService.list({ limit: 2, offset: 2 });
      expect(page2.memories).toHaveLength(2);
      expect(page2.hasMore).toBe(true);

      const page3 = await memoryService.list({ limit: 2, offset: 4 });
      expect(page3.memories.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('search edge cases', () => {
    beforeEach(async () => {
      await memoryService.create({
        title: 'Project Alpha',
        content: 'This is about the alpha project development.',
      });
      await memoryService.create({
        title: 'Project Beta',
        content: 'Beta testing is in progress.',
      });
    });

    it('should search with case insensitivity', async () => {
      const result = await memoryService.search({ query: 'ALPHA' });
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should handle search with no results', async () => {
      const result = await memoryService.search({ query: 'xyznonexistent' });
      expect(result.results).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should limit search results', async () => {
      const result = await memoryService.search({ query: 'project', limit: 1 });
      expect(result.results.length).toBeLessThanOrEqual(1);
    });

    it('should fallback to keyword search when retrieval pipeline returns empty', async () => {
      await memoryService.create({
        title: 'Project Planning',
        content: 'plan timeline and resources',
      });

      (
        memoryService as unknown as {
          retrievalPipeline: {
            search: (input: { query: string }) => Promise<{ results: []; total: 0 }>;
          };
        }
      ).retrievalPipeline = {
        search: async () => ({ results: [], total: 0 }),
      };

      const result = await memoryService.search({ query: 'planning' });
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].memory.title).toBe('Project Planning');
    });

    it('should fallback to keyword search when retrieval pipeline throws', async () => {
      await memoryService.create({
        title: 'Meeting Notes',
        content: 'Discussed project requirements.',
      });

      (
        memoryService as unknown as {
          retrievalPipeline: { search: (input: { query: string }) => Promise<never> };
        }
      ).retrievalPipeline = {
        search: async () => {
          throw new Error('pipeline failed');
        },
      };

      const result = await memoryService.search({ query: 'meeting' });
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].memory.title).toBe('Meeting Notes');
    });
  });

  describe('memory_update idempotency', () => {
    it('replays result for same idempotencyKey and payload', async () => {
      const input = {
        sessionId: '550e8400-e29b-41d4-a716-446655440123',
        idempotencyKey: 'idem-replay-1',
        entryType: 'fact' as const,
        ttl: 'permanent' as const,
        title: 'Idempotent write',
        content: 'should only be written once',
      };

      const first = await memoryService.memoryUpdate(input);
      const second = await memoryService.memoryUpdate(input);

      expect(second.id).toBe(first.id);
      expect(second.filePath).toBe(first.filePath);
      expect(second.idempotentReplay).toBe(true);

      const loaded = await memoryService.memoryLoad({
        id: first.id,
        rewrittenQueries: ['id lookup', 'id recall', 'id exact'],
      });
      expect(loaded.total).toBe(1);
      expect(loaded.items[0]?.content).toBe('should only be written once');
    });

    it('rejects reused idempotencyKey with different payload', async () => {
      await memoryService.memoryUpdate({
        idempotencyKey: 'idem-conflict-1',
        entryType: 'fact',
        ttl: 'permanent',
        title: 'Original',
        content: 'original content',
      });

      await expect(
        memoryService.memoryUpdate({
          idempotencyKey: 'idem-conflict-1',
          entryType: 'fact',
          ttl: 'permanent',
          title: 'Original',
          content: 'changed content',
        })
      ).rejects.toMatchObject({
        code: -32004,
      });
    });
  });
});
