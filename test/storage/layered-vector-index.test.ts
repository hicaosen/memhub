/**
 * Tests for Phase 3: Physical Layering - Three-Tower VectorIndex
 *
 * These tests verify the three-table architecture:
 * - Core tower: memories_core (permanent preferences/decisions)
 * - Journey tower: memories_journey (long/medium TTL)
 * - Moment tower: memories_moment (short/session TTL)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LayeredVectorIndex } from '../../src/storage/layered-vector-index.js';
import type { Memory, MemoryEntryType, TTLLevel } from '../../src/contracts/types.js';
import { VECTOR_DIM } from '../../src/services/embedding-service.js';
import type { MemoryLayer } from '../../src/services/retrieval/layer-types.js';
import { determineLayer } from '../../src/services/retrieval/layer-types.js';

/** Build a random embedding-dim float vector */
function randomVec(dim = VECTOR_DIM): number[] {
  const vec = Array.from({ length: dim }, () => Math.random() * 2 - 1);
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map(v => v / norm);
}

type MemoryLayerOption = 'core' | 'journey' | 'moment';

function makeMemory(overrides: {
  entryType?: MemoryEntryType;
  ttl?: TTLLevel;
  id?: string;
  expiresAt?: string;
} = {}): Memory {
  return {
    id: overrides.id ?? 'test-id-' + Math.random().toString(36).slice(2),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    importance: 3,
    title: 'Test Memory',
    content: 'Test content',
    entryType: overrides.entryType,
    ttl: overrides.ttl,
    expiresAt: overrides.expiresAt,
  };
}

/**
 * Create a test memory with the specified layer.
 * Auto-sets entryType and ttl based on desired layer.
 */
function makeMemoryWithLayer(layer: MemoryLayerOption, overrides: {
  id?: string;
  expiresAt?: string;
} = {}): Memory {
  let entryType: MemoryEntryType | undefined;
  let ttl: TTLLevel | undefined;
  let expiresAt = overrides.expiresAt;

  switch (layer) {
    case 'core':
      entryType = 'preference';
      ttl = 'permanent';
      break;
    case 'journey':
      entryType = 'procedure';
      ttl = 'medium';
      break;
    case 'moment':
      entryType = 'session';
      ttl = 'session';
      expiresAt ??= new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      break;
  }

  return makeMemory({ id: overrides.id, entryType, ttl, expiresAt });
}

