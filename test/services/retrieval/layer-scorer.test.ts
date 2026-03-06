import { describe, it, expect } from 'vitest';
import {
  determineLayer,
  getLayerWeight,
  getTypeWeight,
  calculateFreshnessFactor,
  LAYER_WEIGHTS,
  TYPE_WEIGHTS,
  type MemoryLayer,
} from '../../../src/services/retrieval/layer-types.js';
import { scoreCandidate, type ScoreCandidateInput } from '../../../src/services/retrieval/hybrid-scorer.js';
import type { MemoryEntryType, TTLLevel } from '../../../src/contracts/types.js';

describe('layer-types', () => {
  describe('determineLayer', () => {
    it('returns "core" for permanent preferences', () => {
      expect(determineLayer('preference', 'permanent')).toBe('core');
    });

    it('returns "core" for permanent decisions', () => {
      expect(determineLayer('decision', 'permanent')).toBe('core');
    });

    it('returns "journey" for permanent procedures (not preference/decision)', () => {
      expect(determineLayer('procedure', 'permanent')).toBe('journey');
    });

    it('returns "journey" for permanent constraints', () => {
      expect(determineLayer('constraint', 'permanent')).toBe('journey');
    });

    it('returns "journey" for long/medium ttl regardless of type', () => {
      expect(determineLayer('preference', 'long')).toBe('journey');
      expect(determineLayer('decision', 'medium')).toBe('journey');
      expect(determineLayer('procedure', 'long')).toBe('journey');
      expect(determineLayer('constraint', 'medium')).toBe('journey');
    });

    it('returns "moment" for short ttl', () => {
      expect(determineLayer('preference', 'short')).toBe('moment');
      expect(determineLayer('session', 'short')).toBe('moment');
    });

    it('returns "moment" for session ttl', () => {
      expect(determineLayer('session', 'session')).toBe('moment');
      expect(determineLayer('preference', 'session')).toBe('moment');
    });

    it('returns "journey" for undefined entryType with undefined ttl', () => {
      expect(determineLayer(undefined, undefined)).toBe('journey');
    });

    it('returns "journey" for undefined entryType with long ttl', () => {
      expect(determineLayer(undefined, 'long')).toBe('journey');
    });

    it('returns "journey" for undefined entryType with medium ttl', () => {
      expect(determineLayer(undefined, 'medium')).toBe('journey');
    });

    it('returns "moment" for undefined entryType with short ttl', () => {
      expect(determineLayer(undefined, 'short')).toBe('moment');
    });

    it('returns "moment" for undefined entryType with session ttl', () => {
      expect(determineLayer(undefined, 'session')).toBe('moment');
    });
  });

  describe('LAYER_WEIGHTS', () => {
    it('has core weight of 1.2', () => {
      expect(LAYER_WEIGHTS.core).toBe(1.2);
    });

    it('has journey weight of 1.0', () => {
      expect(LAYER_WEIGHTS.journey).toBe(1.0);
    });

    it('has moment weight of 0.8', () => {
      expect(LAYER_WEIGHTS.moment).toBe(0.8);
    });
  });

  describe('TYPE_WEIGHTS', () => {
    it('has decision weight of 1.1 (highest)', () => {
      expect(TYPE_WEIGHTS.decision).toBe(1.1);
    });

    it('has preference weight of 1.0', () => {
      expect(TYPE_WEIGHTS.preference).toBe(1.0);
    });

    it('has constraint weight of 1.0', () => {
      expect(TYPE_WEIGHTS.constraint).toBe(1.0);
    });

    it('has procedure weight of 0.9', () => {
      expect(TYPE_WEIGHTS.procedure).toBe(0.9);
    });

    it('has session weight of 0.7 (lowest)', () => {
      expect(TYPE_WEIGHTS.session).toBe(0.7);
    });
  });

  describe('getLayerWeight', () => {
    it('returns correct weight for each layer', () => {
      expect(getLayerWeight('core')).toBe(1.2);
      expect(getLayerWeight('journey')).toBe(1.0);
      expect(getLayerWeight('moment')).toBe(0.8);
    });
  });

  describe('getTypeWeight', () => {
    it('returns correct weight for each type', () => {
      expect(getTypeWeight('decision')).toBe(1.1);
      expect(getTypeWeight('preference')).toBe(1.0);
      expect(getTypeWeight('constraint')).toBe(1.0);
      expect(getTypeWeight('procedure')).toBe(0.9);
      expect(getTypeWeight('session')).toBe(0.7);
    });

    it('returns 1.0 for undefined entryType', () => {
      expect(getTypeWeight(undefined)).toBe(1.0);
    });
  });

  describe('calculateFreshnessFactor', () => {
    const now = new Date('2024-06-15T12:00:00Z');

    it('returns 1.0 for memories without expiry', () => {
      const createdAt = '2024-01-01T00:00:00Z';
      expect(calculateFreshnessFactor(undefined, createdAt, now)).toBe(1.0);
    });

    it('returns 1.0 for newly created memories', () => {
      const createdAt = '2024-06-15T12:00:00Z';
      const expiresAt = '2024-07-15T12:00:00Z';
      expect(calculateFreshnessFactor(expiresAt, createdAt, now)).toBe(1.0);
    });

    it('returns lower value as memory approaches expiry', () => {
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
});

describe('scoreCandidate with layers', () => {
  const now = new Date('2024-06-15T12:00:00Z');

  const baseInput: ScoreCandidateInput = {
    intent: 'semantic_lookup',
    vectorScore: 0.8,
    keywordScore: 0.5,
    importance: 3,
    updatedAt: '2024-06-01T00:00:00Z',
    now,
  };

  describe('layer weight application', () => {
    it('applies higher weight to core layer (permanent preference)', () => {
      const core = scoreCandidate({
        ...baseInput,
        entryType: 'preference',
        ttl: 'permanent',
      });
      expect(core.layerWeight).toBe(1.2);
      expect(core.typeWeight).toBe(1.0);
    });

    it('applies default weight to journey layer (long ttl)', () => {
      const journey = scoreCandidate({
        ...baseInput,
        entryType: 'procedure',
        ttl: 'long',
      });
      expect(journey.layerWeight).toBe(1.0);
      expect(journey.typeWeight).toBe(0.9);
    });

    it('applies lower weight to moment layer (session ttl)', () => {
      const moment = scoreCandidate({
        ...baseInput,
        entryType: 'session',
        ttl: 'session',
      });
      expect(moment.layerWeight).toBe(0.8);
      expect(moment.typeWeight).toBe(0.7);
    });
  });

  describe('final score calculation', () => {
    it('core memories score higher than moment memories with same base scores', () => {
      const core = scoreCandidate({
        ...baseInput,
        entryType: 'decision',
        ttl: 'permanent',
        vectorScore: 0.8,
        keywordScore: 0.5,
      });

      const moment = scoreCandidate({
        ...baseInput,
        entryType: 'session',
        ttl: 'session',
        vectorScore: 0.8,
        keywordScore: 0.5,
      });

      // Core should have higher final score due to layer and type weights
      expect(core.finalScore).toBeGreaterThan(moment.finalScore);
    });

    it('decision type gets higher weight than preference', () => {
      const decision = scoreCandidate({
        ...baseInput,
        entryType: 'decision',
        ttl: 'permanent',
      });

      const preference = scoreCandidate({
        ...baseInput,
        entryType: 'preference',
        ttl: 'permanent',
      });

      // Both are core layer, but decision has type weight 1.1 vs 1.0
      expect(decision.typeWeight).toBeGreaterThan(preference.typeWeight);
      expect(decision.finalScore).toBeGreaterThan(preference.finalScore);
    });

    it('includes all breakdown components', () => {
      const result = scoreCandidate({
        ...baseInput,
        entryType: 'preference',
        ttl: 'medium',
        rerankScore: 0.5,
      });

      expect(result).toHaveProperty('vector');
      expect(result).toHaveProperty('keyword');
      expect(result).toHaveProperty('importanceBoost');
      expect(result).toHaveProperty('recencyBoost');
      expect(result).toHaveProperty('rerank');
      expect(result).toHaveProperty('layerWeight');
      expect(result).toHaveProperty('typeWeight');
      expect(result).toHaveProperty('freshnessFactor');
      expect(result).toHaveProperty('finalScore');
    });
  });

  describe('freshness factor integration', () => {
    it('applies freshness factor based on expiry', () => {
      const fresh = scoreCandidate({
        ...baseInput,
        entryType: 'preference',
        ttl: 'medium',
        createdAt: '2024-06-15T00:00:00Z',
        expiresAt: '2024-07-15T00:00:00Z',
      });

      const stale = scoreCandidate({
        ...baseInput,
        entryType: 'preference',
        ttl: 'medium',
        createdAt: '2024-05-15T00:00:00Z',
        expiresAt: '2024-06-16T00:00:00Z', // Expires tomorrow
      });

      // Fresh memory should have higher freshness factor
      expect(fresh.freshnessFactor).toBeGreaterThan(stale.freshnessFactor);
    });

    it('permanent memories have freshness factor of 1.0', () => {
      const permanent = scoreCandidate({
        ...baseInput,
        entryType: 'preference',
        ttl: 'permanent',
        createdAt: '2024-01-01T00:00:00Z',
        // No expiresAt for permanent
      });

      expect(permanent.freshnessFactor).toBe(1.0);
    });
  });
});
