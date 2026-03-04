import { describe, expect, it } from 'vitest';
import type { Memory } from '../../../src/contracts/types.js';
import { RetrievalPipeline } from '../../../src/services/retrieval/pipeline.js';
import type {
  RetrievalPipelineContext,
  VectorRetriever,
} from '../../../src/services/retrieval/types.js';

const now = new Date('2026-03-04T10:40:00.000Z').toISOString();

function makeMemory(partial: Partial<Memory>): Memory {
  return {
    id: partial.id ?? '550e8400-e29b-41d4-a716-446655440000',
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    tags: partial.tags ?? [],
    category: partial.category ?? 'general',
    importance: partial.importance ?? 3,
    title: partial.title ?? 'memory',
    content: partial.content ?? '',
    facts: partial.facts,
    sessionId: partial.sessionId,
    entryType: partial.entryType,
  };
}

describe('RetrievalPipeline', () => {
  it('returns a schedule fact memory when query uses synonym', async () => {
    const scheduleMemory = makeMemory({
      id: '550e8400-e29b-41d4-a716-446655440001',
      title: 'User work schedule',
      content: '用户一般每天加班到21:00，工作时间较长。',
      importance: 4,
      facts: [{ key: 'work_schedule.off_time', value: '21:00', confidence: 0.95, source: 'rule' }],
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
      now: () => new Date(now),
    };

    const pipeline = new RetrievalPipeline(ctx);
    const result = await pipeline.search({ query: '我几点下班', limit: 3 });

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

    const pipeline = new RetrievalPipeline(ctx);
    const result = await pipeline.search({ query: '完全不相关的查询', limit: 3 });
    expect(result.total).toBe(0);
    expect(result.results).toEqual([]);
  });
});
