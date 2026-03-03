/**
 * Schema validation tests - RED phase (TDD)
 * These tests define the expected behavior of Zod schemas
 * They will fail until implementations are written
 */

import { describe, it, expect } from 'vitest';
import {
  UUIDSchema,
  ISO8601TimestampSchema,
  TagSchema,
  CategorySchema,
  ImportanceSchema,
  MemorySchema,
  CreateMemoryInputSchema,
  ReadMemoryInputSchema,
  UpdateMemoryInputSchema,
  DeleteMemoryInputSchema,
  ListMemoryInputSchema,
  SearchMemoryInputSchema,
} from '../../src/contracts/schemas.js';

describe('Schema Validation', () => {
  describe('UUIDSchema', () => {
    it('should accept valid UUID v4', () => {
      const validUuid = '550e8400-e29b-41d4-a716-446655440000';
      expect(UUIDSchema.safeParse(validUuid).success).toBe(true);
    });

    it('should reject invalid UUID format', () => {
      const invalidUuid = 'not-a-uuid';
      expect(UUIDSchema.safeParse(invalidUuid).success).toBe(false);
    });

    it('should reject empty string', () => {
      expect(UUIDSchema.safeParse('').success).toBe(false);
    });
  });

  describe('ISO8601TimestampSchema', () => {
    it('should accept valid ISO 8601 timestamp', () => {
      const validTimestamp = '2024-03-15T10:30:00Z';
      expect(ISO8601TimestampSchema.safeParse(validTimestamp).success).toBe(true);
    });

    it('should reject invalid timestamp format', () => {
      const invalidTimestamp = '2024-03-15';
      expect(ISO8601TimestampSchema.safeParse(invalidTimestamp).success).toBe(false);
    });

    it('should reject non-ISO date strings', () => {
      const nonIsoDate = 'March 15, 2024';
      expect(ISO8601TimestampSchema.safeParse(nonIsoDate).success).toBe(false);
    });
  });

  describe('TagSchema', () => {
    it('should accept valid tag with lowercase letters and hyphens', () => {
      expect(TagSchema.safeParse('project-management').success).toBe(true);
    });

    it('should accept tag with numbers', () => {
      expect(TagSchema.safeParse('task-123').success).toBe(true);
    });

    it('should reject uppercase letters', () => {
      expect(TagSchema.safeParse('Project').success).toBe(false);
    });

    it('should reject spaces', () => {
      expect(TagSchema.safeParse('project management').success).toBe(false);
    });

    it('should reject special characters', () => {
      expect(TagSchema.safeParse('project@work').success).toBe(false);
    });

    it('should reject empty string', () => {
      expect(TagSchema.safeParse('').success).toBe(false);
    });

    it('should reject tags over 50 characters', () => {
      const longTag = 'a'.repeat(51);
      expect(TagSchema.safeParse(longTag).success).toBe(false);
    });
  });

  describe('CategorySchema', () => {
    it('should accept valid category', () => {
      expect(CategorySchema.safeParse('work').success).toBe(true);
    });

    it('should reject uppercase letters', () => {
      expect(CategorySchema.safeParse('Work').success).toBe(false);
    });

    it('should reject empty string', () => {
      expect(CategorySchema.safeParse('').success).toBe(false);
    });
  });

  describe('ImportanceSchema', () => {
    it('should accept importance level 1', () => {
      expect(ImportanceSchema.safeParse(1).success).toBe(true);
    });

    it('should accept importance level 5', () => {
      expect(ImportanceSchema.safeParse(5).success).toBe(true);
    });

    it('should reject level 0', () => {
      expect(ImportanceSchema.safeParse(0).success).toBe(false);
    });

    it('should reject level 6', () => {
      expect(ImportanceSchema.safeParse(6).success).toBe(false);
    });

    it('should reject non-integer values', () => {
      expect(ImportanceSchema.safeParse(3.5).success).toBe(false);
    });
  });

  describe('MemorySchema', () => {
    const validMemory = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2024-03-15T10:30:00Z',
      updatedAt: '2024-03-15T10:30:00Z',
      tags: ['work', 'project'],
      category: 'general',
      importance: 3,
      title: 'Test Memory',
      content: 'This is test content',
    };

    it('should accept valid memory object', () => {
      expect(MemorySchema.safeParse(validMemory).success).toBe(true);
    });

    it('should reject memory with invalid UUID', () => {
      const invalid = { ...validMemory, id: 'invalid-uuid' };
      expect(MemorySchema.safeParse(invalid).success).toBe(false);
    });

    it('should reject memory with invalid timestamp', () => {
      const invalid = { ...validMemory, createdAt: 'invalid-date' };
      expect(MemorySchema.safeParse(invalid).success).toBe(false);
    });

    it('should reject memory with empty title', () => {
      const invalid = { ...validMemory, title: '' };
      expect(MemorySchema.safeParse(invalid).success).toBe(false);
    });

    it('should reject memory with title over 200 characters', () => {
      const invalid = { ...validMemory, title: 'a'.repeat(201) };
      expect(MemorySchema.safeParse(invalid).success).toBe(false);
    });

    it('should reject memory with content over 100000 characters', () => {
      const invalid = { ...validMemory, content: 'a'.repeat(100001) };
      expect(MemorySchema.safeParse(invalid).success).toBe(false);
    });

    it('should reject memory with invalid importance', () => {
      const invalid = { ...validMemory, importance: 10 };
      expect(MemorySchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('CreateMemoryInputSchema', () => {
    it('should accept valid create input', () => {
      const input = {
        title: 'New Memory',
        content: 'Content here',
      };
      expect(CreateMemoryInputSchema.safeParse(input).success).toBe(true);
    });

    it('should accept input with optional fields', () => {
      const input = {
        title: 'New Memory',
        content: 'Content here',
        tags: ['tag1', 'tag2'],
        category: 'work',
        importance: 4,
      };
      expect(CreateMemoryInputSchema.safeParse(input).success).toBe(true);
    });

    it('should reject missing title', () => {
      const input = { content: 'Content here' };
      expect(CreateMemoryInputSchema.safeParse(input).success).toBe(false);
    });

    it('should reject missing content', () => {
      const input = { title: 'New Memory' };
      expect(CreateMemoryInputSchema.safeParse(input).success).toBe(false);
    });

    it('should apply default values for optional fields', () => {
      const input = {
        title: 'New Memory',
        content: 'Content here',
      };
      const result = CreateMemoryInputSchema.parse(input);
      expect(result.tags).toEqual([]);
      expect(result.category).toBe('general');
      expect(result.importance).toBe(3);
    });
  });

  describe('ReadMemoryInputSchema', () => {
    it('should accept valid read input', () => {
      const input = { id: '550e8400-e29b-41d4-a716-446655440000' };
      expect(ReadMemoryInputSchema.safeParse(input).success).toBe(true);
    });

    it('should reject invalid UUID', () => {
      const input = { id: 'invalid-uuid' };
      expect(ReadMemoryInputSchema.safeParse(input).success).toBe(false);
    });
  });

  describe('UpdateMemoryInputSchema', () => {
    it('should accept valid update input with ID only', () => {
      const input = { id: '550e8400-e29b-41d4-a716-446655440000' };
      expect(UpdateMemoryInputSchema.safeParse(input).success).toBe(true);
    });

    it('should accept update with partial fields', () => {
      const input = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        title: 'Updated Title',
      };
      expect(UpdateMemoryInputSchema.safeParse(input).success).toBe(true);
    });

    it('should reject missing ID', () => {
      const input = { title: 'Updated Title' };
      expect(UpdateMemoryInputSchema.safeParse(input).success).toBe(false);
    });
  });

  describe('DeleteMemoryInputSchema', () => {
    it('should accept valid delete input', () => {
      const input = { id: '550e8400-e29b-41d4-a716-446655440000' };
      expect(DeleteMemoryInputSchema.safeParse(input).success).toBe(true);
    });

    it('should reject invalid UUID', () => {
      const input = { id: 'invalid' };
      expect(DeleteMemoryInputSchema.safeParse(input).success).toBe(false);
    });
  });

  describe('ListMemoryInputSchema', () => {
    it('should accept empty list input', () => {
      expect(ListMemoryInputSchema.safeParse({}).success).toBe(true);
    });

    it('should accept input with all filters', () => {
      const input = {
        category: 'work',
        tags: ['project'],
        fromDate: '2024-01-01T00:00:00Z',
        toDate: '2024-12-31T23:59:59Z',
        limit: 50,
        offset: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      };
      expect(ListMemoryInputSchema.safeParse(input).success).toBe(true);
    });

    it('should reject limit over 100', () => {
      const input = { limit: 101 };
      expect(ListMemoryInputSchema.safeParse(input).success).toBe(false);
    });

    it('should reject negative offset', () => {
      const input = { offset: -1 };
      expect(ListMemoryInputSchema.safeParse(input).success).toBe(false);
    });
  });

  describe('SearchMemoryInputSchema', () => {
    it('should accept valid search input', () => {
      const input = { query: 'search term' };
      expect(SearchMemoryInputSchema.safeParse(input).success).toBe(true);
    });

    it('should reject empty query', () => {
      const input = { query: '' };
      expect(SearchMemoryInputSchema.safeParse(input).success).toBe(false);
    });

    it('should reject query over 1000 characters', () => {
      const input = { query: 'a'.repeat(1001) };
      expect(SearchMemoryInputSchema.safeParse(input).success).toBe(false);
    });

    it('should accept search with filters', () => {
      const input = {
        query: 'project',
        limit: 20,
        category: 'work',
        tags: ['important'],
      };
      expect(SearchMemoryInputSchema.safeParse(input).success).toBe(true);
    });
  });
});
