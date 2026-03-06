import { describe, expect, it, vi } from 'vitest';
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

describe('LightweightCrossEncoderReranker', () => {
  it('reranks candidates by token overlap', async () => {
    const reranker = new LightweightCrossEncoderReranker();

    const output = await reranker.rerank({
      query: 'project planning',
      candidates: [
        candidate('a', 'Meeting', 'notes only'),
        candidate('b', 'Project Planning', 'timeline and resources'),
      ],
    });

    expect(output[0].memory.id).toBe('b');
  });

  it('handles empty candidates', async () => {
    const reranker = new LightweightCrossEncoderReranker();

    const output = await reranker.rerank({
      query: 'test query',
      candidates: [],
    });

    expect(output).toEqual([]);
  });

  it('handles Chinese text tokenization', async () => {
    const reranker = new LightweightCrossEncoderReranker();

    const output = await reranker.rerank({
      query: '项目计划',
      candidates: [candidate('a', '会议', '只是笔记'), candidate('b', '项目计划', '时间线和资源')],
    });

    expect(output[0].memory.id).toBe('b');
  });

  it('handles mixed Chinese and English text', async () => {
    const reranker = new LightweightCrossEncoderReranker();

    const output = await reranker.rerank({
      query: 'React 组件开发',
      candidates: [
        candidate('a', 'Vue Guide', 'Vue.js documentation'),
        candidate('b', 'React Development', 'React 组件开发指南'),
      ],
    });

    expect(output[0].memory.id).toBe('b');
  });

  it('preserves all candidates in result', async () => {
    const reranker = new LightweightCrossEncoderReranker();

    const input = {
      query: 'test',
      candidates: [candidate('a', 'A', 'content'), candidate('b', 'B', 'content')],
    };

    const output = await reranker.rerank(input);

    expect(output.length).toBe(2);
    expect(output.map(c => c.memory.id).sort()).toEqual(['a', 'b']);
  });
});

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

  it('throws error when model mode fails', async () => {
    const reranker = new ModelCrossEncoderReranker({
      mode: 'model',
      scorePair: async () => {
        throw new Error('Model error');
      },
    });

    await expect(
      reranker.rerank({
        query: 'test',
        candidates: [candidate('a', 'A', 'content')],
      })
    ).rejects.toThrow('Model error');
  });

  it('uses lightweight reranker in lightweight mode', async () => {
    const reranker = new ModelCrossEncoderReranker({
      mode: 'lightweight',
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

  it('clamps scorePair return values', async () => {
    const reranker = new ModelCrossEncoderReranker({
      mode: 'model',
      scorePair: async (_q, text) => {
        if (text.includes('high')) return 5; // > 1
        if (text.includes('low')) return -2; // < 0
        return NaN;
      },
    });

    const output = await reranker.rerank({
      query: 'test',
      candidates: [
        candidate('a', 'high score', 'content'),
        candidate('b', 'low score', 'content'),
        candidate('c', 'nan score', 'content'),
      ],
    });

    // Should not throw, scores should be clamped
    expect(output.length).toBe(3);
  });

  it('respects maxCandidates option', async () => {
    const scoreCalls: string[] = [];
    const reranker = new ModelCrossEncoderReranker({
      mode: 'model',
      maxCandidates: 2,
      scorePair: async (_q, text) => {
        scoreCalls.push(text);
        return 0.5;
      },
    });

    const candidates = [
      candidate('a', 'A', 'content'),
      candidate('b', 'B', 'content'),
      candidate('c', 'C', 'content'),
    ];

    await reranker.rerank({
      query: 'test',
      candidates,
    });

    // Only first 2 candidates should be scored
    expect(scoreCalls.length).toBe(2);
  });

  it('handles empty candidates', async () => {
    const reranker = new ModelCrossEncoderReranker({
      mode: 'model',
      scorePair: async () => 0.5,
    });

    const output = await reranker.rerank({
      query: 'test',
      candidates: [],
    });

    expect(output).toEqual([]);
  });

  it('uses default auto mode when mode not specified', async () => {
    const reranker = new ModelCrossEncoderReranker({
      scorePair: async (_q, text) => (text.includes('target') ? 0.9 : 0.1),
    });

    const output = await reranker.rerank({
      query: 'query',
      candidates: [candidate('a', 'A', 'normal'), candidate('b', 'B', 'target')],
    });

    expect(output[0].memory.id).toBe('b');
  });
});

describe('createReranker', () => {
  it('returns lightweight reranker for lightweight mode', () => {
    const reranker = createReranker({ mode: 'lightweight' });
    expect(reranker).toBeInstanceOf(LightweightCrossEncoderReranker);
  });

  it('returns ModelCrossEncoderReranker for auto mode', () => {
    const reranker = createReranker({ mode: 'auto' });
    expect(reranker).toBeInstanceOf(ModelCrossEncoderReranker);
  });

  it('returns ModelCrossEncoderReranker for model mode', () => {
    const reranker = createReranker({ mode: 'model' });
    expect(reranker).toBeInstanceOf(ModelCrossEncoderReranker);
  });

  it('returns ModelCrossEncoderReranker with auto mode by default', () => {
    const reranker = createReranker();
    expect(reranker).toBeInstanceOf(ModelCrossEncoderReranker);
  });
});
