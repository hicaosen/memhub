import { describe, expect, it } from 'vitest';
import { scoreCandidate } from '../../../src/services/retrieval/hybrid-scorer.js';

describe('scoreCandidate', () => {
  const now = new Date('2026-03-04T12:00:00.000Z');

  it('uses keyword-heavy weights for keyword_lookup', () => {
    const scored = scoreCandidate({
      intent: 'keyword_lookup',
      vectorScore: 0.1,
      keywordScore: 1,
      importance: 1,
      updatedAt: '2026-03-04T11:00:00.000Z',
      now,
    });
    expect(scored.finalScore).toBeGreaterThan(0.5);
    expect(scored.keyword).toBe(1);
  });

  it('uses vector-heavy weights for semantic_lookup and clamps scores', () => {
    const scored = scoreCandidate({
      intent: 'semantic_lookup',
      vectorScore: 1,
      keywordScore: 1,
      importance: 5,
      updatedAt: '2026-03-04T11:00:00.000Z',
      now,
      rerankScore: 3,
    });
    expect(scored.finalScore).toBeLessThanOrEqual(1);
  });

  it('handles stale memories with minimal recency boost', () => {
    const scored = scoreCandidate({
      intent: 'semantic_lookup',
      vectorScore: 0,
      keywordScore: 0,
      importance: 1,
      updatedAt: '2020-01-01T00:00:00.000Z',
      now,
      rerankScore: -1,
    });
    expect(scored.recencyBoost).toBeGreaterThanOrEqual(0);
    expect(scored.rerank).toBe(0);
  });
});
