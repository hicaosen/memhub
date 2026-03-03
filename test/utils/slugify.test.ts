/**
 * Slugify Utility Tests
 * Tests for the slug generation utility
 */

import { describe, it, expect } from 'vitest';
import { slugify, generateUniqueSlug } from '../../src/utils/slugify.js';

describe('slugify', () => {
  it('should convert to lowercase', () => {
    expect(slugify('HELLO')).toBe('hello');
  });

  it('should replace spaces with hyphens', () => {
    expect(slugify('hello world')).toBe('hello-world');
  });

  it('should remove special characters', () => {
    expect(slugify('hello!@#world')).toBe('helloworld');
  });

  it('should collapse multiple hyphens', () => {
    expect(slugify('hello---world')).toBe('hello-world');
  });

  it('should trim leading/trailing hyphens', () => {
    expect(slugify('-hello-world-')).toBe('hello-world');
  });

  it('should handle empty string', () => {
    expect(slugify('')).toBe('untitled');
  });

  it('should handle strings that become empty after cleaning', () => {
    expect(slugify('!@#$%')).toBe('untitled');
  });

  it('should truncate to max length', () => {
    const long = 'a'.repeat(200);
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('should handle Chinese characters', () => {
    expect(slugify('你好世界')).toMatch(/^[a-z0-9-]*$/);
  });

  it('should handle mixed content', () => {
    expect(slugify('Hello 世界! World')).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('generateUniqueSlug', () => {
  it('should return same slug when no conflicts', () => {
    const result = generateUniqueSlug('hello world', []);
    expect(result).toBe('hello-world');
  });

  it('should append counter when slug exists', () => {
    const result = generateUniqueSlug('hello world', ['hello-world']);
    expect(result).toBe('hello-world-1');
  });

  it('should increment counter until unique', () => {
    const result = generateUniqueSlug('hello world', ['hello-world', 'hello-world-1', 'hello-world-2']);
    expect(result).toBe('hello-world-3');
  });
});
