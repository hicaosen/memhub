/**
 * Tests for ArchiveService
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, access, constants } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

import { ArchiveService } from '../../src/services/archive-service.js';
import { MarkdownStorage } from '../../src/storage/markdown-storage.js';
import { LayeredVectorIndex } from '../../src/storage/layered-vector-index.js';
import type { Memory } from '../../src/contracts/types.js';

function createMockMemory(overrides: Partial<Memory> = {}): Memory {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    importance: 3,
    title: 'Test Memory',
    content: 'This is test content for the memory.',
    ...overrides,
  };
}

async function createTestEnv() {
  const testDir = join(tmpdir(), `memhub-archive-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
  await mkdir(join(testDir, 'memories'), { recursive: true });
  await mkdir(join(testDir, 'archive'), { recursive: true });

  const storage = new MarkdownStorage({ storagePath: testDir });
  const index = new LayeredVectorIndex(testDir);
  await index.initialize();
  const archiveService = new ArchiveService(storage, index, testDir);
  return { testDir, storage, index, archiveService };
}

async function cleanupTestEnv(testDir: string) {
  try {
    await rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('ArchiveService', () => {
  let testDir: string;
  let storage: MarkdownStorage;
  let archiveService: ArchiveService;

  beforeEach(async () => {
    const env = await createTestEnv();
    testDir = env.testDir;
    storage = env.storage;
    archiveService = env.archiveService;
  });

  afterEach(async () => {
    await cleanupTestEnv(testDir);
  });

  describe('archive', () => {
    it('should archive a memory successfully', async () => {
      const memory = createMockMemory({
        entryType: 'session',
        ttl: 'short',
      });
      await storage.write(memory);
      const result = await archiveService.archive(memory.id, { reason: 'test' });
      expect(result.success).toBe(true);
      expect(result.archivePath).toBeDefined();
      expect(result.archivePath).toContain('archive');
    });

    it('should fail to archive non-existent memory', async () => {
      const result = await archiveService.archive('non-existent-id');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should remove memory from storage after archiving', async () => {
      const memory = createMockMemory();
      await storage.write(memory);
      // Verify it exists
      const readResult = await storage.read(memory.id);
      expect(readResult).toBeDefined();
      // Archive it
      await archiveService.archive(memory.id);
      // Should no longer be in storage
      await expect(storage.read(memory.id)).rejects.toThrow('Memory not found');
    });

    it('should create archive directory if needed', async () => {
      const memory = createMockMemory();
      await storage.write(memory);
      await archiveService.archive(memory.id);
      // Verify archive directory exists
      const archivePath = join(testDir, 'archive');
      await expect(access(archivePath, constants.F_OK)).resolves.toBeUndefined();
    });
  });

  describe('restore', () => {
    it('should restore an archived memory', async () => {
      const memory = createMockMemory({
        entryType: 'session',
        ttl: 'short',
      });
      await storage.write(memory);
      await archiveService.archive(memory.id);
      const result = await archiveService.restore(memory.id);
      expect(result.success).toBe(true);
      expect(result.memory).toBeDefined();
      expect(result.memory!.id).toBe(memory.id);
    });

    it('should fail to restore non-archived memory', async () => {
      const result = await archiveService.restore('non-existent-id');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should apply new TTL on restore', async () => {
      const memory = createMockMemory({
        entryType: 'session',
        ttl: 'short',
      });
      await storage.write(memory);
      await archiveService.archive(memory.id);
      const result = await archiveService.restore(memory.id, { newTTL: 'medium' });
      expect(result.success).toBe(true);
      expect(result.memory!.ttl).toBe('medium');
    });

    it('should remove archived file after restore', async () => {
      const memory = createMockMemory();
      await storage.write(memory);
      await archiveService.archive(memory.id);
      // Verify archived
      const isArchived = await archiveService.isArchived(memory.id);
      expect(isArchived).toBe(true);
      // Restore
      await archiveService.restore(memory.id);
      // Should no longer be in archive
      const stillArchived = await archiveService.isArchived(memory.id);
      expect(stillArchived).toBe(false);
    });
  });

  describe('listArchived', () => {
    it('should list archived memories', async () => {
      // Create memories with different timestamps to avoid file name collision
      const memory1 = createMockMemory({
        createdAt: '2026-03-06T10:00:00.000Z',
        updatedAt: '2026-03-06T10:00:00.000Z',
      });
      const memory2 = createMockMemory({
        createdAt: '2026-03-06T11:00:00.000Z',
        updatedAt: '2026-03-06T11:00:00.000Z',
      });
      await storage.write(memory1);
      await storage.write(memory2);
      await archiveService.archive(memory1.id);
      await archiveService.archive(memory2.id);
      const archived = await archiveService.listArchived();
      expect(archived.length).toBe(2);
      expect(archived.map(a => a.id)).toContain(memory1.id);
      expect(archived.map(a => a.id)).toContain(memory2.id);
    });

    it('should include previous layer in archived metadata', async () => {
      const memory = createMockMemory({
        entryType: 'preference',
        ttl: 'medium', // Journey layer
      });
      await storage.write(memory);
      await archiveService.archive(memory.id);
      const archived = await archiveService.listArchived();
      expect(archived[0].previousLayer).toBe('journey');
    });
  });

  describe('isArchived', () => {
    it('should return true for archived memory', async () => {
      const memory = createMockMemory();
      await storage.write(memory);
      await archiveService.archive(memory.id);
      const isArchived = await archiveService.isArchived(memory.id);
      expect(isArchived).toBe(true);
    });

    it('should return false for non-archived memory', async () => {
      const isArchived = await archiveService.isArchived('non-existent');
      expect(isArchived).toBe(false);
    });
  });

  describe('readArchived', () => {
    it('should read archived memory by ID', async () => {
      const memory = createMockMemory({
        title: 'Archived Memory',
        content: 'This was archived',
      });
      await storage.write(memory);
      await archiveService.archive(memory.id);
      const archived = await archiveService.readArchived(memory.id);
      expect(archived).toBeDefined();
      expect(archived!.id).toBe(memory.id);
      expect(archived!.memory.title).toBe('Archived Memory');
      expect(archived!.previousLayer).toBeDefined();
      expect(archived!.archivedAt).toBeDefined();
    });

    it('should return undefined for non-archived memory', async () => {
      const archived = await archiveService.readArchived('non-existent');
      expect(archived).toBeUndefined();
    });
  });

  describe('deleteArchived', () => {
    it('should permanently delete archived memory', async () => {
      const memory = createMockMemory();
      await storage.write(memory);
      await archiveService.archive(memory.id);
      // Verify archived
      expect(await archiveService.isArchived(memory.id)).toBe(true);
      // Delete permanently
      const result = await archiveService.deleteArchived(memory.id);
      expect(result).toBe(true);
      // Should no longer exist
      expect(await archiveService.isArchived(memory.id)).toBe(false);
    });

    it('should return false when deleting non-existent', async () => {
      const result = await archiveService.deleteArchived('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('count', () => {
    it('should count archived memories', async () => {
      // Use different timestamps to avoid file name collision
      const memory1 = createMockMemory({
        createdAt: '2026-03-06T10:00:00.000Z',
        updatedAt: '2026-03-06T10:00:00.000Z',
      });
      const memory2 = createMockMemory({
        createdAt: '2026-03-06T11:00:00.000Z',
        updatedAt: '2026-03-06T11:00:00.000Z',
      });
      await storage.write(memory1);
      await storage.write(memory2);
      expect(await archiveService.count()).toBe(0);
      await archiveService.archive(memory1.id);
      expect(await archiveService.count()).toBe(1);
      await archiveService.archive(memory2.id);
      expect(await archiveService.count()).toBe(2);
    });

    it('should return 0 when archive is empty', async () => {
      expect(await archiveService.count()).toBe(0);
    });
  });
});
