/**
 * Additional FrontMatter Parser Tests
 * For better branch coverage
 */

import { describe, it, expect } from 'vitest';
import {
  parseFrontMatter,
  stringifyFrontMatter,
  FrontMatterError,
} from '../src/storage/frontmatter-parser.js';
import type { MemoryFrontMatter } from '../src/contracts/types.js';

describe('parseFrontMatter additional branches', () => {
  it('should throw for invalid front matter format', () => {
    // Missing closing ---
    const markdown = '---\nid: "test"\n# Title\n\nContent';
    expect(() => parseFrontMatter(markdown)).toThrow(FrontMatterError);
  });

  it('should parse with Windows line endings', () => {
    const markdown = `---\r\nid: "550e8400-e29b-41d4-a716-446655440000"\r\ncreated_at: "2024-03-15T10:30:00Z"\r\nupdated_at: "2024-03-15T10:30:00Z"\r\ntags: []\r\ncategory: "general"\r\nimportance: 3\r\n---\r\n\r\n# Title\r\n\r\nContent`;

    const result = parseFrontMatter(markdown);
    expect(result.frontMatter.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(result.title).toBe('Title');
  });

  it('should handle front matter with extra whitespace', () => {
    const markdown = `---
  id: "550e8400-e29b-41d4-a716-446655440000"
  created_at: "2024-03-15T10:30:00Z"
  updated_at: "2024-03-15T10:30:00Z"
  tags: []
  category: "general"
  importance: 3
---

# Title

Content`;

    const result = parseFrontMatter(markdown);
    expect(result.frontMatter.id).toBe('550e8400-e29b-41d4-a716-446655440000');
  });
});

describe('stringifyFrontMatter additional branches', () => {
  const baseFrontMatter: MemoryFrontMatter = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    created_at: '2024-03-15T10:30:00Z',
    updated_at: '2024-03-15T10:30:00Z',
    tags: [],
    category: 'general',
    importance: 3,
  };

  it('should handle empty title', () => {
    const result = stringifyFrontMatter(baseFrontMatter, '', 'Content');
    expect(result).toContain('---');
    expect(result).toContain('Content');
  });

  it('should handle empty content', () => {
    const result = stringifyFrontMatter(baseFrontMatter, 'Title', '');
    expect(result).toContain('# Title');
  });

  it('should handle both empty title and content', () => {
    const result = stringifyFrontMatter(baseFrontMatter, '', '');
    expect(result).toContain('---');
    expect(result).toContain('id:');
  });

  it('should handle single tag', () => {
    const fm = { ...baseFrontMatter, tags: ['single'] };
    const result = stringifyFrontMatter(fm, 'Title', 'Content');
    expect(result).toContain('single');
  });

  it('should handle many tags', () => {
    const fm = { ...baseFrontMatter, tags: ['a', 'b', 'c', 'd', 'e'] };
    const result = stringifyFrontMatter(fm, 'Title', 'Content');
    expect(result).toContain('a');
    expect(result).toContain('e');
  });

  it('should end with single newline', () => {
    const result = stringifyFrontMatter(baseFrontMatter, 'Title', 'Content');
    const lines = result.split('\n');
    expect(lines[lines.length - 1]).toBe('');
    expect(lines[lines.length - 2]).not.toBe('');
  });
});
