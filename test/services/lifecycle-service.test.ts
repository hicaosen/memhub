/**
 * Tests for LifecycleService
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LifecycleService, DEFAULT_LIFECYCLE_CONFIG, type LifecycleAction } from '../../src/services/lifecycle-service.js';
import type { Memory } from '../../src/contracts/types.js';

function createMockMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'test-id-123',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    importance: 3,
    title: 'Test Memory',
    content: 'Test content',
    ...overrides,
  };
}

describe('LifecycleService', () => {
  let service: LifecycleService;

  beforeEach(() => {
    service = new LifecycleService();
  });

  describe('recordAccess and getAccessStats', () => {
    it('should record first access', () => {
      service.recordAccess('memory-1');

      const stats = service.getAccessStats('memory-1');
      expect(stats).toBeDefined();
      expect(stats?.accessCount).toBe(1);
    });

    it('should increment access count on repeated access', () => {
      service.recordAccess('memory-1');
      service.recordAccess('memory-1');
      service.recordAccess('memory-1');

      const stats = service.getAccessStats('memory-1');
      expect(stats?.accessCount).toBe(3);
    });

    it('should track last access time', () => {
      const time1 = new Date('2024-01-01T10:00:00Z');
      const time2 = new Date('2024-01-02T10:00:00Z');

      service.recordAccess('memory-1', time1);
      service.recordAccess('memory-1', time2);

      const stats = service.getAccessStats('memory-1');
      expect(stats?.lastAccessAt).toEqual(time2);
    });

    it('should return undefined for untracked memory', () => {
      const stats = service.getAccessStats('unknown');
      expect(stats).toBeUndefined();
    });
  });

  describe('evaluate', () => {
    it('should return keep for core layer memory', () => {
      const memory = createMockMemory({
        entryType: 'preference',
        ttl: 'permanent',
      });

      const result = service.evaluate(memory);

      expect(result.currentLayer).toBe('core');
      expect(result.action).toBe('keep');
      expect(result.reason).toBe('already_optimal');
      expect(result.confidence).toBe(1.0);
    });

    it('should suggest upgrade to core for frequently accessed journey memory', () => {
      const memory = createMockMemory({
        entryType: 'preference',
        ttl: 'medium',
      });

      // Simulate frequent access
      for (let i = 0; i < 5; i++) {
        service.recordAccess(memory.id);
      }

      const result = service.evaluate(memory);

      expect(result.currentLayer).toBe('journey');
      expect(result.action).toBe('upgrade_to_core');
      expect(result.reason).toBe('frequent_access');
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it('should suggest upgrade to journey for frequently accessed moment memory', () => {
      const memory = createMockMemory({
        entryType: 'session',
        ttl: 'short',
      });

      // Simulate frequent access
      for (let i = 0; i < 5; i++) {
        service.recordAccess(memory.id);
      }

      const result = service.evaluate(memory);

      expect(result.currentLayer).toBe('moment');
      expect(result.action).toBe('upgrade_to_journey');
      expect(result.reason).toBe('frequent_access');
    });

    it('should suggest downgrade for long unused journey memory', () => {
      const memory = createMockMemory({
        entryType: 'procedure',
        ttl: 'medium',
        updatedAt: '2024-01-01T00:00:00Z',
      });

      // Record old access
      const oldDate = new Date('2024-01-01T00:00:00Z');
      service.recordAccess(memory.id, oldDate);

      // Evaluate as if 60 days later
      const now = new Date('2024-03-01T00:00:00Z');
      const result = service.evaluate(memory, now);

      expect(result.action).toBe('downgrade_to_moment');
      expect(result.reason).toBe('long_unused');
      expect(result.daysSinceAccess).toBeGreaterThanOrEqual(30);
    });

    it('should suggest archive for expiring memory', () => {
      const now = new Date('2024-01-15T00:00:00Z');
      const memory = createMockMemory({
        entryType: 'session',
        ttl: 'short',
        createdAt: '2024-01-01T00:00:00Z',
        expiresAt: '2024-01-16T00:00:00Z', // Expires in 1 day
      });

      const result = service.evaluate(memory, now);

      expect(result.action).toBe('archive');
      expect(result.reason).toBe('expiring_soon');
      expect(result.daysUntilExpiry).toBeLessThanOrEqual(7);
    });

    it('should calculate daysUntilExpiry correctly', () => {
      const now = new Date('2024-01-15T00:00:00Z');
      const memory = createMockMemory({
        entryType: 'session',
        ttl: 'short',
        expiresAt: '2024-01-20T00:00:00Z',
      });

      const result = service.evaluate(memory, now);

      expect(result.daysUntilExpiry).toBe(5);
    });

    it('should return null daysUntilExpiry for permanent memory', () => {
      const memory = createMockMemory({
        entryType: 'preference',
        ttl: 'permanent',
      });

      const result = service.evaluate(memory);

      expect(result.daysUntilExpiry).toBeNull();
    });
  });

  describe('batchEvaluate', () => {
    it('should evaluate multiple memories', () => {
      const memories = [
        createMockMemory({ id: 'memory-1', entryType: 'preference', ttl: 'permanent' }),
        createMockMemory({ id: 'memory-2', entryType: 'session', ttl: 'short' }),
        createMockMemory({ id: 'memory-3', entryType: 'procedure', ttl: 'medium' }),
      ];

      const results = service.batchEvaluate(memories);

      expect(results).toHaveLength(3);
      expect(results[0].memoryId).toBe('memory-1');
      expect(results[1].memoryId).toBe('memory-2');
      expect(results[2].memoryId).toBe('memory-3');
    });
  });

  describe('getCandidates methods', () => {
    it('should filter upgrade candidates', () => {
      const memories = [
        createMockMemory({ id: 'memory-1', entryType: 'preference', ttl: 'permanent' }),
        createMockMemory({ id: 'memory-2', entryType: 'preference', ttl: 'medium' }),
      ];

      // Make memory-2 frequently accessed
      for (let i = 0; i < 5; i++) {
        service.recordAccess('memory-2');
      }

      const candidates = service.getUpgradeCandidates(memories);

      expect(candidates.length).toBe(1);
      expect(candidates[0].memoryId).toBe('memory-2');
      expect(candidates[0].action).toBe('upgrade_to_core');
    });

    it('should filter downgrade candidates', () => {
      const oldDate = new Date('2024-01-01T00:00:00Z');
      const now = new Date('2024-03-01T00:00:00Z');

      const memories = [
        createMockMemory({ id: 'memory-1', entryType: 'preference', ttl: 'medium' }),
      ];

      // Record old access
      service.recordAccess('memory-1', oldDate);

      const candidates = service.getDowngradeCandidates(memories, now);

      expect(candidates.length).toBe(1);
      expect(candidates[0].action).toBe('downgrade_to_moment');
    });

    it('should filter archive candidates', () => {
      const now = new Date('2024-01-15T00:00:00Z');
      const memories = [
        createMockMemory({
          id: 'memory-1',
          entryType: 'session',
          ttl: 'short',
          expiresAt: '2024-01-16T00:00:00Z',
        }),
      ];

      const candidates = service.getArchiveCandidates(memories, now);

      expect(candidates.length).toBe(1);
      expect(candidates[0].action).toBe('archive');
    });
  });

  describe('getUpgradeTTL', () => {
    it('should return permanent for upgrade_to_core', () => {
      const ttl = service.getUpgradeTTL('upgrade_to_core', 'medium');
      expect(ttl).toBe('permanent');
    });

    it('should return medium for upgrade_to_journey', () => {
      const ttl = service.getUpgradeTTL('upgrade_to_journey', 'short');
      expect(ttl).toBe('medium');
    });

    it('should return current TTL for other actions', () => {
      const ttl = service.getUpgradeTTL('keep', 'long');
      expect(ttl).toBe('long');
    });
  });

  describe('clearAccessLog and getTrackedCount', () => {
    it('should clear access log', () => {
      service.recordAccess('memory-1');
      service.recordAccess('memory-2');

      expect(service.getTrackedCount()).toBe(2);

      service.clearAccessLog();

      expect(service.getTrackedCount()).toBe(0);
    });
  });
});

describe('DEFAULT_LIFECYCLE_CONFIG', () => {
  it('should have expected default values', () => {
    expect(DEFAULT_LIFECYCLE_CONFIG.upgradeAccessThreshold).toBe(5);
    expect(DEFAULT_LIFECYCLE_CONFIG.downgradeIdleDays).toBe(30);
    expect(DEFAULT_LIFECYCLE_CONFIG.archiveExpiryDays).toBe(7);
    expect(DEFAULT_LIFECYCLE_CONFIG.minConfidence).toBe(0.6);
  });
});
