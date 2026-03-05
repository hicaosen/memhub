import { describe, expect, it } from 'vitest';
import type { Memory } from '../../../src/contracts/types.js';
import { RetrievalPipeline } from '../../../src/services/retrieval/pipeline.js';
import { LightweightCrossEncoderReranker } from '../../../src/services/retrieval/reranker.js';
import type {
  RetrievalPipelineContext,
  VectorRetriever,
} from '../../../src/services/retrieval/types.js';

const now = new Date('2026-03-04T10:40:00.000Z').toISOString();

function makeMemory(partial: Partial<Memory>): Memory {
  return {
    id: partial.id ?? '550e8400-e29b-41d4-a716-446655440000',
    createdAt: partial.createdAt ?? new Date('2026-03-01T00:00:00.000Z').toISOString(),
    updatedAt: partial.updatedAt ?? new Date('2026-03-04T10:40:00.000Z').toISOString(),
    category: partial.category ?? 'general',
    importance: partial.importance ?? 3,
    tags: partial.tags ?? [],
    title: partial.title ?? '',
    content: partial.content ?? '',
  };
}

describe('RetrievalPipeline', () => {
  it('returns matching memory by keyword', async () => {
    const scheduleMemory = makeMemory({
      id: '550e8400-e29b-41d4-a716-446655440001',
      title: 'User work schedule',
      content: '用户一般每天加班到21:00',
      importance: 4,
    });
    const otherMemory = makeMemory({
      id: '550e8400-e29b-41d4-a716-446655440002',
      title: 'Random note',
      content: 'This is unrelated content.',
    });

    const vectorRetriever: VectorRetriever = {
      search: async () => [
        { id: scheduleMemory.id, score: 0.4, matches: ['schedule'] },
        { id: otherMemory.id, score: 0.42, matches: ['random'] },
      ],
    };

    const ctx: RetrievalPipelineContext = {
      listMemories: async () => [scheduleMemory, otherMemory],
      vectorRetriever,
    };

    // Use lightweight reranker to avoid loading LLM model
    const pipeline = new RetrievalPipeline(ctx, {
      reranker: new LightweightCrossEncoderReranker(),
    });
    const result = await pipeline.search({
      query: '加班',
      intents: {
        primary: 'semantic',
        fallbacks: ['keyword', 'hybrid'],
      },
      limit: 3,
    });

    expect(result.total).toBeGreaterThan(0);
    expect(result.results[0].memory.id).toBe(scheduleMemory.id);
  });

  it('works without vector retriever and returns empty when nothing matches', async () => {
    const ctx: RetrievalPipelineContext = {
      listMemories: async () => [
        makeMemory({
          id: '550e8400-e29b-41d4-a716-446655440010',
          title: 'Random',
          content: 'irrelevant',
        }),
      ],
      now: () => new Date(now),
    };

    // Use lightweight reranker to avoid loading LLM model
    const pipeline = new RetrievalPipeline(ctx, {
      reranker: new LightweightCrossEncoderReranker(),
    });
    const result = await pipeline.search({
      query: '完全不相关的查询',
      intents: {
        primary: 'semantic',
        fallbacks: ['keyword', 'hybrid'],
      },
      limit: 3,
    });
    expect(result.total).toBe(0);
    expect(result.results).toEqual([]);
  });
});
