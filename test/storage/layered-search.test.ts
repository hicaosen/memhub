/**
 * Tests for Phase 2: Logical Layering
 *
 * Tests:
 * - VectorRow includes layer field
 * - searchByLayer filters by layer
 * - layeredSearch waterfall query logic
 * - Score calculation with layer/type/freshness weights
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { VectorIndex } from '../../src/storage/vector-index.js';
import { type MemoryLayer, determineLayer, LAYER_WEIGHTS, TYPE_WEIGHTS, calculateFreshnessFactor } from '../../src/services/retrieval/layer-types.js';
import { layeredSearch, searchLayers, distanceToScore, LAYER_ORDER } from '../../src/services/retrieval/layered-search.js';
import type { Memory } from '../../src/contracts/types.js';
import { VECTOR_DIM } from '../../src/services/embedding-service.js';

/** Build a random embedding-dim float vector */
function randomVec(dim = VECTOR_DIM): number[] {
  const vec = Array.from({ length: dim }, () => Math.random() * 2 - 1);
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map(v => v / norm);
}

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'test-id-' + Math.random().toString(36).slice(2),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    importance: 3,
    title: 'Test Memory',
    content: 'Test content',
    ...overrides,
  };
}

describe('Layer Types', () => {
  describe('determineLayer', () => {
    it('should assign core layer to permanent preferences', () => {
      expect(determineLayer('preference', 'permanent')).toBe('core');
    });

    it('should assign core layer to permanent decisions', () => {
      expect(determineLayer('decision', 'permanent')).toBe('core');
    });

    it('should NOT assign core layer to permanent procedures', () => {
      expect(determineLayer('procedure', 'permanent')).toBe('journey');
    });

    it('should NOT assign core layer to non-permanent preferences', () => {
      expect(determineLayer('preference', 'long')).toBe('journey');
      expect(determineLayer('preference', 'medium')).toBe('journey');
    });

    it('should assign moment layer to short TTL', () => {
      expect(determineLayer('preference', 'short')).toBe('moment');
      expect(determineLayer('decision', 'short')).toBe('moment');
      expect(determineLayer(undefined, 'short')).toBe('moment');
    });

    it('should assign moment layer to session TTL', () => {
      expect(determineLayer('session', 'session')).toBe('moment');
      expect(determineLayer(undefined, 'session')).toBe('moment');
    });

    it('should assign journey layer to long/medium TTL', () => {
      expect(determineLayer('procedure', 'long')).toBe('journey');
      expect(determineLayer('constraint', 'medium')).toBe('journey');
    });

    it('should assign journey layer to procedures/constraints without session TTL', () => {
      expect(determineLayer('procedure', 'long')).toBe('journey');
      expect(determineLayer('constraint', 'permanent')).toBe('journey');
    });

    it('should handle undefined entryType and TTL', () => {
      expect(determineLayer(undefined, undefined)).toBe('journey');
    });
  });

  describe('LAYER_WEIGHTS', () => {
    it('should have core > journey > moment weights', () => {
      expect(LAYER_WEIGHTS.core).toBeGreaterThan(LAYER_WEIGHTS.journey);
      expect(LAYER_WEIGHTS.journey).toBeGreaterThan(LAYER_WEIGHTS.moment);
    });

    it('should boost core layer by 1.2x', () => {
      expect(LAYER_WEIGHTS.core).toBe(1.2);
    });

    it('should dampen moment layer by 0.8x', () => {
      expect(LAYER_WEIGHTS.moment).toBe(0.8);
    });
  });

  describe('TYPE_WEIGHTS', () => {
    it('should weight decision highest', () => {
      expect(TYPE_WEIGHTS.decision).toBe(1.1);
    });

    it('should weight session lowest', () => {
      expect(TYPE_WEIGHTS.session).toBe(0.7);
    });
  });

  describe('calculateFreshnessFactor', () => {
    const now = new Date('2024-01-15T00:00:00Z');

    it('should return 1.0 for memories without expiry', () => {
      const factor = calculateFreshnessFactor(undefined, '2024-01-01T00:00:00Z', now);
      expect(factor).toBe(1.0);
    });

    it('should return 1.0 for newly created memories', () => {
      const factor = calculateFreshnessFactor(
        '2024-02-01T00:00:00Z', // expires in 17 days
        '2024-01-15T00:00:00Z', // created today
        now
      );
      expect(factor).toBeCloseTo(1.0, 2);
    });

    it('should return 0.8 for expired memories', () => {
      const factor = calculateFreshnessFactor(
        '2024-01-01T00:00:00Z', // expired
        '2024-01-01T00:00:00Z',
        now
      );
      expect(factor).toBe(0.8);
    });

    it('should decrease as memory approaches expiry', () => {
      const created = '2024-01-01T00:00:00Z';
      const expires = '2024-01-31T00:00:00Z';

      const midFactor = calculateFreshnessFactor(expires, created, now);
      // Halfway through TTL should have ~0.9 freshness (20% * 0.5 reduction)
      expect(midFactor).toBeCloseTo(0.9, 1);
    });
  });
});

