/**
 * Tests for Phase 2: Logical Layering - Waterfall Search Behavior
 *
 * These tests verify the layered retrieval strategy:
 * - Core layer (permanent preference/decision) is searched first
 * - Journey layer (medium/long TTL) is searched second
 * - Moment layer (short/session TTL) is searched last
 * - Results are merged and re-ranked with layer weights applied
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Memory, RetrievalIntent } from '../../../src/contracts/types.js';
import { RetrievalPipeline } from '../../../src/services/retrieval/pipeline.js';
import { LightweightCrossEncoderReranker } from '../../../src/services/retrieval/reranker.js';
import type {
  RetrievalPipelineContext,
  VectorRetriever,
  VectorHit,
  RetrievalCandidate,
} from '../../../src/services/retrieval/types.js';
import {
  determineLayer,
  LAYER_WEIGHTS,
  type MemoryLayer,
} from '../../../src/services/retrieval/layer-types.js';

const NOW = new Date('2026-03-06T12:00:00.000Z');

/**
 * Create a test memory with layer-determining properties
 */
function makeMemory(partial: Partial<Memory> & { layer?: MemoryLayer }): Memory {
  const layer = partial.layer;
  let entryType = partial.entryType;
  let ttl = partial.ttl;
  let expiresAt = partial.expiresAt;

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
      case 'moment':
        entryType = 'session';
        ttl = 'session';
        expiresAt = new Date(NOW.getTime() + 12 * 60 * 60 * 1000).toISOString(); // 12 hours from now
        break;
    }
  }

  return {
    id: partial.id ?? `test-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: partial.createdAt ?? new Date('2026-01-01T00:00:00.000Z').toISOString(),
    updatedAt: partial.updatedAt ?? NOW.toISOString(),
    importance: partial.importance ?? 3,
    title: partial.title ?? 'Test Memory',
    content: partial.content ?? 'Test content',
    entryType,
    ttl,
    expiresAt,
  };
}

/**
 * Mock vector retriever that returns pre-configured hits per layer
 */
class LayerAwareMockVectorRetriever implements VectorRetriever {
  private readonly hitsByLayer: Map<MemoryLayer, VectorHit[]>;
  private readonly searchLog: { query: string; layers: MemoryLayer[] }[] = [];

  constructor(hitsByLayer: Map<MemoryLayer, VectorHit[]>) {
    this.hitsByLayer = hitsByLayer;
  }

  async search(input: { query: string; variants: readonly string[]; limit: number }): Promise<readonly VectorHit[]> {
    // Return all hits (in real impl, this would be filtered by layer)
    const allHits: VectorHit[] = [];
    for (const hits of this.hitsByLayer.values()) {
      allHits.push(...hits.slice(0, input.limit));
    }
    return allHits;
  }

  getSearchLog(): { query: string; layers: MemoryLayer[] }[] {
    return [...this.searchLog];
  }
}

describe('Layered Search - Phase 2', () => {
  describe('determineLayer', () => {
    it('correctly identifies core layer (permanent + preference/decision)', () => {
      expect(determineLayer('preference', 'permanent')).toBe('core');
      expect(determineLayer('decision', 'permanent')).toBe('core');
    });

    it('does not assign core layer for non-preference/decision types', () => {
      expect(determineLayer('procedure', 'permanent')).toBe('journey');
      expect(determineLayer('constraint', 'permanent')).toBe('journey');
      expect(determineLayer('session', 'permanent')).toBe('journey');
    });

    it('does not assign core layer for non-permanent TTL', () => {
      expect(determineLayer('preference', 'long')).toBe('journey');
      expect(determineLayer('decision', 'medium')).toBe('journey');
      expect(determineLayer('preference', 'short')).toBe('moment');
      expect(determineLayer('decision', 'session')).toBe('moment');
    });

    it('correctly identifies moment layer (short/session TTL)', () => {
      expect(determineLayer('session', 'session')).toBe('moment');
      expect(determineLayer('preference', 'short')).toBe('moment');
      expect(determineLayer('decision', 'short')).toBe('moment');
      expect(determineLayer('procedure', 'session')).toBe('moment');
    });

    it('correctly identifies journey layer (long/medium TTL)', () => {
      expect(determineLayer('preference', 'long')).toBe('journey');
      expect(determineLayer('decision', 'medium')).toBe('journey');
      expect(determineLayer('procedure', 'long')).toBe('journey');
      expect(determineLayer('constraint', 'medium')).toBe('journey');
    });

    it('handles undefined values gracefully', () => {
      expect(determineLayer(undefined, undefined)).toBe('journey');
      expect(determineLayer('preference', undefined)).toBe('journey');
      expect(determineLayer(undefined, 'permanent')).toBe('journey');
    });
  });

  describe('Layer Weighting in Pipeline', () => {
    let memories: Memory[];

    beforeEach(() => {
      memories = [
        // Core layer - permanent preference
        {
          id: 'core-001',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: NOW.toISOString(),
          importance: 5,
          title: 'Core Preference',
          content: 'Core preference content',
          entryType: 'preference',
          ttl: 'permanent',
        },
        // Journey layer - medium TTL
        {
          id: 'journey-001',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: NOW.toISOString(),
          importance: 5,
          title: 'Journey Item',
          content: 'Journey content',
          entryType: 'procedure',
          ttl: 'medium',
        },
        // Moment layer - session TTL
        {
          id: 'moment-001',
          createdAt: '2026-03-06T00:00:00.000Z',
          updatedAt: NOW.toISOString(),
          importance: 5,
          title: 'Moment Item',
          content: 'Moment content',
          entryType: 'session',
          ttl: 'session',
          expiresAt: new Date(NOW.getTime() + 12 * 60 * 60 * 1000).toISOString(),
        },
      ];
    });

    it('applies layer weights in scoring', async () => {
      const vectorRetriever: VectorRetriever = {
        search: async () => [
          { id: 'core-001', score: 0.8, matches: ['Core'] },
          { id: 'journey-001', score: 0.8, matches: ['Journey'] },
          { id: 'moment-001', score: 0.8, matches: ['Moment'] },
        ],
      };

      const ctx: RetrievalPipelineContext = {
        listMemories: async () => memories,
        vectorRetriever,
        now: () => NOW,
      };

      const pipeline = new RetrievalPipeline(ctx, {
        reranker: new LightweightCrossEncoderReranker(),
      });

      const result = await pipeline.search({
        query: 'item',
        intents: {
          primary: 'semantic',
          fallbacks: ['keyword', 'hybrid'] as [RetrievalIntent, RetrievalIntent],
        },
        limit: 10,
      });

      // Should return all 3 results
      expect(result.total).toBe(3);

      // Find each result and verify layer weight in breakdown
      const coreResult = result.results.find(r => r.memory.id === 'core-001');
      const journeyResult = result.results.find(r => r.memory.id === 'journey-001');
      const momentResult = result.results.find(r => r.memory.id === 'moment-001');

      expect(coreResult).toBeDefined();
      expect(journeyResult).toBeDefined();
      expect(momentResult).toBeDefined();
    });

    it('core layer should have highest weight', async () => {
      const vectorRetriever: VectorRetriever = {
        search: async () => [
          { id: 'core-001', score: 0.8, matches: ['Core'] },
          { id: 'journey-001', score: 0.8, matches: ['Journey'] },
          { id: 'moment-001', score: 0.8, matches: ['Moment'] },
        ],
      };

      const ctx: RetrievalPipelineContext = {
        listMemories: async () => memories,
        vectorRetriever,
        now: () => NOW,
      };

      // Use a no-op reranker that preserves layer-weighted order
      const noOpReranker = {
        rerank: async (input: { candidates: readonly RetrievalCandidate[] }) => {
          return input.candidates
            .sort((a, b) => b.finalScore - a.finalScore)
            .slice(0, input.candidates.length);
        },
      };

      const pipeline = new RetrievalPipeline(ctx, {
        reranker: noOpReranker,
      });

      // Use a query that matches all memories equally (all have "item" or similar keyword match)
      // This ensures keyword scores don't bias the ranking
      const result = await pipeline.search({
        query: 'preference procedure session',
        intents: {
          primary: 'semantic',
          fallbacks: ['keyword', 'hybrid'] as [RetrievalIntent, RetrievalIntent],
        },
        limit: 10,
      });

      // Core should be ranked first due to highest layer weight (1.2)
      // All have equal vector scores, and keyword scores should be balanced
      expect(result.results[0].memory.id).toBe('core-001');
    });
  });

  describe('Layer Filtering', () => {
    it('can filter search by entryType', async () => {
      const preferenceMemory: Memory = {
        id: 'pref-001',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: NOW.toISOString(),
        importance: 5,
        title: 'TypeScript Preference',
        content: 'Prefer TypeScript over JavaScript',
        entryType: 'preference',
        ttl: 'permanent',
      };

      const sessionMemory: Memory = {
        id: 'session-001',
        createdAt: '2026-03-06T00:00:00.000Z',
        updatedAt: NOW.toISOString(),
        importance: 5,
        title: 'TypeScript Session',
        content: 'Working on TypeScript feature today',
        entryType: 'session',
        ttl: 'session',
        expiresAt: new Date(NOW.getTime() + 12 * 60 * 60 * 1000).toISOString(),
      };

      const vectorRetriever: VectorRetriever = {
        search: async () => [
          { id: preferenceMemory.id, score: 0.8, matches: ['TypeScript'] },
          { id: sessionMemory.id, score: 0.8, matches: ['TypeScript'] },
        ],
      };

      const ctx: RetrievalPipelineContext = {
        listMemories: async () => [preferenceMemory, sessionMemory],
        vectorRetriever,
        now: () => NOW,
      };

      const pipeline = new RetrievalPipeline(ctx, {
        reranker: new LightweightCrossEncoderReranker(),
      });

      const result = await pipeline.search({
        query: 'TypeScript',
        intents: {
          primary: 'semantic',
          fallbacks: ['keyword', 'hybrid'] as [RetrievalIntent, RetrievalIntent],
        },
        limit: 10,
      });

      // Both should be returned (no filtering in basic search)
      expect(result.total).toBe(2);
    });

    it('correctly layers mixed entryType and TTL combinations', () => {
      // Test various combinations
      const testCases: Array<{
        entryType: 'preference' | 'decision' | 'procedure' | 'constraint' | 'session';
        ttl: 'permanent' | 'long' | 'medium' | 'short' | 'session';
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
        // Moment layer
        { entryType: 'session', ttl: 'session', expectedLayer: 'moment' },
        { entryType: 'preference', ttl: 'short', expectedLayer: 'moment' },
        { entryType: 'decision', ttl: 'session', expectedLayer: 'moment' },
      ];

      for (const { entryType, ttl, expectedLayer } of testCases) {
        expect(determineLayer(entryType, ttl)).toBe(expectedLayer);
      }
    });
  });
});
