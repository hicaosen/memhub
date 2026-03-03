/**
 * Storage Edge Case Tests
 * Additional tests for better coverage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MarkdownStorage, StorageError } from '../../src/storage/markdown-storage.js';
import { FrontMatterError } from '../../src/storage/frontmatter-parser.js';

describe('MarkdownStorage Edge Cases', () => {
  let tempDir: string;
  let storage: MarkdownStorage;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'memhub-storage-edge-'));
    storage = new MarkdownStorage({ storagePath: tempDir });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('should create directory if it does not exist', async () => {
      const newDir = join(tempDir, 'subdir', 'new-storage');
      const newStorage = new MarkdownStorage({ storagePath: newDir });
      await newStorage.initialize();
      // Directory should be created
      const { existsSync } = await import('fs');
      expect(existsSync(newDir)).toBe(true);
    });
  });

  describe('write edge cases', () => {
    it('should handle memory with empty title', async () => {
      const memory = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: '2024-03-15T10:30:00Z',
        updatedAt: '2024-03-15T10:30:00Z',
        tags: [],
        category: 'test',
        importance: 3,
        title: '',
        content: 'Content with empty title',
      };

      const filePath = await storage.write(memory);
      expect(filePath).toContain('untitled');
    });

    it('should handle memory with special characters in title', async () => {
      const memory = {
        id: '550e8400-e29b-41d4-a716-446655440001',
        createdAt: '2024-03-15T10:30:00Z',
        updatedAt: '2024-03-15T10:30:00Z',
        tags: [],
        category: 'test',
        importance: 3,
        title: 'Title with @#$%^&*()',
        content: 'Content',
      };

      const filePath = await storage.write(memory);
      expect(filePath).toBeDefined();
    });

    it('should handle very long content', async () => {
      const memory = {
        id: '550e8400-e29b-41d4-a716-446655440002',
        createdAt: '2024-03-15T10:30:00Z',
        updatedAt: '2024-03-15T10:30:00Z',
        tags: [],
        category: 'test',
        importance: 3,
        title: 'Long Content',
        content: 'A'.repeat(10000),
      };

      const filePath = await storage.write(memory);
      const { readFileSync } = await import('fs');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('A'.repeat(100));
    });
  });

  describe('read edge cases', () => {
    it('should throw error for invalid front matter', async () => {
      const invalidContent = '---\ninvalid yaml: [\n---\n\n# Title';
      writeFileSync(join(tempDir, 'invalid.md'), invalidContent);

      await expect(storage.read('any-id')).rejects.toThrow(StorageError);
    });

    it('should throw error for missing required fields', async () => {
      const incompleteContent = '---\nid: "test-id"\n---\n\n# Title';
      writeFileSync(join(tempDir, 'incomplete.md'), incompleteContent);

      await expect(storage.read('test-id')).rejects.toThrow(StorageError);
    });

    it('should handle file with no H1 title', async () => {
      const noTitleContent = `---
id: "550e8400-e29b-41d4-a716-446655440000"
created_at: "2024-03-15T10:30:00Z"
updated_at: "2024-03-15T10:30:00Z"
tags: []
category: "general"
importance: 3
---

Just some content without H1.
`;
      writeFileSync(join(tempDir, 'no-title.md'), noTitleContent);

      const memory = await storage.read('550e8400-e29b-41d4-a716-446655440000');
      expect(memory.title).toBe('');
      expect(memory.content).toContain('Just some content');
    });
  });

  describe('list edge cases', () => {
    it('should skip invalid markdown files', async () => {
      // Create valid file
      const validContent = `---
id: "valid-id"
created_at: "2024-03-15T10:30:00Z"
updated_at: "2024-03-15T10:30:00Z"
tags: []
category: "general"
importance: 3
---

# Valid
`;
      writeFileSync(join(tempDir, 'valid.md'), validContent);

      // Create invalid file
      writeFileSync(join(tempDir, 'invalid.md'), 'Not valid markdown');

      const files = await storage.list();
      expect(files).toHaveLength(2);
    });

    it('should handle empty directory', async () => {
      const files = await storage.list();
      expect(files).toEqual([]);
    });

    it('should ignore non-markdown files', async () => {
      writeFileSync(join(tempDir, 'test.txt'), 'Text file');
      writeFileSync(join(tempDir, 'test.json'), '{}');

      const files = await storage.list();
      expect(files).toHaveLength(0);
    });
  });

  describe('findById edge cases', () => {
    it('should return null when no files exist', async () => {
      const result = await storage.findById('any-id');
      expect(result).toBeNull();
    });

    it('should skip files with invalid front matter', async () => {
      writeFileSync(join(tempDir, 'invalid.md'), 'Invalid content');

      const result = await storage.findById('any-id');
      expect(result).toBeNull();
    });

    it('should find correct file among multiple files', async () => {
      const content1 = `---
id: "id-1"
created_at: "2024-03-15T10:30:00Z"
updated_at: "2024-03-15T10:30:00Z"
tags: []
category: "general"
importance: 3
---

# File 1
`;
      const content2 = `---
id: "id-2"
created_at: "2024-03-15T10:30:00Z"
updated_at: "2024-03-15T10:30:00Z"
tags: []
category: "general"
importance: 3
---

# File 2
`;
      writeFileSync(join(tempDir, 'file1.md'), content1);
      writeFileSync(join(tempDir, 'file2.md'), content2);

      const result = await storage.findById('id-2');
      expect(result).toContain('file2.md');
    });
  });

  describe('delete edge cases', () => {
    it('should throw error when trying to delete non-existent memory', async () => {
      await expect(storage.delete('non-existent-id')).rejects.toThrow(StorageError);
    });
  });
});

describe('FrontMatterError', () => {
  it('should create error with message', () => {
    const error = new FrontMatterError('Test error');
    expect(error.message).toBe('Test error');
    expect(error.name).toBe('FrontMatterError');
  });

  it('should create error with cause', () => {
    const cause = new Error('Original error');
    const error = new FrontMatterError('Test error', cause);
    expect(error.cause).toBe(cause);
  });
});

describe('StorageError', () => {
  it('should create error with message', () => {
    const error = new StorageError('Test error');
    expect(error.message).toBe('Test error');
    expect(error.name).toBe('StorageError');
  });

  it('should create error with cause', () => {
    const cause = new Error('Original error');
    const error = new StorageError('Test error', cause);
    expect(error.cause).toBe(cause);
  });
});