describe('VectorIndex Layer Support', () => {
  let tempDir: string;
  let index: VectorIndex;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'memhub-layer-test-'));
    index = new VectorIndex(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should upsert memory with correct layer (core)', async () => {
    const memory = makeMemory({
      id: 'core-memory-1',
      entryType: 'preference',
      ttl: 'permanent',
    });
    await index.upsert(memory, randomVec());
    // Layer should be computed and stored
    // We verify this by searching the layer
    const results = await index.searchByLayer(randomVec(), 'core', 10);
    expect(results.some(r => r.id === 'core-memory-1')).toBe(true);
  });

  it('should upsert memory with correct layer (journey)', async () => {
    const memory = makeMemory({
      id: 'journey-memory-1',
      entryType: 'procedure',
      ttl: 'long',
    });
    await index.upsert(memory, randomVec());
    const results = await index.searchByLayer(randomVec(), 'journey', 10);
    expect(results.some(r => r.id === 'journey-memory-1')).toBe(true);
  });

  it('should upsert memory with correct layer (moment)', async () => {
    const memory = makeMemory({
      id: 'moment-memory-1',
      entryType: 'session',
      ttl: 'session',
    });
    await index.upsert(memory, randomVec());
    const results = await index.searchByLayer(randomVec(), 'moment', 10);
    expect(results.some(r => r.id === 'moment-memory-1')).toBe(true);
  });

  it('should searchByLayer to only return results from specified layer', async () => {
    // Create memories in different layers
    const coreMemory = makeMemory({
      id: 'core-1',
      entryType: 'preference',
      ttl: 'permanent',
    });
    const journeyMemory = makeMemory({
      id: 'journey-1',
      entryType: 'procedure',
      ttl: 'long',
    });
    const momentMemory = makeMemory({
      id: 'moment-1',
      entryType: 'session',
      ttl: 'session',
    });

    const vec = randomVec();
    await index.upsert(coreMemory, vec);
    await index.upsert(journeyMemory, vec);
    await index.upsert(momentMemory, vec);

    // Search core layer only
    const coreResults = await index.searchByLayer(vec, 'core', 10);
    expect(coreResults.length).toBe(1);
    expect(coreResults[0].id).toBe('core-1');

    // Search journey layer only
    const journeyResults = await index.searchByLayer(vec, 'journey', 10);
    expect(journeyResults.length).toBe(1);
    expect(journeyResults[0].id).toBe('journey-1');

    // Search moment layer only
    const momentResults = await index.searchByLayer(vec, 'moment', 10);
    expect(momentResults.length).toBe(1);
    expect(momentResults[0].id).toBe('moment-1');
  });

  it('should return empty array when layer has no memories', async () => {
    const results = await index.searchByLayer(randomVec(), 'core', 10);
    expect(results).toHaveLength(0);
  });

  it('should update layer when memory is updated', async () => {
    // Start as journey
    const memory = makeMemory({
      id: 'upgrade-test',
      entryType: 'preference',
      ttl: 'medium',
    });
    await index.upsert(memory, randomVec());

    let journeyResults = await index.searchByLayer(randomVec(), 'journey', 10);
    expect(journeyResults.some(r => r.id === 'upgrade-test')).toBe(true);

    // Upgrade to core
    const upgradedMemory: Memory = {
      ...memory,
      ttl: 'permanent',
    };
    await index.upsert(upgradedMemory, randomVec());

    // Should now be in core
    const coreResults = await index.searchByLayer(randomVec(), 'core', 10);
    expect(coreResults.some(r => r.id === 'upgrade-test')).toBe(true);

    // Should no longer be in journey
    journeyResults = await index.searchByLayer(randomVec(), 'journey', 10);
    expect(journeyResults.some(r => r.id === 'upgrade-test')).toBe(false);
  });
});

