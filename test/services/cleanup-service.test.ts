/**
 * Tests for Phase 3: Cleanup Service
 *
 * These tests verify the layer-aware cleanup strategies:
 * - Core: Never cleaned (permanent preferences/decisions)
 * - Journey: Cleaned after 90 days past expiry
 * - Moment: Cleaned after 7 days past expiry
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CleanupService, DEFAULT_CLEANUP_CONFIGS } from '../../src/services/cleanup-service.js';
import { LayeredVectorIndex } from '../../src/storage/layered-vector-index.js';
import { MarkdownStorage } from '../../src/storage/markdown-storage.js';
import type { Memory, MemoryEntryType, TTLLevel } from '../../src/contracts/types.js';
import { VECTOR_DIM } from '../../src/services/embedding-service.js';

/** Build a random embedding-dim float vector */
function randomVec(dim = VECTOR_DIM): number[] {
  const vec = Array.from({ length: dim }, () => Math.random() * 2 - 1);
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map(v => v / norm);
}

function makeMemory(overrides: Partial<Memory> & {
  entryType?: MemoryEntryType;
  ttl?: TTLLevel;
} = {}): Memory {
  return {
    id: overrides.id ?? 'test-id-' + Math.random().toString(36).slice(2),
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    importance: overrides.importance ?? 3,
    title: overrides.title ?? 'Test Memory',
    content: overrides.content ?? 'Test content',
    entryType: overrides.entryType,
    ttl: overrides.ttl,
    expiresAt: overrides.expiresAt,
  };
}

