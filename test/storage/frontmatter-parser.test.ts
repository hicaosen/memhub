/**
 * FrontMatter Parser Tests
 * Tests for the FrontMatter parser
 */

import { describe, it, expect } from 'vitest';
import {
  parseFrontMatter,
  stringifyFrontMatter,
  memoryToFrontMatter,
  frontMatterToMemory,
  FrontMatterError,
} from '../../src/storage/frontmatter-parser.js';
import type { Memory, MemoryFrontMatter } from '../../src/contracts/types.js';

describe('parseFrontMatter', () => {
  it('should parse valid front matter and content', () => {
    const markdown = `---
id: "550e8400-e29b-41d4-a716-446655440000"
created_at: "2024-03-15T10:30:00Z"
updated_at: "2024-03-15T14:20:00Z"
tags:
  - project
  - meeting
category: "work"
importance: 4
---

# Project Meeting

This is the meeting content.

## Action Items

- Item 1
- Item 2
`;

    const result = parseFrontMatter(markdown);
    expect(result.frontMatter.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(result.frontMatter.category).toBe('work');
    expect(result.frontMatter.importance).toBe(4);
    expect(result.title).toBe('Project Meeting');
    expect(result.content).toContain('Action Items');
  });

  it('should parse front matter with empty tags', () => {
    const markdown = `---
id: "550e8400-e29b-41d4-a716-446655440000"
created_at: "2024-03-15T10:30:00Z"
updated_at: "2024-03-15T10:30:00Z"
tags: []
category: "general"
importance: 3
---

# Empty Tags Test

Content here.
`;

    const result = parseFrontMatter(markdown);
    expect(result.frontMatter.tags).toEqual([]);
  });

  it('should throw error for missing front matter', () => {
    const markdown = `# No Front Matter

This markdown has no front matter.
`;

    expect(() => parseFrontMatter(markdown)).toThrow(FrontMatterError);
    expect(() => parseFrontMatter(markdown)).toThrow('Missing front matter delimiter');
  });

  it('should throw error for invalid YAML', () => {
    const markdown = `---
id: "550e8400-e29b-41d4-a716-446655440000"
created_at: [invalid yaml
---

# Title

Content.
`;

    expect(() => parseFrontMatter(markdown)).toThrow(FrontMatterError);
  });

  it('should throw error for missing required fields', () => {
    const markdown = `---
id: "550e8400-e29b-41d4-a716-446655440000"
---

# Title

Content.
`;

    expect(() => parseFrontMatter(markdown)).toThrow(FrontMatterError);
    expect(() => parseFrontMatter(markdown)).toThrow('Missing required fields');
  });

  it('should handle multiline content correctly', () => {
    const markdown = `---
id: "550e8400-e29b-41d4-a716-446655440000"
created_at: "2024-03-15T10:30:00Z"
updated_at: "2024-03-15T10:30:00Z"
tags: []
category: "general"
importance: 3
---

# Title

Line 1
Line 2

Line 3 after blank
`;

    const result = parseFrontMatter(markdown);
    expect(result.content).toContain('Line 1');
    expect(result.content).toContain('Line 3 after blank');
  });
});

describe('stringifyFrontMatter', () => {
  const frontMatter: MemoryFrontMatter = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    created_at: '2024-03-15T10:30:00Z',
    updated_at: '2024-03-15T14:20:00Z',
    tags: ['project', 'meeting'],
    category: 'work',
    importance: 4,
  };

  it('should stringify front matter and content', () => {
    const result = stringifyFrontMatter(frontMatter, 'Title', 'Content here');
    expect(result).toContain('---');
    expect(result).toContain('id: "550e8400-e29b-41d4-a716-446655440000"');
    expect(result).toContain('# Title');
    expect(result).toContain('Content here');
  });

  it('should format tags as YAML array', () => {
    const result = stringifyFrontMatter(frontMatter, 'Title', 'Content');
    expect(result).toContain('tags:');
    expect(result).toContain('project');
    expect(result).toContain('meeting');
  });

  it('should use LF line endings', () => {
    const result = stringifyFrontMatter(frontMatter, 'Title', 'Content');
    expect(result).not.toContain('\r\n');
    expect(result).toContain('\n');
  });

  it('should add blank line between front matter and content', () => {
    const result = stringifyFrontMatter(frontMatter, 'Title', 'Content');
    expect(result).toMatch(/---\n\n# Title/);
  });

  it('should handle empty tags', () => {
    const fmWithEmptyTags: MemoryFrontMatter = { ...frontMatter, tags: [] };
    const result = stringifyFrontMatter(fmWithEmptyTags, 'Title', 'Content');
    expect(result).toContain('tags: []');
  });

  it('should handle multiline content', () => {
    const content = 'Line 1\n\nLine 2\n\nLine 3';
    const result = stringifyFrontMatter(frontMatter, 'Title', content);
    expect(result).toContain('Line 1');
    expect(result).toContain('Line 2');
    expect(result).toContain('Line 3');
  });
});

describe('memoryToFrontMatter', () => {
  it('should convert Memory to MemoryFrontMatter', () => {
    const memory: Memory = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2024-03-15T10:30:00Z',
      updatedAt: '2024-03-15T14:20:00Z',
      tags: ['test'],
      category: 'work',
      importance: 3,
      title: 'Test',
      content: 'Content',
    };

    const result = memoryToFrontMatter(memory);
    expect(result.id).toBe(memory.id);
    expect(result.created_at).toBe(memory.createdAt);
    expect(result.updated_at).toBe(memory.updatedAt);
    expect(result.tags).toEqual(memory.tags);
    expect(result.category).toBe(memory.category);
    expect(result.importance).toBe(memory.importance);
  });
});

describe('frontMatterToMemory', () => {
  it('should convert MemoryFrontMatter to Memory', () => {
    const fm: MemoryFrontMatter = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      created_at: '2024-03-15T10:30:00Z',
      updated_at: '2024-03-15T14:20:00Z',
      tags: ['test'],
      category: 'work',
      importance: 3,
    };

    const result = frontMatterToMemory(fm, 'Title', 'Content');
    expect(result.id).toBe(fm.id);
    expect(result.createdAt).toBe(fm.created_at);
    expect(result.updatedAt).toBe(fm.updated_at);
    expect(result.tags).toEqual(fm.tags);
    expect(result.category).toBe(fm.category);
    expect(result.importance).toBe(fm.importance);
    expect(result.title).toBe('Title');
    expect(result.content).toBe('Content');
  });
});