describe('LayeredVectorIndex - Phase 3', () => {
  let tempDir: string;
  let index: LayeredVectorIndex;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'memhub-layered-index-test-'));
    index = new LayeredVectorIndex(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Initialization', () => {
    it('initializes all three layer tables', async () => {
      await index.initialize();
      const counts = await index.count();
      expect(counts.total).toBe(0);
      expect(counts.core).toBe(0);
      expect(counts.journey).toBe(0);
      expect(counts.moment).toBe(0);
    });

    it('is idempotent - can initialize multiple times', async () => {
      await index.initialize();
      await index.initialize();
      await index.initialize();
      const counts = await index.count();
      expect(counts.total).toBe(0);
    });
  });

  describe('Layer Routing on Upsert', () => {
    it('routes permanent preference to core layer', async () => {
      const memory = makeMemoryWithLayer('core', { id: 'core-1' });
      await index.upsert(memory, randomVec());

      const counts = await index.count();
      expect(counts.core).toBe(1);
      expect(counts.journey).toBe(0);
      expect(counts.moment).toBe(0);
    });

    it('routes permanent decision to core layer', async () => {
      const memory = makeMemory({
        id: 'core-2',
        entryType: 'decision',
        ttl: 'permanent',
      });
      await index.upsert(memory, randomVec());

      const counts = await index.count();
      expect(counts.core).toBe(1);
    });

    it('routes medium TTL to journey layer', async () => {
      const memory = makeMemoryWithLayer('journey', { id: 'journey-1' });
      await index.upsert(memory, randomVec());

      const counts = await index.count();
      expect(counts.core).toBe(0);
      expect(counts.journey).toBe(1);
      expect(counts.moment).toBe(0);
    });

    it('routes long TTL to journey layer', async () => {
      const memory = makeMemory({
        id: 'journey-2',
        entryType: 'procedure',
        ttl: 'long',
      });
      await index.upsert(memory, randomVec());

      const counts = await index.count();
      expect(counts.journey).toBe(1);
    });

    it('routes session TTL to moment layer', async () => {
      const memory = makeMemoryWithLayer('moment', { id: 'moment-1' });
      await index.upsert(memory, randomVec());

      const counts = await index.count();
      expect(counts.core).toBe(0);
      expect(counts.journey).toBe(0);
      expect(counts.moment).toBe(1);
    });

    it('routes short TTL to moment layer', async () => {
      const memory = makeMemory({
        id: 'moment-2',
        ttl: 'short',
      });
      await index.upsert(memory, randomVec());

      const counts = await index.count();
      expect(counts.moment).toBe(1);
    });

    it('does not assign core layer for non-preference/decision types', async () => {
      const memory = makeMemory({
        id: 'not-core',
        entryType: 'procedure',
        ttl: 'permanent',
      });
      await index.upsert(memory, randomVec());

      const counts = await index.count();
      expect(counts.core).toBe(0);
      expect(counts.journey).toBe(1); // Goes to journey instead
    });

    it('does not assign core layer for non-permanent TTL', async () => {
      const memory = makeMemory({
        id: 'not-core-2',
        entryType: 'preference',
        ttl: 'long',
      });
      await index.upsert(memory, randomVec());

      const counts = await index.count();
      expect(counts.core).toBe(0);
      expect(counts.journey).toBe(1); // Goes to journey instead
    });
  });

  describe('Cross-Layer Search', () => {
    it('searches across all layers and merges results', async () => {
      const vec = randomVec();
      await index.upsert(makeMemoryWithLayer('core', { id: 'core-1' }), vec);
      await index.upsert(makeMemoryWithLayer('journey', { id: 'journey-1' }), vec);
      await index.upsert(makeMemoryWithLayer('moment', { id: 'moment-1' }), vec);

      const results = await index.search(vec, 10);
      expect(results.length).toBe(3);

      // All three should be found
      const ids = results.map(r => r.id);
      expect(ids).toContain('core-1');
      expect(ids).toContain('journey-1');
      expect(ids).toContain('moment-1');

      // All should have layer info
      for (const result of results) {
        expect(result._layer).toBeDefined();
        expect(['core', 'journey', 'moment']).toContain(result._layer);
      }
    });

    it('returns results sorted by distance', async () => {
      // Create memories with different vectors
      const queryVec = randomVec();
      await index.upsert(makeMemoryWithLayer('core', { id: 'core-1' }), randomVec());
      await index.upsert(makeMemoryWithLayer('journey', { id: 'journey-1' }), queryVec);
      await index.upsert(makeMemoryWithLayer('moment', { id: 'moment-1' }), randomVec());

      const results = await index.search(queryVec, 10);

      // journey-1 should be first (exact match)
      expect(results[0].id).toBe('journey-1');
      expect(results[0]._distance).toBeCloseTo(0, 5);

      // Results should be sorted by distance
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]._distance).toBeLessThanOrEqual(results[i]._distance);
      }
    });

    it('respects limit parameter', async () => {
      const vec = randomVec();
      for (let i = 0; i < 10; i++) {
        await index.upsert(
          makeMemoryWithLayer('core', { id: `core-${i}` }),
          vec
        );
      }

      const results = await index.search(vec, 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('searchByLayer', () => {
    it('searches only the specified layer', async () => {
      const vec = randomVec();
      await index.upsert(makeMemoryWithLayer('core', { id: 'core-1' }), vec);
      await index.upsert(makeMemoryWithLayer('journey', { id: 'journey-1' }), vec);
      await index.upsert(makeMemoryWithLayer('moment', { id: 'moment-1' }), vec);

      const coreResults = await index.searchByLayer(vec, 'core', 10);
      const journeyResults = await index.searchByLayer(vec, 'journey', 10);
      const momentResults = await index.searchByLayer(vec, 'moment', 10);

      expect(coreResults.length).toBe(1);
      expect(coreResults[0].id).toBe('core-1');
      expect(coreResults[0]._layer).toBe('core');

      expect(journeyResults.length).toBe(1);
      expect(journeyResults[0].id).toBe('journey-1');
      expect(journeyResults[0]._layer).toBe('journey');

      expect(momentResults.length).toBe(1);
      expect(momentResults[0].id).toBe('moment-1');
      expect(momentResults[0]._layer).toBe('moment');
    });

    it('returns empty array when layer has no memories', async () => {
      await index.upsert(makeMemoryWithLayer('journey', { id: 'journey-1' }), randomVec());

      const coreResults = await index.searchByLayer(randomVec(), 'core', 10);
      expect(coreResults).toHaveLength(0);
    });
  });

  describe('Delete', () => {
    it('deletes from all layers when id exists', async () => {
      await index.upsert(makeMemoryWithLayer('core', { id: 'del-test' }), randomVec());

      let counts = await index.count();
      expect(counts.total).toBe(1);

      await index.delete('del-test');

      counts = await index.count();
      expect(counts.total).toBe(0);
    });

    it('silently succeeds when id does not exist', async () => {
      await index.delete('non-existent');
      // Should not throw
    });
  });

  describe('Update Layer on Re-Upsert', () => {
    it('moves memory to correct layer when ttl changes', async () => {
      const id = 'layer-change-test';
      const vec = randomVec();

      // Start as moment (session TTL)
      let memory = makeMemory({
        id,
        entryType: 'preference',
        ttl: 'session',
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      });
      await index.upsert(memory, vec);

      let counts = await index.count();
      expect(counts.moment).toBe(1);
      expect(counts.core).toBe(0);

      // Update to permanent (core)
      memory = {
        ...memory,
        ttl: 'permanent',
        expiresAt: undefined,
      };
      await index.upsert(memory, vec);

      counts = await index.count();
      expect(counts.moment).toBe(0);
      expect(counts.core).toBe(1);
    });
  });

  describe('Expired Memory Cleanup', () => {
    it('can delete expired memories from a specific layer', async () => {
      const now = new Date();
      const pastExpired = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(); // 1 day ago

      const memory = makeMemory({
        id: 'expired-moment',
        ttl: 'session',
        expiresAt: pastExpired,
      });
      await index.upsert(memory, randomVec());

      let counts = await index.count();
      expect(counts.moment).toBe(1);

      const deleted = await index.deleteExpired('moment', now);
      expect(deleted).toBe(1);

      counts = await index.count();
      expect(counts.moment).toBe(0);
    });

    it('does not delete unexpired memories', async () => {
      const now = new Date();
      const futureExpired = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(); // 1 day future

      const memory = makeMemory({
        id: 'not-expired-moment',
        ttl: 'session',
        expiresAt: futureExpired,
      });
      await index.upsert(memory, randomVec());

      const deleted = await index.deleteExpired('moment', now);
      expect(deleted).toBe(0);

      const counts = await index.count();
      expect(counts.moment).toBe(1);
    });

    it('does not delete core memories regardless of expiry', async () => {
      const now = new Date();

      const memory = makeMemory({
        id: 'expired-core',
        entryType: 'preference',
        ttl: 'permanent',
      });
      await index.upsert(memory, randomVec());

      // Core layer cleanup is disabled, so nothing should be deleted
      const deleted = await index.deleteExpired('core', now);
      expect(deleted).toBe(0);

      const counts = await index.count();
      expect(counts.core).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('rejects vectors with wrong dimensions on upsert', async () => {
      const wrongDim = VECTOR_DIM === 768 ? 1024 : 768;
      const memory = makeMemoryWithLayer('core');

      await expect(
        index.upsert(memory, randomVec(wrongDim))
      ).rejects.toThrow(
        new RegExp(`expects ${VECTOR_DIM} dimensions, got ${wrongDim}`)
      );
    });

    it('rejects vectors with wrong dimensions on search', async () => {
      const wrongDim = VECTOR_DIM === 768 ? 1024 : 768;

      await expect(
        index.search(randomVec(wrongDim), 10)
      ).rejects.toThrow(
        new RegExp(`expects ${VECTOR_DIM} dimensions, got ${wrongDim}`)
      );
    });

    it('rejects vectors with wrong dimensions on searchByLayer', async () => {
      const wrongDim = VECTOR_DIM === 768 ? 1024 : 768;

      await expect(
        index.searchByLayer(randomVec(wrongDim), 'core', 10)
      ).rejects.toThrow(
        new RegExp(`expects ${VECTOR_DIM} dimensions, got ${wrongDim}`)
      );
    });
  });

  describe('Count Methods', () => {
    it('counts total and per-layer correctly', async () => {
      const vec = randomVec();
      await index.upsert(makeMemoryWithLayer('core', { id: 'core-1' }), vec);
      await index.upsert(makeMemoryWithLayer('core', { id: 'core-2' }), vec);
      await index.upsert(makeMemoryWithLayer('journey', { id: 'journey-1' }), vec);
      await index.upsert(makeMemoryWithLayer('journey', { id: 'journey-2' }), vec);
      await index.upsert(makeMemoryWithLayer('journey', { id: 'journey-3' }), vec);
      await index.upsert(makeMemoryWithLayer('moment', { id: 'moment-1' }), vec);

      const counts = await index.count();
      expect(counts.total).toBe(6);
      expect(counts.core).toBe(2);
      expect(counts.journey).toBe(3);
      expect(counts.moment).toBe(1);
    });

    it('counts single layer correctly', async () => {
      const vec = randomVec();
      await index.upsert(makeMemoryWithLayer('core', { id: 'core-1' }), vec);
      await index.upsert(makeMemoryWithLayer('journey', { id: 'journey-1' }), vec);

      expect(await index.countByLayer('core')).toBe(1);
      expect(await index.countByLayer('journey')).toBe(1);
      expect(await index.countByLayer('moment')).toBe(0);
    });
  });
});
