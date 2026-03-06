/**
 * Markdown Storage Tests
 * Tests for the MarkdownStorage class
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MarkdownStorage, StorageError } from '../../src/storage/markdown-storage.js';
import { getMemoriesPath } from '../../src/storage/paths.js';
import type { Memory } from '../../src/contracts/types.js';

describe('MarkdownStorage', () => {
  let tempDir: string;
  let memoriesDir: string;
  let storage: MarkdownStorage;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'memhub-storage-test-'));
    memoriesDir = getMemoriesPath(tempDir);
    mkdirSync(memoriesDir, { recursive: true });
    storage = new MarkdownStorage({ storagePath: tempDir });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('write', () => {
    const sampleMemory: Memory = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2024-03-15T10:30:00Z',
      updatedAt: '2024-03-15T10:30:00Z',
      sessionId: '550e8400-e29b-41d4-a716-446655440999',
      importance: 3,
      title: 'Test Memory',
      content: 'This is the content of the test memory.',
    };

    it('should write memory to markdown file', async () => {
      const result = await storage.write(sampleMemory);
      expect(existsSync(result)).toBe(true);
      expect(result).toContain(`${sampleMemory.createdAt.split('T')[0]}`);
      expect(result).toContain(sampleMemory.sessionId as string);
    });

    it('should write valid YAML front matter', async () => {
      const filePath = await storage.write(sampleMemory);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toMatch(/^---\n/);
      expect(content).toContain('id: "550e8400-e29b-41d4-a716-446655440000"');
      expect(content).toContain('created_at: "2024-03-15T10:30:00Z"');
      expect(content).toContain('session_id: "550e8400-e29b-41d4-a716-446655440999"');
    });

    it('should write markdown body with title', async () => {
      const filePath = await storage.write(sampleMemory);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('# Test Memory');
      expect(content).toContain('This is the content');
    });

    it('should return nested file path', async () => {
      const result = await storage.write(sampleMemory);
      expect(result).toContain('test-memory.md');
      expect(result).toContain('2024-03-15');
      expect(result).toContain('550e8400-e29b-41d4-a716-446655440999');
    });
  });

  describe('read', () => {
    it('should read memory from markdown file', async () => {
      // Create a test file first
      const testContent = `---
id: "550e8400-e29b-41d4-a716-446655440000"
created_at: "2024-03-15T10:30:00Z"
updated_at: "2024-03-15T10:30:00Z"
importance: 3
---

# Test Memory

This is the content.
`;
      const filePath = join(memoriesDir, 'test.md');
      // Use sync write for test setup
      const { writeFileSync } = await import('fs');
      writeFileSync(filePath, testContent);

      const memory = await storage.read('550e8400-e29b-41d4-a716-446655440000');
      expect(memory.id).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(memory.title).toBe('Test Memory');
    });

    it('should throw error when file not found', async () => {
      await expect(storage.read('550e8400-e29b-41d4-a716-446655440000')).rejects.toThrow(
        StorageError
      );
    });

    it('should parse front matter correctly', async () => {
      const testContent = `---
id: "550e8400-e29b-41d4-a716-446655440000"
created_at: "2024-03-15T10:30:00Z"
updated_at: "2024-03-15T14:20:00Z"
importance: 4
---

# Test Title

Test content.
`;
      const { writeFileSync } = await import('fs');
      writeFileSync(join(memoriesDir, 'test.md'), testContent);

      const memory = await storage.read('550e8400-e29b-41d4-a716-446655440000');
      expect(memory.importance).toBe(4);
    });
  });

  describe('delete', () => {
    it('should delete memory file', async () => {
      // Create a test file first
      const testContent = `---
id: "550e8400-e29b-41d4-a716-446655440000"
created_at: "2024-03-15T10:30:00Z"
updated_at: "2024-03-15T10:30:00Z"
importance: 3
---

# Test
`;
      const filePath = join(memoriesDir, 'test.md');
      const { writeFileSync } = await import('fs');
      writeFileSync(filePath, testContent);

      await storage.delete('550e8400-e29b-41d4-a716-446655440000');
      expect(existsSync(filePath)).toBe(false);
    });

    it('should throw error when file not found', async () => {
      await expect(storage.delete('550e8400-e29b-41d4-a716-446655440000')).rejects.toThrow(
        StorageError
      );
    });
  });

  describe('list', () => {
    it('should list all memory files', async () => {
      const { writeFileSync } = await import('fs');
      writeFileSync(
        join(memoriesDir, '2024-03-15-a.md'),
        '---\nid: "a"\ncreated_at: "2024-03-15T10:30:00Z"\nupdated_at: "2024-03-15T10:30:00Z"\nimportance: 3\n---\n\n# A'
      );
      writeFileSync(
        join(memoriesDir, '2024-03-16-b.md'),
        '---\nid: "b"\ncreated_at: "2024-03-16T10:30:00Z"\nupdated_at: "2024-03-16T10:30:00Z"\nimportance: 3\n---\n\n# B'
      );

      const files = await storage.list();
      expect(files).toHaveLength(2);
    });

    it('should return empty array when no files exist', async () => {
      const files = await storage.list();
      expect(files).toEqual([]);
    });

    it('should only include .md files', async () => {
      const { writeFileSync } = await import('fs');
      writeFileSync(
        join(memoriesDir, 'test.md'),
        '---\nid: "test"\ncreated_at: "2024-03-15T10:30:00Z"\nupdated_at: "2024-03-15T10:30:00Z"\nimportance: 3\n---\n\n# Test'
      );
      writeFileSync(join(memoriesDir, 'test.txt'), 'not markdown');

      const files = await storage.list();
      expect(files).toHaveLength(1);
      expect(files[0].filename).toBe('test.md');
    });
  });

  describe('findById', () => {
    it('should find file by memory ID', async () => {
      const testContent = `---
id: "550e8400-e29b-41d4-a716-446655440000"
created_at: "2024-03-15T10:30:00Z"
updated_at: "2024-03-15T10:30:00Z"
importance: 3
---

# Test
`;
      const { writeFileSync } = await import('fs');
      writeFileSync(join(memoriesDir, 'test.md'), testContent);

      const filePath = await storage.findById('550e8400-e29b-41d4-a716-446655440000');
      expect(filePath).toContain('test.md');
    });

    it('should return null when ID not found', async () => {
      const filePath = await storage.findById('550e8400-e29b-41d4-a716-446655440000');
      expect(filePath).toBeNull();
    });
  });

  // ── #19: id→path in-memory index ────────────────────────────────────────────

  describe('#19: idToPath cache', () => {
    const MEM_ID = '123e4567-e89b-12d3-a456-426614174000';

    const sampleMemory: Memory = {
      id: MEM_ID,
      createdAt: '2024-06-01T12:00:00.000Z',
      updatedAt: '2024-06-01T12:00:00.000Z',
      sessionId: '550e8400-e29b-41d4-a716-446655440999',
      importance: 3,
      title: 'Cache Test',
      content: 'testing cache',
    };

    it('write() should populate cache: getCacheSize() returns 1 after one write', async () => {
      expect(storage.getCacheSize()).toBe(0);
      await storage.write(sampleMemory);
      expect(storage.getCacheSize()).toBe(1);
    });

    it('write() then findById() returns the correct path without full scan', async () => {
      const writtenPath = await storage.write(sampleMemory);
      const foundPath = await storage.findById(MEM_ID);
      expect(foundPath).toBe(writtenPath);
    });

    it('delete() should evict cache: getCacheSize() returns 0 after delete', async () => {
      await storage.write(sampleMemory);
      expect(storage.getCacheSize()).toBe(1);
      await storage.delete(MEM_ID);
      expect(storage.getCacheSize()).toBe(0);
    });

    it('delete() should make findById() return null (no stale cache hit)', async () => {
      await storage.write(sampleMemory);
      await storage.delete(MEM_ID);
      const result = await storage.findById(MEM_ID);
      expect(result).toBeNull();
    });

    it('findById() on cache miss should scan disk and repopulate cache', async () => {
      // Write a file externally (bypassing MarkdownStorage.write)
      const { writeFileSync, mkdirSync } = await import('fs');
      const dir = join(memoriesDir, '2024-06-01', '550e8400-e29b-41d4-a716-446655440999');
      mkdirSync(dir, { recursive: true });
      const externalPath = join(dir, 'external.md');
      writeFileSync(
        externalPath,
        `---\nid: "${MEM_ID}"\ncreated_at: "2024-06-01T12:00:00.000Z"\nupdated_at: "2024-06-01T12:00:00.000Z"\nimportance: 3\n---\n\n# Cache Test\n`
      );

      // cache is empty — must fall back to disk scan
      expect(storage.getCacheSize()).toBe(0);
      const result = await storage.findById(MEM_ID);
      expect(result).toBe(externalPath);

      // After scan the cache should be populated
      expect(storage.getCacheSize()).toBe(1);

      // Second call should hit cache
      const result2 = await storage.findById(MEM_ID);
      expect(result2).toBe(externalPath);
    });

    it('multiple writes populate cache correctly', async () => {
      const ids = [
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000003',
      ];
      for (const id of ids) {
        await storage.write({ ...sampleMemory, id });
      }
      expect(storage.getCacheSize()).toBe(3);
    });
  });
});
