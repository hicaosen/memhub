/**
 * Memory Service Tests
 * Tests for the MemoryService class
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryService, ServiceError } from '../../src/services/memory-service.js';
import type {
  CreateMemoryInput,
  UpdateMemoryInput,
  ListMemoryInput,
  SearchMemoryInput,
} from '../../src/contracts/types.js';

describe('MemoryService', () => {
  let tempDir: string;
  let memoryService: MemoryService;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'memhub-test-'));
    memoryService = new MemoryService({ storagePath: tempDir });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('should create a new memory with generated ID', async () => {
      const input: CreateMemoryInput = {
        title: 'Test Memory',
        content: 'This is a test memory',
      };

      const result = await memoryService.create(input);
      expect(result.id).toBeDefined();
      expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should create memory file with correct format', async () => {
      const input: CreateMemoryInput = {
        title: 'Test Memory',
        content: 'This is a test memory',
        tags: ['test', 'memory'],
        category: 'testing',
        importance: 4,
      };

      const result = await memoryService.create(input);
      const { readFileSync } = await import('fs');
      const fileContent = readFileSync(result.filePath, 'utf-8');
      expect(fileContent).toContain('---');
      expect(fileContent).toContain('id:');
      expect(fileContent).toContain('# Test Memory');
    });

    it('should set timestamps on creation', async () => {
      const input: CreateMemoryInput = {
        title: 'Test Memory',
        content: 'Content',
      };

      const before = new Date().toISOString();
      const result = await memoryService.create(input);
      const after = new Date().toISOString();
      expect(result.memory.createdAt >= before).toBe(true);
      expect(result.memory.createdAt <= after).toBe(true);
      expect(result.memory.updatedAt).toBe(result.memory.createdAt);
    });

    it('should apply default values for optional fields', async () => {
      const input: CreateMemoryInput = {
        title: 'Test Memory',
        content: 'Content',
      };

      const result = await memoryService.create(input);
      expect(result.memory.tags).toEqual([]);
      expect(result.memory.category).toBe('general');
      expect(result.memory.importance).toBe(3);
    });

    it('should generate URL-friendly filename from title', async () => {
      const input: CreateMemoryInput = {
        title: 'Hello World Test',
        content: 'Content',
      };

      const result = await memoryService.create(input);
      expect(result.filePath).toContain('hello-world-test');
    });
  });

  describe('read', () => {
    it('should read existing memory by ID', async () => {
      const created = await memoryService.create({ title: 'Test', content: 'Content' });
      const read = await memoryService.read({ id: created.id });
      expect(read.memory.id).toBe(created.id);
      expect(read.memory.title).toBe('Test');
    });

    it('should throw NOT_FOUND error for non-existent ID', async () => {
      await expect(
        memoryService.read({ id: '550e8400-e29b-41d4-a716-446655440000' })
      ).rejects.toThrow(ServiceError);
    });
  });

  describe('update', () => {
    it('should update memory title', async () => {
      const created = await memoryService.create({ title: 'Old Title', content: 'Content' });
      const updated = await memoryService.update({ id: created.id, title: 'New Title' });
      expect(updated.memory.title).toBe('New Title');
      expect(updated.memory.content).toBe('Content');
    });

    it('should update memory content', async () => {
      const created = await memoryService.create({ title: 'Title', content: 'Old Content' });
      const updated = await memoryService.update({ id: created.id, content: 'New Content' });
      expect(updated.memory.content).toBe('New Content');
    });

    it('should update updatedAt timestamp', async () => {
      const created = await memoryService.create({ title: 'Title', content: 'Content' });
      await new Promise(resolve => setTimeout(resolve, 10));
      const updated = await memoryService.update({ id: created.id, title: 'New Title' });
      expect(new Date(updated.memory.updatedAt).getTime()).toBeGreaterThan(
        new Date(created.memory.updatedAt).getTime()
      );
    });

    it('should not change createdAt timestamp', async () => {
      const created = await memoryService.create({ title: 'Title', content: 'Content' });
      const updated = await memoryService.update({ id: created.id, title: 'New Title' });
      expect(updated.memory.createdAt).toBe(created.memory.createdAt);
    });

    it('should throw NOT_FOUND error for non-existent ID', async () => {
      await expect(
        memoryService.update({ id: '550e8400-e29b-41d4-a716-446655440000', title: 'New' })
      ).rejects.toThrow(ServiceError);
    });
  });

  describe('delete', () => {
    it('should delete existing memory', async () => {
      const created = await memoryService.create({ title: 'To Delete', content: 'Content' });
      const result = await memoryService.delete({ id: created.id });
      expect(result.success).toBe(true);
      await expect(memoryService.read({ id: created.id })).rejects.toThrow(ServiceError);
    });

    it('should return file path of deleted memory', async () => {
      const created = await memoryService.create({ title: 'To Delete', content: 'Content' });
      const result = await memoryService.delete({ id: created.id });
      expect(result.filePath).toBe(created.filePath);
    });

    it('should throw NOT_FOUND error for non-existent ID', async () => {
      await expect(
        memoryService.delete({ id: '550e8400-e29b-41d4-a716-446655440000' })
      ).rejects.toThrow(ServiceError);
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await memoryService.create({ title: 'Work 1', content: 'Content', category: 'work', tags: ['project'] });
      await memoryService.create({ title: 'Work 2', content: 'Content', category: 'work', tags: ['meeting'] });
      await memoryService.create({ title: 'Personal', content: 'Content', category: 'personal' });
    });

    it('should list all memories', async () => {
      const result = await memoryService.list({});
      expect(result.memories).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(false);
    });

    it('should filter by category', async () => {
      const result = await memoryService.list({ category: 'work' });
      expect(result.memories).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should filter by tags', async () => {
      const result = await memoryService.list({ tags: ['project'] });
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].title).toBe('Work 1');
    });

    it('should support pagination', async () => {
      const result = await memoryService.list({ limit: 2, offset: 0 });
      expect(result.memories).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    });

    it('should sort by specified field', async () => {
      const result = await memoryService.list({ sortBy: 'title', sortOrder: 'asc' });
      expect(result.memories[0].title).toBe('Personal');
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await memoryService.create({
        title: 'Project Planning',
        content: 'We need to plan the project timeline and resources.',
        tags: ['planning'],
      });
      await memoryService.create({
        title: 'Meeting Notes',
        content: 'Discussed project requirements and timeline.',
        tags: ['meeting'],
      });
    });

    it('should search in title', async () => {
      const result = await memoryService.search({ query: 'planning' });
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].memory.title).toBe('Project Planning');
    });

    it('should search in content', async () => {
      const result = await memoryService.search({ query: 'timeline' });
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should search in tags', async () => {
      const result = await memoryService.search({ query: 'meeting' });
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should return match snippets', async () => {
      const result = await memoryService.search({ query: 'project' });
      expect(result.results[0].matches.length).toBeGreaterThan(0);
    });

    it('should support multiple keywords', async () => {
      const result = await memoryService.search({ query: 'project timeline' });
      expect(result.results.length).toBeGreaterThan(0);
    });
  });

  describe('getCategories', () => {
    it('should return all unique categories', async () => {
      await memoryService.create({ title: '1', content: 'C', category: 'work' });
      await memoryService.create({ title: '2', content: 'C', category: 'personal' });
      await memoryService.create({ title: '3', content: 'C', category: 'work' });
      const result = await memoryService.getCategories();
      expect(result.categories).toContain('personal');
      expect(result.categories).toContain('work');
    });

    it('should return empty array when no memories exist', async () => {
      const result = await memoryService.getCategories();
      expect(result.categories).toEqual([]);
    });
  });

  describe('getTags', () => {
    it('should return all unique tags', async () => {
      await memoryService.create({ title: '1', content: 'C', tags: ['a', 'b'] });
      await memoryService.create({ title: '2', content: 'C', tags: ['b', 'c'] });
      const result = await memoryService.getTags();
      expect(result.tags).toContain('a');
      expect(result.tags).toContain('b');
      expect(result.tags).toContain('c');
    });

    it('should return empty array when no memories exist', async () => {
      const result = await memoryService.getTags();
      expect(result.tags).toEqual([]);
    });
  });
});