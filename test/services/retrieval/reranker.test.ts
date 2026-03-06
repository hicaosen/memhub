import { describe, expect, it } from 'vitest';
import type { RetrievalCandidate } from '../../../src/services/retrieval/types.js';
import {
  createReranker,
  LightweightCrossEncoderReranker,
  ModelCrossEncoderReranker,
} from '../../../src/services/retrieval/reranker.js';

function candidate(id: string, title: string, content: string): RetrievalCandidate {
  const now = '2026-03-04T10:00:00.000Z';
  return {
    memory: {
      id,
      createdAt: now,
      updatedAt: now,
      importance: 3,
      title,
      content,
    },
    matches: [],
    breakdown: {
      vector: 0,
      keyword: 0,
      fact: 0,
      importanceBoost: 0,
      freshnessBoost: 0,
      rerank: 0,
    },
    finalScore: 0,
  };
}

describe('ModelCrossEncoderReranker', () => {
  it('reranks by model score when scorePair is provided', async () => {
    const reranker = new ModelCrossEncoderReranker({
      mode: 'model',
      scorePair: async (_q, text) => (text.includes('target') ? 0.9 : 0.1),
    });

    const input = {
      query: 'query',
      candidates: [candidate('a', 'A', 'normal memory'), candidate('b', 'B', 'target memory')],
    };

    const output = await reranker.rerank(input);
    expect(output[0].memory.id).toBe('b');
  });

  it('falls back to lightweight mode when score fails in auto mode', async () => {
    const reranker = new ModelCrossEncoderReranker({
      mode: 'auto',
      scorePair: async () => {
        throw new Error('boom');
      },
    });

    const output = await reranker.rerank({
      query: 'project planning',
      candidates: [
        candidate('a', 'Meeting', 'notes only'),
        candidate('b', 'Project Planning', 'timeline and resources'),
      ],
    });

    expect(output[0].memory.id).toBe('b');
  });
});

describe('createReranker', () => {
  it('returns lightweight reranker for lightweight mode', () => {
    const reranker = createReranker({ mode: 'lightweight' });
    expect(reranker).toBeInstanceOf(LightweightCrossEncoderReranker);
  });
});