describe('Layered Search', () => {
  let tempDir: string;
  let index: VectorIndex;
  const memories: Map<string, Memory> = new Map();

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'memhub-layered-search-test-'));
    index = new VectorIndex(tempDir);
    memories.clear();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Helper to add memory and track it
  async function addMemory(memory: Memory, vec?: number[]): Promise<void> {
    memories.set(memory.id, memory);
    await index.upsert(memory, vec ?? randomVec());
  }

  describe('distanceToScore', () => {
    it('should convert distance 0 to score 1', () => {
      expect(distanceToScore(0)).toBe(1);
    });

    it('should convert distance 2 to score 0', () => {
      expect(distanceToScore(2)).toBe(0);
    });

    it('should convert distance 1 to score 0.5', () => {
      expect(distanceToScore(1)).toBe(0.5);
    });

    it('should clamp negative results to 0', () => {
      expect(distanceToScore(3)).toBe(0);
    });
  });

  describe('LAYER_ORDER', () => {
    it('should search layers in order: core, journey, moment', () => {
      expect(LAYER_ORDER).toEqual(['core', 'journey', 'moment']);
    });
  });

  describe('searchLayers', () => {
    it('should search multiple layers and merge results', async () => {
      const coreMemory = makeMemory({
        id: 'core-1',
        entryType: 'preference',
        ttl: 'permanent',
      });
      const journeyMemory = makeMemory({
        id: 'journey-1',
        entryType: 'procedure',
        ttl: 'long',
      });

      const vec = randomVec();
      await addMemory(coreMemory, vec);
      await addMemory(journeyMemory, vec);

      const results = await searchLayers(index, vec, ['core', 'journey'], 10);
      expect(results.length).toBe(2);
      expect(results.map(r => r.id)).toContain('core-1');
      expect(results.map(r => r.id)).toContain('journey-1');
    });

    it('should not duplicate results when same ID appears in multiple searches', async () => {
      const memory = makeMemory({
        id: 'unique-1',
        entryType: 'preference',
        ttl: 'permanent',
      });
      const vec = randomVec();
      await addMemory(memory, vec);

      const results = await searchLayers(index, vec, ['core', 'journey', 'moment'], 10);
      expect(results.length).toBe(1);
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await addMemory(makeMemory({
          id: `core-${i}`,
          entryType: 'preference',
          ttl: 'permanent',
        }));
      }

      const results = await searchLayers(index, randomVec(), ['core'], 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('layeredSearch', () => {
    it('should return scored results with layer weights applied', async () => {
      const coreMemory = makeMemory({
        id: 'core-1',
        entryType: 'preference',
        ttl: 'permanent',
      });
      const momentMemory = makeMemory({
        id: 'moment-1',
        entryType: 'session',
        ttl: 'session',
      });

      const vec = randomVec();
      await addMemory(coreMemory, vec);
      await addMemory(momentMemory, vec);

      // Use minCoreScore: 1.1 to disable early termination so we get all results
      const results = await layeredSearch(index, {
        vector: vec,
        limit: 10,
        minCoreScore: 1.1, // Disable early termination
        getMemoryById: (id) => memories.get(id),
      });

      expect(results.length).toBe(2);

      // Core result should have higher weight
      const coreResult = results.find(r => r.id === 'core-1');
      const momentResult = results.find(r => r.id === 'moment-1');

      expect(coreResult).toBeDefined();
      expect(momentResult).toBeDefined();
      expect(coreResult!.layerWeight).toBe(1.2);
      expect(momentResult!.layerWeight).toBe(0.8);
    });

    it('should apply type weight to final score', async () => {
      const decisionMemory = makeMemory({
        id: 'decision-1',
        entryType: 'decision',
        ttl: 'permanent',
      });
      const sessionMemory = makeMemory({
        id: 'session-1',
        entryType: 'session',
        ttl: 'session',
      });

      const vec = randomVec();
      await addMemory(decisionMemory, vec);
      await addMemory(sessionMemory, vec);

      // Use minCoreScore: 1.1 to disable early termination so we get all results
      const results = await layeredSearch(index, {
        vector: vec,
        limit: 10,
        minCoreScore: 1.1, // Disable early termination
        getMemoryById: (id) => memories.get(id),
      });

      const decisionResult = results.find(r => r.id === 'decision-1');
      const sessionResult = results.find(r => r.id === 'session-1');

      expect(decisionResult!.typeWeight).toBe(1.1);
      expect(sessionResult!.typeWeight).toBe(0.7);
    });

    it('should apply freshness factor based on expiry', async () => {
      const freshMemory = makeMemory({
        id: 'fresh-1',
        entryType: 'preference',
        ttl: 'permanent',
      });
      const expiringMemory: Memory = {
        id: 'expiring-1',
        createdAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(), // 6 days ago
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day left
        importance: 3,
        title: 'Expiring',
        content: 'About to expire',
        entryType: 'session',
        ttl: 'short',
      };

      const vec = randomVec();
      await addMemory(freshMemory, vec);
      await addMemory(expiringMemory, vec);

      const results = await layeredSearch(index, {
        vector: vec,
        limit: 10,
        getMemoryById: (id) => memories.get(id),
      });

      const freshResult = results.find(r => r.id === 'fresh-1');
      // Fresh memory should have freshnessFactor of 1.0 (permanent)
      expect(freshResult!.freshnessFactor).toBe(1.0);
    });

    it('should sort results by finalScore descending', async () => {
      const coreMemory = makeMemory({
        id: 'core-1',
        entryType: 'decision',
        ttl: 'permanent',
      });
      const momentMemory = makeMemory({
        id: 'moment-1',
        entryType: 'session',
        ttl: 'session',
      });

      const vec = randomVec();
      await addMemory(coreMemory, vec);
      await addMemory(momentMemory, vec);

      const results = await layeredSearch(index, {
        vector: vec,
        limit: 10,
        getMemoryById: (id) => memories.get(id),
      });

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].finalScore).toBeGreaterThanOrEqual(results[i].finalScore);
      }
    });

    it('should respect maxLayers parameter', async () => {
      const coreMemory = makeMemory({
        id: 'core-1',
        entryType: 'preference',
        ttl: 'permanent',
      });
      const momentMemory = makeMemory({
        id: 'moment-1',
        entryType: 'session',
        ttl: 'session',
      });

      const vec = randomVec();
      await addMemory(coreMemory, vec);
      await addMemory(momentMemory, vec);

      // With maxLayers=1 (core only), moment should not be included
      const results = await layeredSearch(index, {
        vector: vec,
        limit: 10,
        maxLayers: 1,
        getMemoryById: (id) => memories.get(id),
      });

      expect(results.some(r => r.id === 'core-1')).toBe(true);
      expect(results.some(r => r.id === 'moment-1')).toBe(false);
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await addMemory(makeMemory({
          id: `core-${i}`,
          entryType: 'preference',
          ttl: 'permanent',
        }));
      }

      const results = await layeredSearch(index, {
        vector: randomVec(),
        limit: 5,
      });

      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should work without getMemoryById callback', async () => {
      const memory = makeMemory({
        id: 'core-1',
        entryType: 'preference',
        ttl: 'permanent',
      });
      const vec = randomVec();
      await addMemory(memory, vec);

      const results = await layeredSearch(index, {
        vector: vec,
        limit: 10,
        // No getMemoryById callback
      });

      expect(results.length).toBe(1);
      // Should still have layer weight
      expect(results[0].layerWeight).toBe(1.2);
      // Type weight should be neutral (1.0) since we don't have memory info
      expect(results[0].typeWeight).toBe(1.0);
      expect(results[0].freshnessFactor).toBe(1.0);
    });
  });
});
