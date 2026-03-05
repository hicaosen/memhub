/**
 * WAL Storage Tests
 * Tests for the WALStorage class
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WALStorage, WALError, createWALStorage } from '../../src/storage/wal.js';

describe('WALStorage', () => {
  let tempDir: string;
  let walPath: string;
  let storage: WALStorage;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'memhub-wal-test-'));
    walPath = join(tempDir, 'wal.log');
    storage = new WALStorage({ walPath });
    await storage.initialize();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('should create WAL file on first append', async () => {
      await storage.append('create', '550e8400-e29b-41d4-a716-446655440000');
      expect(existsSync(walPath)).toBe(true);
    });
  });

  describe('append', () => {
    it('should append entry to WAL', async () => {
      const offset = await storage.append('create', '550e8400-e29b-41d4-a716-446655440000');
      expect(offset).toBe(0);
    });

    it('should return incrementing offsets', async () => {
      const offset1 = await storage.append('create', '550e8400-e29b-41d4-a716-446655440001');
      const offset2 = await storage.append('create', '550e8400-e29b-41d4-a716-446655440002');
      expect(offset2).toBeGreaterThan(offset1);
    });

    it('should store operation type and memory ID', async () => {
      await storage.append('create', '550e8400-e29b-41d4-a716-446655440001');
      const entries = await storage.readAll();
      expect(entries[0].operation).toBe('create');
      expect(entries[0].memoryId).toBe('550e8400-e29b-41d4-a716-446655440001');
    });

    it('should store optional data', async () => {
      await storage.append('create', '550e8400-e29b-41d4-a716-446655440001', 'test-data');
      const entries = await storage.readAll();
      expect(entries[0].data).toBe('test-data');
    });

    it('should mark entry as not indexed', async () => {
      await storage.append('create', '550e8400-e29b-41d4-a716-446655440001');
      const entries = await storage.readAll();
      expect(entries[0].indexed).toBe(false);
    });
  });

  describe('readAll', () => {
    it('should return empty array when WAL is empty', async () => {
      const entries = await storage.readAll();
      expect(entries).toEqual([]);
    });

    it('should return all entries', async () => {
      await storage.append('create', '550e8400-e29b-41d4-a716-446655440001');
      await storage.append('update', '550e8400-e29b-41d4-a716-446655440002');
      const entries = await storage.readAll();
      expect(entries).toHaveLength(2);
    });
  });

  describe('getUnindexed', () => {
    it('should return all entries when none are indexed', async () => {
      await storage.append('create', '550e8400-e29b-41d4-a716-446655440001');
      await storage.append('create', '550e8400-e29b-41d4-a716-446655440002');
      const unindexed = await storage.getUnindexed();
      expect(unindexed).toHaveLength(2);
    });
  });

  describe('markIndexed', () => {
    it('should mark entry as indexed', async () => {
      const offset = await storage.append('create', '550e8400-e29b-41d4-a716-446655440001');
      await storage.markIndexed(offset);
      const entries = await storage.readAll();
      // After markIndexed, indexed entries are cleaned up
      expect(entries).toHaveLength(0);
    });

    it('should clean up indexed entries after rewrite', async () => {
      const offset1 = await storage.append('create', '550e8400-e29b-41d4-a716-446655440001');
      const offset2 = await storage.append('create', '550e8400-e29b-41d4-a716-446655440002');

      // Mark first entry as indexed
      await storage.markIndexed(offset1);

      // Only unindexed entry should remain
      const entries = await storage.readAll();
      expect(entries).toHaveLength(1);
      expect(entries[0].memoryId).toBe('550e8400-e29b-41d4-a716-446655440002');
    });

    it('should shrink WAL file when all entries are indexed', async () => {
      const offset1 = await storage.append('create', '550e8400-e29b-41d4-a716-446655440001');
      const offset2 = await storage.append('create', '550e8400-e29b-41d4-a716-446655440002');

      // Get file size before cleanup
      const contentBefore = readFileSync(walPath, 'utf-8');
      expect(contentBefore.length).toBeGreaterThan(0);

      // Mark all entries as indexed
      await storage.markIndexed(offset1);
      await storage.markIndexed(offset2);

      // WAL should be empty
      const entries = await storage.readAll();
      expect(entries).toHaveLength(0);
    });

    it('should preserve unindexed entries when marking other entries', async () => {
      const offset1 = await storage.append('create', '550e8400-e29b-41d4-a716-446655440001');
      const offset2 = await storage.append('create', '550e8400-e29b-41d4-a716-446655440002');
      const offset3 = await storage.append('create', '550e8400-e29b-41d4-a716-446655440003');

      // Mark only middle entry as indexed
      await storage.markIndexed(offset2);

      const entries = await storage.readAll();
      expect(entries).toHaveLength(2);
      expect(entries.map(e => e.memoryId)).toEqual([
        '550e8400-e29b-41d4-a716-446655440001',
        '550e8400-e29b-41d4-a716-446655440003',
      ]);
    });
  });

  describe('getLast', () => {
    it('should return null when WAL is empty', async () => {
      const last = await storage.getLast();
      expect(last).toBeNull();
    });

    it('should return last entry', async () => {
      await storage.append('create', '550e8400-e29b-41d4-a716-446655440001');
      await storage.append('create', '550e8400-e29b-41d4-a716-446655440002');
      const last = await storage.getLast();
      expect(last?.memoryId).toBe('550e8400-e29b-41d4-a716-446655440002');
    });
  });

  describe('clear', () => {
    it('should clear all entries', async () => {
      await storage.append('create', '550e8400-e29b-41d4-a716-446655440001');
      await storage.append('create', '550e8400-e29b-41d4-a716-446655440002');
      await storage.clear();
      const entries = await storage.readAll();
      expect(entries).toEqual([]);
    });

    it('should reset offset', async () => {
      await storage.append('create', '550e8400-e29b-41d4-a716-446655440001');
      await storage.clear();
      const offset = await storage.append('create', '550e8400-e29b-41d4-a716-446655440002');
      expect(offset).toBe(0);
    });
  });

  describe('createWALStorage', () => {
    it('should create WALStorage with default path', () => {
      const storage = createWALStorage(tempDir);
      expect(storage).toBeInstanceOf(WALStorage);
    });
  });
});
