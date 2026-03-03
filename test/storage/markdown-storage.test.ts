/**
 * Markdown Storage Tests
 * Tests for the MarkdownStorage class
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MarkdownStorage, StorageError } from '../../src/storage/markdown-storage.js';
import type { Memory } from '../../src/contracts/types.js';

describe('MarkdownStorage', () => {
  let tempDir: string;
  let storage: MarkdownStorage;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'memhub-storage-test-'));
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
      tags: ['test', 'memory'],
      category: 'testing',
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

    it('should write tags as YAML array', async () => {
      const filePath = await storage.write(sampleMemory);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('tags:');
      expect(content).toContain('test');
      expect(content).toContain('memory');
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
tags:
  - test
category: "testing"
importance: 3
---

# Test Memory

This is the content.
`;
      const filePath = join(tempDir, 'test.md');
      // Use sync write for test setup
      const { writeFileSync } = await import('fs');
      writeFileSync(filePath, testContent);

      const memory = await storage.read('550e8400-e29b-41d4-a716-446655440000');
      expect(memory.id).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(memory.title).toBe('Test Memory');
    });

    it('should throw error when file not found', async () => {
      await expect(
        storage.read('550e8400-e29b-41d4-a716-446655440000')
      ).rejects.toThrow(StorageError);
    });

    it('should parse front matter correctly', async () => {
      const testContent = `---
id: "550e8400-e29b-41d4-a716-446655440000"
created_at: "2024-03-15T10:30:00Z"
updated_at: "2024-03-15T14:20:00Z"
tags:
  - tag1
  - tag2
category: "work"
importance: 4
---

# Test Title

Test content.
`;
      const { writeFileSync } = await import('fs');
      writeFileSync(join(tempDir, 'test.md'), testContent);

      const memory = await storage.read('550e8400-e29b-41d4-a716-446655440000');
      expect(memory.tags).toEqual(['tag1', 'tag2']);
      expect(memory.category).toBe('work');
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
tags: []
category: "general"
importance: 3
---

# Test
`;
      const filePath = join(tempDir, 'test.md');
      const { writeFileSync } = await import('fs');
      writeFileSync(filePath, testContent);

      await storage.delete('550e8400-e29b-41d4-a716-446655440000');
      expect(existsSync(filePath)).toBe(false);
    });

    it('should throw error when file not found', async () => {
      await expect(
        storage.delete('550e8400-e29b-41d4-a716-446655440000')
      ).rejects.toThrow(StorageError);
    });
  });

  describe('list', () => {
    it('should list all memory files', async () => {
      const { writeFileSync } = await import('fs');
      writeFileSync(join(tempDir, '2024-03-15-a.md'), '---\nid: "a"\ncreated_at: "2024-03-15T10:30:00Z"\nupdated_at: "2024-03-15T10:30:00Z"\ntags: []\ncategory: "general"\nimportance: 3\n---\n\n# A');
      writeFileSync(join(tempDir, '2024-03-16-b.md'), '---\nid: "b"\ncreated_at: "2024-03-16T10:30:00Z"\nupdated_at: "2024-03-16T10:30:00Z"\ntags: []\ncategory: "general"\nimportance: 3\n---\n\n# B');

      const files = await storage.list();
      expect(files).toHaveLength(2);
    });

    it('should return empty array when no files exist', async () => {
      const files = await storage.list();
      expect(files).toEqual([]);
    });

    it('should only include .md files', async () => {
      const { writeFileSync } = await import('fs');
      writeFileSync(join(tempDir, 'test.md'), '---\nid: "test"\ncreated_at: "2024-03-15T10:30:00Z"\nupdated_at: "2024-03-15T10:30:00Z"\ntags: []\ncategory: "general"\nimportance: 3\n---\n\n# Test');
      writeFileSync(join(tempDir, 'test.txt'), 'not markdown');

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
tags: []
category: "general"
importance: 3
---

# Test
`;
      const { writeFileSync } = await import('fs');
      writeFileSync(join(tempDir, 'test.md'), testContent);

      const filePath = await storage.findById('550e8400-e29b-41d4-a716-446655440000');
      expect(filePath).toContain('test.md');
    });

    it('should return null when ID not found', async () => {
      const filePath = await storage.findById('550e8400-e29b-41d4-a716-446655440000');
      expect(filePath).toBeNull();
    });
  });
});