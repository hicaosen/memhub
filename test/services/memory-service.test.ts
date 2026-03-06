/**
 * Memory Service Tests
 * Tests for the MemoryService class
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
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

  describe('create', () => {
    it('should create a new memory with generated ID', async () => {
      const input: CreateMemoryInput = {
        title: 'Test Memory',
        content: 'This is a test memory',
      };

      const result = await memoryService.create(input);
      expect(result.id).toBeDefined();
      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should create memory file with correct format', async () => {
      const input: CreateMemoryInput = {
        title: 'Test Memory',
        content: 'This is a test memory',
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
      await memoryService.create({
        title: 'Work 1',
        content: 'Content',
      });
      await memoryService.create({
        title: 'Work 2',
        content: 'Content',
      });
      await memoryService.create({ title: 'Personal', content: 'Content' });
    });

    it('should list all memories', async () => {
      const result = await memoryService.list({});
      expect(result.memories).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(false);
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
      });
      await memoryService.create({
        title: 'Meeting Notes',
        content: 'Discussed project requirements and timeline.',
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

    it('should return match snippets', async () => {
      const result = await memoryService.search({ query: 'project' });
      expect(result.results[0].matches.length).toBeGreaterThan(0);
    });

    it('should support multiple keywords', async () => {
      const result = await memoryService.search({ query: 'project timeline' });
      expect(result.results.length).toBeGreaterThan(0);
    });
  });

  describe('TTL functionality', () => {
    it('should create memory with TTL and set expiresAt', async () => {
      const input: CreateMemoryInput = {
        title: 'Test TTL',
        content: 'Content with TTL',
        ttl: 'short',
      };

      const result = await memoryService.create(input);
      expect(result.memory.ttl).toBe('short');
      expect(result.memory.expiresAt).toBeDefined();
      // short TTL is 7 days
      const expectedExpiry = new Date(result.memory.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000;
      expect(new Date(result.memory.expiresAt!).getTime()).toBe(expectedExpiry);
    });

    it('should create memory without TTL (no expiresAt)', async () => {
      const input: CreateMemoryInput = {
        title: 'Test No TTL',
        content: 'Content without TTL',
      };

      const result = await memoryService.create(input);
      expect(result.memory.ttl).toBeUndefined();
      expect(result.memory.expiresAt).toBeUndefined();
    });

    it('should create memory with permanent TTL (no expiresAt)', async () => {
      const input: CreateMemoryInput = {
        title: 'Permanent Memory',
        content: 'This will never expire',
        ttl: 'permanent',
      };

      const result = await memoryService.create(input);
      expect(result.memory.ttl).toBe('permanent');
      expect(result.memory.expiresAt).toBeUndefined();
    });

    it('should update memory with TTL and recalculate expiresAt', async () => {
      const created = await memoryService.create({
        title: 'Original',
        content: 'Content',
      });

      const updated = await memoryService.update({
        id: created.id,
        ttl: 'session',
      });

      expect(updated.memory.ttl).toBe('session');
      expect(updated.memory.expiresAt).toBeDefined();
      // session TTL is 24 hours
      const expectedExpiry = new Date(updated.memory.updatedAt).getTime() + 24 * 60 * 60 * 1000;
      expect(new Date(updated.memory.expiresAt!).getTime()).toBe(expectedExpiry);
    });

    it('should not list expired memories', async () => {
      // Create a memory file with expired expiresAt
      const tempDir = mkdtempSync(join(tmpdir(), 'memhub-ttl-test-'));
      const service = new MemoryService({
        storagePath: tempDir,
        vectorSearch: false,
        llmAssistantMode: 'disabled',
        rerankerMode: 'lightweight',
      });

      // Create a valid memory first
      const valid = await service.create({
        title: 'Valid Memory',
        content: 'This is valid',
      });

      // Create an expired memory by writing directly to storage
      const expiredContent = `---
id: 550e8400-e29b-41d4-a716-446655440001
created_at: 2024-01-01T00:00:00.000Z
updated_at: 2024-01-01T00:00:00.000Z
expires_at: 2024-01-02T00:00:00.000Z
importance: 3
---
# Expired Memory
This memory has expired.`;

      writeFileSync(join(tempDir, 'expired-memory.md'), expiredContent, 'utf-8');

      // List should only return the valid memory
      const result = await service.list({});
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].id).toBe(valid.id);

      rmSync(tempDir, { recursive: true, force: true });
    });

    it('should return NOT_FOUND when reading expired memory', async () => {
      // Create a memory file with expired expiresAt
      const tempDir = mkdtempSync(join(tmpdir(), 'memhub-ttl-read-test-'));
      const service = new MemoryService({
        storagePath: tempDir,
        vectorSearch: false,
        llmAssistantMode: 'disabled',
        rerankerMode: 'lightweight',
      });

      // Create an expired memory by writing directly to storage
      const expiredId = '550e8400-e29b-41d4-a716-446655440002';
      const expiredContent = `---
id: ${expiredId}
created_at: 2024-01-01T00:00:00.000Z
updated_at: 2024-01-01T00:00:00.000Z
expires_at: 2024-01-02T00:00:00.000Z
importance: 3
---
# Expired Memory
This memory has expired.`;

      writeFileSync(join(tempDir, 'expired-memory.md'), expiredContent, 'utf-8');

      // Reading expired memory should throw NOT_FOUND
      await expect(service.read({ id: expiredId })).rejects.toThrow(ServiceError);

      rmSync(tempDir, { recursive: true, force: true });
    });

    it('should not return expired memories in search', async () => {
      // Create a memory file with expired expiresAt
      const tempDir = mkdtempSync(join(tmpdir(), 'memhub-ttl-search-test-'));
      const service = new MemoryService({
        storagePath: tempDir,
        vectorSearch: false,
        llmAssistantMode: 'disabled',
        rerankerMode: 'lightweight',
      });

      // Create a valid memory
      await service.create({
        title: 'Valid Project',
        content: 'This is a valid project memory',
      });

      // Create an expired memory with searchable content
      const expiredContent = `---
id: 550e8400-e29b-41d4-a716-446655440003
created_at: 2024-01-01T00:00:00.000Z
updated_at: 2024-01-01T00:00:00.000Z
expires_at: 2024-01-02T00:00:00.000Z
importance: 3
---
# Expired Project
This expired project memory should not appear in search.`;

      writeFileSync(join(tempDir, 'expired-project.md'), expiredContent, 'utf-8');

      // Search should only return the valid memory
      const result = await service.search({ query: 'project' });
      expect(result.results.length).toBeGreaterThanOrEqual(1);
      // All results should be valid (not expired)
      for (const r of result.results) {
        expect(r.memory.id).not.toBe('550e8400-e29b-41d4-a716-446655440003');
      }

      rmSync(tempDir, { recursive: true, force: true });
    });

    it('should support memoryUpdate with TTL on create', async () => {
      const result = await memoryService.memoryUpdate({
        content: 'New memory with TTL',
        ttl: 'medium',
        title: 'TTL Test',
      });

      expect(result.created).toBe(true);
      expect(result.memory.ttl).toBe('medium');
      expect(result.memory.expiresAt).toBeDefined();
    });

    it('should support memoryUpdate with TTL on update', async () => {
      const created = await memoryService.memoryUpdate({
        content: 'Original content',
        ttl: 'permanent',
        title: 'Original',
      });

      const updated = await memoryService.memoryUpdate({
        id: created.id,
        content: 'Updated content',
        ttl: 'short',
      });

      expect(updated.updated).toBe(true);
      expect(updated.memory.ttl).toBe('short');
      expect(updated.memory.expiresAt).toBeDefined();
    });
  });
});
