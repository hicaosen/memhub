/**
 * Slugify Edge Case Tests
 * Additional tests for better coverage
 */

import { describe, it, expect } from 'vitest';
import { slugify, generateUniqueSlug } from '../../src/utils/slugify.js';

describe('slugify edge cases', () => {
  it('should handle whitespace-only string', () => {
    expect(slugify('   ')).toBe('untitled');
  });

  it('should handle multiple consecutive spaces', () => {
    expect(slugify('hello    world')).toBe('hello-world');
  });

  it('should handle string with only special characters', () => {
    expect(slugify('!@#$%^&*()')).toBe('untitled');
  });

  it('should handle mixed alphanumeric with special chars', () => {
    expect(slugify('hello123!@#world456')).toBe('hello123world456');
  });

  it('should handle string starting with numbers', () => {
    expect(slugify('123hello')).toBe('123hello');
  });

  it('should handle very short string', () => {
    expect(slugify('a')).toBe('a');
  });

  it('should handle string at exactly max length', () => {
    const input = 'a'.repeat(100);
    expect(slugify(input)).toBe(input);
  });

  it('should handle string just over max length', () => {
    const input = 'a'.repeat(101);
    expect(slugify(input).length).toBeLessThanOrEqual(100);
  });

  it('should handle string with hyphens at boundaries', () => {
    expect(slugify('-hello-world-')).toBe('hello-world');
  });

  it('should handle string with multiple consecutive hyphens after cleaning', () => {
    expect(slugify('hello---world')).toBe('hello-world');
  });

  it('should handle null-like empty string', () => {
    expect(slugify('')).toBe('untitled');
  });

  it('should preserve numbers in slug', () => {
    expect(slugify('version 2.0 release')).toBe('version-20-release');
  });
});

describe('generateUniqueSlug edge cases', () => {
  it('should handle empty existing slugs array', () => {
    const result = generateUniqueSlug('test', []);
    expect(result).toBe('test');
  });

  it('should handle when base slug plus counter would exceed limit', () => {
    const longBase = 'a'.repeat(98);
    const existing = [longBase];
    const result = generateUniqueSlug(longBase, existing);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toMatch(/^a+-\d+$/);
  });

  it('should handle multiple conflicts', () => {
    const existing = ['test', 'test-1', 'test-2', 'test-3'];
    const result = generateUniqueSlug('test', existing);
    expect(result).toBe('test-4');
  });

  it('should handle slug that looks like a numbered conflict', () => {
    const existing = ['test-1'];
    // 'test' is not in existing, so it should return 'test'
    const result = generateUniqueSlug('test', existing);
    expect(result).toBe('test');
  });

  it('should handle case sensitivity', () => {
    const existing = ['Test'];
    const result = generateUniqueSlug('test', existing);
    // Should not conflict because 'test' !== 'Test'
    expect(result).toBe('test');
  });
});
