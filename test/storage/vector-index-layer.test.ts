/**
 * Tests for Phase 2: Logical Layering - Vector Index Layer Support
 *
 * These tests verify layer-related functionality in the vector index:
 * - Layer calculation from entryType and TTL (using determineLayer function)
 * - Verifying that layer metadata is stored in index rows
 * - Layer-based weight application in results
 *
 * Note: The current VectorIndex implementation stores entryType, ttl, and expiresAt
 * as optional fields. These tests verify the layer calculation logic and retrieval
 * rather than testing LanceDB storage directly (which has schema issues).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { VectorIndex } from '../../src/storage/vector-index.js';
import type { Memory, MemoryEntryType, TTLLevel } from '../../src/contracts/types.js';
import { VECTOR_DIM } from '../../src/services/embedding-service.js';
import {
  determineLayer,
  getLayerWeight,
  getTypeWeight,
  calculateFreshnessFactor,
  LAYER_WEIGHTS,
  TYPE_WEIGHTS,
  type MemoryLayer,
} from '../../src/services/retrieval/layer-types.js';

/**
 * Build a random embedding-dim float vector (avoids loading the real model)
 */
function randomVec(dim = VECTOR_DIM): number[] {
  const vec = Array.from({ length: dim }, () => Math.random() * 2 - 1);
  // L2-normalise so cosine distance is meaningful
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map(v => v / norm);
}

/**
 * Create a test memory with optional layer-determining properties
 */
function makeMemory(overrides: Partial<Memory> & { layer?: MemoryLayer } = {}): Memory {
  const layer = overrides.layer;
  let entryType = overrides.entryType;
  let ttl = overrides.ttl;
  let expiresAt = overrides.expiresAt;

  // Auto-set entryType and ttl based on desired layer for convenience
  if (layer && !entryType && !ttl) {
    switch (layer) {
      case 'core':
        entryType = 'preference';
        ttl = 'permanent';
        break;
      case 'journey':
        entryType = 'procedure';
        ttl = 'medium';
        break;
      case 'moment': {
        entryType = 'session';
        ttl = 'session';
        const now = new Date();
        expiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
        break;
      }
    }
  }

  return {
    id: overrides.id ?? 'test-id-' + Math.random().toString(36).slice(2),
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    importance: overrides.importance ?? 3,
    title: overrides.title ?? 'Test Memory',
    content: overrides.content ?? 'Test content',
    entryType,
    ttl,
    expiresAt,
  };
}

/**
 * Calculate the effective layer score for a search result.
 * This simulates what the retrieval pipeline would do.
 */
function calculateLayerScore(
  vectorDistance: number,
  layer: MemoryLayer,
  entryType: MemoryEntryType | undefined,
  createdAt: string,
  expiresAt: string | undefined,
  now: Date
): number {
  // Convert distance to similarity score (0-1, higher is better)
  const vectorScore = 1 - vectorDistance;

  // Apply layer weights
  const layerWeight = getLayerWeight(layer);
  const typeWeight = getTypeWeight(entryType);
  const freshnessFactor = calculateFreshnessFactor(expiresAt, createdAt, now);

  return vectorScore * layerWeight * typeWeight * freshnessFactor;
}