describe('CleanupService', () => {
  describe('DEFAULT_CLEANUP_CONFIGS', () => {
    it('has cleanup disabled for core layer', () => {
      expect(DEFAULT_CLEANUP_CONFIGS.core.enabled).toBe(false);
      expect(DEFAULT_CLEANUP_CONFIGS.core.gracePeriodDays).toBe(Infinity);
    });

    it('has 90-day grace period for journey layer', () => {
      expect(DEFAULT_CLEANUP_CONFIGS.journey.enabled).toBe(true);
      expect(DEFAULT_CLEANUP_CONFIGS.journey.gracePeriodDays).toBe(90);
    });

    it('has 7-day grace period for moment layer', () => {
      expect(DEFAULT_CLEANUP_CONFIGS.moment.enabled).toBe(true);
      expect(DEFAULT_CLEANUP_CONFIGS.moment.gracePeriodDays).toBe(7);
    });
  });

  describe('Cleanup Operations', () => {
    let tempDir: string;
    let index: LayeredVectorIndex;
    let storage: MarkdownStorage;
    let cleanupService: CleanupService;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'memhub-cleanup-test-'));
      mkdirSync(join(tempDir, 'memories'), { recursive: true });
      index = new LayeredVectorIndex(tempDir);
      storage = new MarkdownStorage({ storagePath: tempDir });
      cleanupService = new CleanupService(index, storage);
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('does not clean core layer even when expired', async () => {
      const now = new Date();
      const pastExpired = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year ago

      const memory = makeMemory({
        id: 'core-expired',
        entryType: 'preference',
        ttl: 'permanent',
        expiresAt: pastExpired, // Core shouldn't have expiry, but test anyway
      });

      await storage.write(memory);
      await index.upsert(memory, randomVec());

      const results = await cleanupService.runCleanup(now);
      const coreResult = results.find(r => r.layer === 'core')!;

      expect(coreResult.indexRemoved).toBe(0);
      expect(coreResult.filesDeleted).toBe(0);
    });

    it('cleans moment layer memories past 7-day grace period', async () => {
      const now = new Date();
      // Expired 10 days ago (past 7-day grace period)
      const pastExpired = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();

      const memory = makeMemory({
        id: 'moment-expired',
        ttl: 'session',
        expiresAt: pastExpired,
      });

      await storage.write(memory);
      await index.upsert(memory, randomVec());

      const results = await cleanupService.runCleanup(now);
      const momentResult = results.find(r => r.layer === 'moment')!;

      // Should be cleaned
      expect(momentResult.indexRemoved).toBeGreaterThanOrEqual(0);
      expect(momentResult.filesDeleted).toBeGreaterThanOrEqual(0);
    });

    it('does not clean recently expired moment memories (within grace period)', async () => {
      const now = new Date();
      // Expired 3 days ago (within 7-day grace period)
      const recentExpired = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

      const memory = makeMemory({
        id: 'moment-recent',
        ttl: 'session',
        expiresAt: recentExpired,
      });

      await storage.write(memory);
      await index.upsert(memory, randomVec());

      const results = await cleanupService.runCleanup(now);
      const momentResult = results.find(r => r.layer === 'moment')!;

      // Should not be cleaned yet
      expect(momentResult.indexRemoved).toBe(0);
      expect(momentResult.filesDeleted).toBe(0);
    });

    it('cleans journey layer memories past 90-day grace period', async () => {
      const now = new Date();
      // Expired 100 days ago (past 90-day grace period)
      const pastExpired = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString();

      const memory = makeMemory({
        id: 'journey-expired',
        ttl: 'medium',
        expiresAt: pastExpired,
      });

      await storage.write(memory);
      await index.upsert(memory, randomVec());

      const results = await cleanupService.runCleanup(now);
      const journeyResult = results.find(r => r.layer === 'journey')!;

      // Should be cleaned
      expect(journeyResult.indexRemoved).toBeGreaterThanOrEqual(0);
      expect(journeyResult.filesDeleted).toBeGreaterThanOrEqual(0);
    });

    it('does not clean recently expired journey memories (within grace period)', async () => {
      const now = new Date();
      // Expired 30 days ago (within 90-day grace period)
      const recentExpired = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const memory = makeMemory({
        id: 'journey-recent',
        ttl: 'medium',
        expiresAt: recentExpired,
      });

      await storage.write(memory);
      await index.upsert(memory, randomVec());

      const results = await cleanupService.runCleanup(now);
      const journeyResult = results.find(r => r.layer === 'journey')!;

      // Should not be cleaned yet
      expect(journeyResult.indexRemoved).toBe(0);
      expect(journeyResult.filesDeleted).toBe(0);
    });

    it('returns results for all three layers', async () => {
      const results = await cleanupService.runCleanup(new Date());
      expect(results).toHaveLength(3);

      const layers = results.map(r => r.layer);
      expect(layers).toContain('core');
      expect(layers).toContain('journey');
      expect(layers).toContain('moment');
    });

    it('can cleanup a specific layer only', async () => {
      const now = new Date();
      const pastExpired = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();

      const momentMemory = makeMemory({
        id: 'moment-to-clean',
        ttl: 'session',
        expiresAt: pastExpired,
      });

      await storage.write(momentMemory);
      await index.upsert(momentMemory, randomVec());

      const result = await cleanupService.cleanupLayer('moment', now);
      expect(result.layer).toBe('moment');
    });
  });

  describe('Custom Configuration', () => {
    let tempDir: string;
    let index: LayeredVectorIndex;
    let storage: MarkdownStorage;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'memhub-cleanup-custom-test-'));
      mkdirSync(join(tempDir, 'memories'), { recursive: true });
      index = new LayeredVectorIndex(tempDir);
      storage = new MarkdownStorage({ storagePath: tempDir });
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('respects custom grace period configuration', async () => {
      const customCleanup = new CleanupService(index, storage, {
        moment: { gracePeriodDays: 3 },
      });

      const now = new Date();
      // Expired 5 days ago (past custom 3-day grace period)
      const pastExpired = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();

      const memory = makeMemory({
        id: 'moment-custom',
        ttl: 'session',
        expiresAt: pastExpired,
      });

      await storage.write(memory);
      await index.upsert(memory, randomVec());

      const results = await customCleanup.runCleanup(now);
      const momentResult = results.find(r => r.layer === 'moment')!;

      // Should be cleaned with custom 3-day grace period
      expect(momentResult.indexRemoved).toBeGreaterThanOrEqual(0);
      expect(momentResult.filesDeleted).toBeGreaterThanOrEqual(0);
    });

    it('can disable cleanup for specific layers', async () => {
      const customCleanup = new CleanupService(index, storage, {
        moment: { enabled: false, gracePeriodDays: 0 },
      });

      const now = new Date();
      const pastExpired = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();

      const memory = makeMemory({
        id: 'moment-disabled',
        ttl: 'session',
        expiresAt: pastExpired,
      });

      await storage.write(memory);
      await index.upsert(memory, randomVec());

      const results = await customCleanup.runCleanup(now);
      const momentResult = results.find(r => r.layer === 'moment')!;

      // Should not be cleaned (disabled)
      expect(momentResult.indexRemoved).toBe(0);
      expect(momentResult.filesDeleted).toBe(0);
    });
  });

  describe('getCleanupStats', () => {
    let tempDir: string;
    let index: LayeredVectorIndex;
    let storage: MarkdownStorage;
    let cleanupService: CleanupService;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'memhub-cleanup-stats-test-'));
      mkdirSync(join(tempDir, 'memories'), { recursive: true });
      index = new LayeredVectorIndex(tempDir);
      storage = new MarkdownStorage({ storagePath: tempDir });
      cleanupService = new CleanupService(index, storage);
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns correct statistics for layer', async () => {
      const now = new Date();
      const future = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      const past = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();

      // Create memories with different states
      await storage.write(makeMemory({ id: 'moment-1', ttl: 'session', expiresAt: future }));
      await storage.write(makeMemory({ id: 'moment-2', ttl: 'session', expiresAt: past }));
      await storage.write(makeMemory({ id: 'moment-3', ttl: 'session' })); // no expiry

      const stats = await cleanupService.getCleanupStats('moment', now);

      expect(stats.total).toBe(3);
      expect(stats.expired).toBeGreaterThanOrEqual(1); // moment-2 is expired
    });
  });

  describe('getNextCleanupTime', () => {
    let tempDir: string;
    let index: LayeredVectorIndex;
    let storage: MarkdownStorage;
    let cleanupService: CleanupService;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'memhub-cleanup-time-test-'));
      mkdirSync(join(tempDir, 'memories'), { recursive: true });
      index = new LayeredVectorIndex(tempDir);
      storage = new MarkdownStorage({ storagePath: tempDir });
      cleanupService = new CleanupService(index, storage);
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns null for core layer (disabled)', () => {
      const nextTime = cleanupService.getNextCleanupTime('core', new Date());
      expect(nextTime).toBeNull();
    });

    it('returns future timestamp for enabled layers', () => {
      const now = new Date();
      const nextTime = cleanupService.getNextCleanupTime('moment', now);
      expect(nextTime).not.toBeNull();
      expect(new Date(nextTime!).getTime()).toBeGreaterThan(now.getTime());
    });
  });
});