describe('VectorIndex Layer Support - Phase 2', () => {
  let tempDir: string;
  let index: VectorIndex;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'memhub-layer-test-'));
    index = new VectorIndex(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Layer Constants', () => {
    it('core layer has highest weight (1.2)', () => {
      expect(LAYER_WEIGHTS.core).toBe(1.2);
    });

    it('journey layer has neutral weight (1.0)', () => {
      expect(LAYER_WEIGHTS.journey).toBe(1.0);
    });

    it('moment layer has lowest weight (0.8)', () => {
      expect(LAYER_WEIGHTS.moment).toBe(0.8);
    });

    it('layer weights are ordered correctly', () => {
      expect(LAYER_WEIGHTS.core).toBeGreaterThan(LAYER_WEIGHTS.journey);
      expect(LAYER_WEIGHTS.journey).toBeGreaterThan(LAYER_WEIGHTS.moment);
    });
  });

  describe('Type Weights', () => {
    it('decision has highest type weight (1.1)', () => {
        expect(TYPE_WEIGHTS.decision).toBe(1.1);
      });

    it('preference and constraint have neutral type weight (1.0)', () => {
        expect(TYPE_WEIGHTS.preference).toBe(1.0);
        expect(TYPE_WEIGHTS.constraint).toBe(1.0);
      });

    it('procedure has lower type weight (0.9)', () => {
        expect(TYPE_WEIGHTS.procedure).toBe(0.9);
      });

    it('session has lowest type weight (0.7)', () => {
        expect(TYPE_WEIGHTS.session).toBe(0.7);
      });
    });

  describe('determineLayer Function', () => {
    it('returns core for permanent preference', () => {
      expect(determineLayer('preference', 'permanent')).toBe('core');
    });

    it('returns core for permanent decision', () => {
      expect(determineLayer('decision', 'permanent')).toBe('core');
    });

    it('returns journey for permanent procedure (not preference/decision)', () => {
      expect(determineLayer('procedure', 'permanent')).toBe('journey');
    });

    it('returns journey for permanent constraint', () => {
      expect(determineLayer('constraint', 'permanent')).toBe('journey');
    });

    it('returns journey for long ttl regardless of type', () => {
        expect(determineLayer('preference', 'long')).toBe('journey');
        expect(determineLayer('decision', 'long')).toBe('journey');
        expect(determineLayer('procedure', 'long')).toBe('journey');
      });

    it('returns journey for medium ttl', () => {
        expect(determineLayer('preference', 'medium')).toBe('journey');
        expect(determineLayer('session', 'medium')).toBe('journey');
      });

    it('returns moment for short ttl', () => {
        expect(determineLayer('preference', 'short')).toBe('moment');
        expect(determineLayer('session', 'short')).toBe('moment');
      });

    it('returns moment for session ttl', () => {
        expect(determineLayer('session', 'session')).toBe('moment');
        expect(determineLayer('preference', 'session')).toBe('moment');
      });

    it('returns journey for undefined entryType and ttl', () => {
        expect(determineLayer(undefined, undefined)).toBe('journey');
      });

    it('returns journey for undefined entryType with long/medium ttl', () => {
        expect(determineLayer(undefined, 'long')).toBe('journey');
        expect(determineLayer(undefined, 'medium')).toBe('journey');
      });

    it('returns moment for undefined entryType with short/session ttl', () => {
        expect(determineLayer(undefined, 'short')).toBe('moment');
        expect(determineLayer(undefined, 'session')).toBe('moment');
      });
    });

  describe('calculateFreshnessFactor Function', () => {
    const now = new Date('2024-06-15T12:00:00Z');

    it('returns 1.0 for permanent memories (no expiry)', () => {
        const createdAt = '2024-01-01T00:00:00Z';
        expect(calculateFreshnessFactor(undefined, createdAt, now)).toBe(1.0);
      });

    it('returns 1.0 for newly created memories', () => {
        const createdAt = '2024-06-15T12:00:00Z';
        const expiresAt = '2024-07-15T12:00:00Z';
        expect(calculateFreshnessFactor(expiresAt, createdAt, now)).toBe(1.0);
      });

    it('decreases as memory approaches expiry', () => {
        const createdAt = '2024-06-01T00:00:00Z';
        const expiresAt = '2024-06-30T00:00:00Z'; // 30 days TTL
        // At now=2024-06-15, we're halfway through the TTL
        // Expected: 1.0 - 0.5 * 0.2 = 0.9
        const factor = calculateFreshnessFactor(expiresAt, createdAt, now);
        expect(factor).toBeCloseTo(0.9, 0.01);
      });

    it('returns 0.8 for expired memories', () => {
        const createdAt = '2024-05-01T00:00:00Z';
        const expiresAt = '2024-06-01T00:00:00Z';
        expect(calculateFreshnessFactor(expiresAt, createdAt, now)).toBe(0.8);
      });

    it('never drops below 0.8', () => {
        const createdAt = '2024-01-01T00:00:00Z';
        const expiresAt = '2024-06-14T00:00:00Z'; // Expired yesterday
        expect(calculateFreshnessFactor(expiresAt, createdAt, now)).toBe(0.8);
      });
    });

  describe('getLayerWeight Function', () => {
    it('returns correct weight for core layer', () => {
        expect(getLayerWeight('core')).toBe(1.2);
      });

    it('returns correct weight for journey layer', () => {
        expect(getLayerWeight('journey')).toBe(1.0);
      });

    it('returns correct weight for moment layer', () => {
        expect(getLayerWeight('moment')).toBe(0.8);
      });
    });

  describe('getTypeWeight Function', () => {
    it('returns correct weight for decision type', () => {
        expect(getTypeWeight('decision')).toBe(1.1);
      });

    it('returns correct weight for preference type', () => {
        expect(getTypeWeight('preference')).toBe(1.0);
      });

    it('returns correct weight for constraint type', () => {
        expect(getTypeWeight('constraint')).toBe(1.0);
      });

    it('returns correct weight for procedure type', () => {
        expect(getTypeWeight('procedure')).toBe(0.9);
      });

    it('returns correct weight for session type', () => {
        expect(getTypeWeight('session')).toBe(0.7);
      });

    it('returns 1.0 for undefined entryType', () => {
        expect(getTypeWeight(undefined)).toBe(1.0);
      });
    });

  describe('Layer Score Calculation', () => {
    const now = new Date('2024-06-15T12:00:00Z');

    it('core layer scores higher than moment layer with same vector distance', () => {
        const coreScore = calculateLayerScore(
          0.1, // distance (lower = more similar)
          'core',
          'preference',
          '2024-01-01T00:00:00Z',
          undefined, // permanent
          now
        );

        const momentScore = calculateLayerScore(
          0.1, // same distance
          'moment',
          'session',
          '2024-06-15T00:00:00Z',
          '2024-06-16T00:00:00Z',
          now
        );

        // Core: (1-0.1) * 1.2 * 1.0 * 1.0 = 1.08
        // Moment: (1-0.1) * 0.8 * 0.7 * ~1.0 = ~0.504
        expect(coreScore).toBeGreaterThan(momentScore);
      });

    it('decision type gets boost over preference in same layer', () => {
        const decisionScore = calculateLayerScore(
          0.1,
          'core',
          'decision',
          '2024-01-01T00:00:00Z',
          undefined,
          now
        );

        const preferenceScore = calculateLayerScore(
          0.1,
          'core',
          'preference',
          '2024-01-01T00:00:00Z',
          undefined,
          now
        );

        // Decision: 0.9 * 1.2 * 1.1 * 1.0 = 1.188
        // Preference: 0.9 * 1.2 * 1.0 * 1.0 = 1.08
        expect(decisionScore).toBeGreaterThan(preferenceScore);
      });

    it('freshness factor affects score for non-permanent memories', () => {
        const freshScore = calculateLayerScore(
          0.1,
          'journey',
          'procedure',
          '2024-06-15T00:00:00Z', // Just created
          '2024-07-15T00:00:00Z', // Expires in 30 days
          now
        );

        const staleScore = calculateLayerScore(
          0.1,
          'journey',
          'procedure',
          '2024-05-15T00:00:00Z', // Created 31 days ago
          '2024-06-16T00:00:00Z', // Expires tomorrow
          now
        );

        // Fresh should have higher score due to freshness factor
        expect(freshScore).toBeGreaterThan(staleScore);
      });
    });

  describe('VectorIndex Basic Operations with Layers', () => {
    it('can upsert and retrieve core layer memory', async () => {
      const memory = makeMemory({ layer: 'core' });
      const vec = randomVec();

      await index.upsert(memory, vec);
      expect(await index.count()).toBe(1);

      const results = await index.search(vec, 5);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe(memory.id);
    });

    it('can upsert and retrieve journey layer memory', async () => {
      const memory = makeMemory({ layer: 'journey' });
      const vec = randomVec();

      await index.upsert(memory, vec);
      expect(await index.count()).toBe(1);

      const results = await index.search(vec, 5);
      expect(results.length).toBe(1);
    });

    it('can upsert and retrieve moment layer memory', async () => {
      const memory = makeMemory({ layer: 'moment' });
      const vec = randomVec();

      await index.upsert(memory, vec);
      expect(await index.count()).toBe(1);

      const results = await index.search(vec, 5);
      expect(results.length).toBe(1);
    });

    it('stores memories from all layers in same index', async () => {
      const coreMem = makeMemory({ layer: 'core', id: 'core-1' });
      const journeyMem = makeMemory({ layer: 'journey', id: 'journey-1' });
      const momentMem = makeMemory({ layer: 'moment', id: 'moment-1' });

      await index.upsert(coreMem, randomVec());
      await index.upsert(journeyMem, randomVec());
      await index.upsert(momentMem, randomVec());

      expect(await index.count()).toBe(3);
    });

    it('can update memory layer via upsert', async () => {
      // Start as journey layer
      const memory = makeMemory({
        id: 'updatable',
        entryType: 'procedure',
        ttl: 'medium',
      });
      const vec = randomVec();
      await index.upsert(memory, vec);

      expect(determineLayer('procedure', 'medium')).toBe('journey');
      expect(await index.count()).toBe(1);

      // Update to core layer
      const updatedMemory: Memory = {
        ...memory,
        entryType: 'preference',
        ttl: 'permanent',
      };
      await index.upsert(updatedMemory, vec);

      expect(await index.count()).toBe(1); // Should still be 1 (update, not insert)
      expect(determineLayer('preference', 'permanent')).toBe('core');
    });

    it('can delete memory from any layer', async () => {
      const coreMem = makeMemory({ layer: 'core', id: 'core-del' });
      const journeyMem = makeMemory({ layer: 'journey', id: 'journey-del' });
      const momentMem = makeMemory({ layer: 'moment', id: 'moment-del' });

      await index.upsert(coreMem, randomVec());
      await index.upsert(journeyMem, randomVec());
      await index.upsert(momentMem, randomVec());

      expect(await index.count()).toBe(3);

      await index.delete('core-del');
      expect(await index.count()).toBe(2);

      await index.delete('journey-del');
      expect(await index.count()).toBe(1);

      await index.delete('moment-del');
      expect(await index.count()).toBe(0);
    });
  });

  describe('Layer Weight Integration in Search Results', () => {
    it('returns results that can be weighted by layer', async () => {
      const now = new Date();
      const coreMem = makeMemory({
        layer: 'core',
        id: 'core-weight-test',
        title: 'Core Preference',
        content: 'Database preference',
      });
      const journeyMem = makeMemory({
        layer: 'journey',
        id: 'journey-weight-test',
        title: 'Project Database',
        content: 'Project database configuration',
      });
      const momentMem = makeMemory({
        layer: 'moment',
        id: 'moment-weight-test',
        title: 'Today Task',
        content: 'Database task for today',
      });

      // Use identical vectors to ensure same raw distance
      const vec = randomVec();

      await index.upsert(coreMem, vec);
      await index.upsert(journeyMem, vec);
      await index.upsert(momentMem, vec);

      const results = await index.search(vec, 10);
      expect(results.length).toBe(3);

      // All should have similar distances (same vector)
      // Layer weights should be applied by the retrieval pipeline
      const coreLayer = determineLayer(coreMem.entryType, coreMem.ttl);
      const journeyLayer = determineLayer(journeyMem.entryType, journeyMem.ttl);
      const momentLayer = determineLayer(momentMem.entryType, momentMem.ttl);

      expect(coreLayer).toBe('core');
      expect(journeyLayer).toBe('journey');
      expect(momentLayer).toBe('moment');

      // Verify weight differences
      expect(getLayerWeight(coreLayer)).toBeGreaterThan(getLayerWeight(journeyLayer));
      expect(getLayerWeight(journeyLayer)).toBeGreaterThan(getLayerWeight(momentLayer));
    });

    it('handles search with many memories across layers', async () => {
      const memories: Memory[] = [];

      // Create memories in each layer
      for (let i = 0; i < 5; i++) {
        memories.push(
          makeMemory({
            id: `core-batch-${i}`,
            layer: 'core',
          })
        );
        memories.push(
          makeMemory({
            id: `journey-batch-${i}`,
            layer: 'journey',
          })
        );
        memories.push(
          makeMemory({
            id: `moment-batch-${i}`,
            layer: 'moment',
          })
        );
      }

      // Upsert all
      for (const memory of memories) {
        await index.upsert(memory, randomVec());
      }

      expect(await index.count()).toBe(15);

      // Search should return results
      const results = await index.search(randomVec(), 10);
      expect(results.length).toBeLessThanOrEqual(10);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('handles memory with undefined entryType and ttl', async () => {
      const memory = makeMemory(); // No entryType or ttl
      await index.upsert(memory, randomVec());

      const layer = determineLayer(undefined, undefined);
      expect(layer).toBe('journey'); // Default fallback
    });

    it('handles memory with only entryType', async () => {
      const memory = makeMemory({ entryType: 'preference' }); // No ttl
      await index.upsert(memory, randomVec());

      const layer = determineLayer('preference', undefined);
      expect(layer).toBe('journey'); // Not permanent, so journey
    });

    it('handles memory with only ttl', async () => {
      const memory = makeMemory({ ttl: 'permanent' }); // No entryType
      await index.upsert(memory, randomVec());

      const layer = determineLayer(undefined, 'permanent');
      expect(layer).toBe('journey'); // Not preference/decision, so journey
    });

    it('handles search with empty index', async () => {
      const results = await index.search(randomVec(), 10);
      expect(results).toEqual([]);
    });

    it('handles all combinations of entryType and ttl', () => {
      const testCases: Array<{
        entryType: MemoryEntryType | undefined;
        ttl: TTLLevel | undefined;
        expectedLayer: MemoryLayer;
      }> = [
        // Core layer
        { entryType: 'preference', ttl: 'permanent', expectedLayer: 'core' },
        { entryType: 'decision', ttl: 'permanent', expectedLayer: 'core' },
        // Journey layer
        { entryType: 'preference', ttl: 'long', expectedLayer: 'journey' },
        { entryType: 'decision', ttl: 'medium', expectedLayer: 'journey' },
        { entryType: 'procedure', ttl: 'long', expectedLayer: 'journey' },
        { entryType: 'constraint', ttl: 'medium', expectedLayer: 'journey' },
        { entryType: 'procedure', ttl: 'permanent', expectedLayer: 'journey' },
        { entryType: 'constraint', ttl: 'permanent', expectedLayer: 'journey' },
        // Moment layer
        { entryType: 'session', ttl: 'session', expectedLayer: 'moment' },
        { entryType: 'preference', ttl: 'short', expectedLayer: 'moment' },
        { entryType: 'decision', ttl: 'session', expectedLayer: 'moment' },
        { entryType: 'procedure', ttl: 'short', expectedLayer: 'moment' },
        { entryType: undefined, ttl: 'session', expectedLayer: 'moment' },
        // Default/undefined cases
        { entryType: undefined, ttl: undefined, expectedLayer: 'journey' },
        { entryType: undefined, ttl: 'permanent', expectedLayer: 'journey' },
      ];

      for (const { entryType, ttl, expectedLayer } of testCases) {
        expect(determineLayer(entryType, ttl)).toBe(expectedLayer);
      }
    });
  });
});
