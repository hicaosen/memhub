import { describe, expect, it } from 'vitest';
import type { Memory } from '../../../src/contracts/types.js';
import { VectorRetrieverAdapter } from '../../../src/services/retrieval/vector-retriever.js';

function makeMemory(partial: Partial<Memory>): Memory {
  const now = '2026-03-04T10:00:00.000Z';
  return {
    id: partial.id ?? '550e8400-e29b-41d4-a716-446655440000',
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    importance: partial.importance ?? 3,
    title: partial.title ?? 'title',
    content: partial.content ?? 'content',
    sessionId: partial.sessionId,
    entryType: partial.entryType,
    facts: partial.facts,
  };
}

describe('VectorRetrieverAdapter', () => {
  it('deduplicates hits across variants and keeps highest score', async () => {
    const memory = makeMemory({
      id: '550e8400-e29b-41d4-a716-446655440001',
      title: 'Schedule',
    });

    const adapter = new VectorRetrieverAdapter({
      embedding: {
        embed: async text => [text.length],
      },
      vectorIndex: {
        search: async (vec: number[]) => {
          if (vec[0] > 2) {
            return [{ id: memory.id, _distance: 0.8 }];
          }
          return [{ id: memory.id, _distance: 0.2 }];
        },
      },
      readMemoryById: async id => (id === memory.id ? memory : null),
    });

    const hits = await adapter.search({
      query: '下班时间',
      variants: ['下班', '加班', '收工'],
      limit: 5,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe(memory.id);
    expect(hits[0].score).toBeCloseTo(0.9, 5);
  });

  it('skips missing memory records', async () => {
    const first = makeMemory({
      id: '550e8400-e29b-41d4-a716-446655440002',
      title: 'Work note',
    });
    const second = makeMemory({
      id: '550e8400-e29b-41d4-a716-446655440003',
      title: 'Personal note',
    });
    const third = makeMemory({
      id: '550e8400-e29b-41d4-a716-446655440004',
      title: 'Wrong tag note',
    });

    const memoryById = new Map<string, Memory>([
      [first.id, first],
      [second.id, second],
      [third.id, third],
    ]);

    const adapter = new VectorRetrieverAdapter({
      embedding: { embed: async () => [1, 2, 3] },
      vectorIndex: {
        search: async () => [
          { id: first.id, _distance: 0.4 },
          { id: second.id, _distance: 0.1 },
          { id: third.id, _distance: 0.1 },
          { id: '550e8400-e29b-41d4-a716-446655440099', _distance: 0.1 },
        ],
      },
      readMemoryById: async id => memoryById.get(id) ?? null,
    });

    const hits = await adapter.search({
      query: 'focus',
      variants: ['focus'],
      limit: 10,
    });

    expect(hits).toHaveLength(3);
    expect(hits.map(hit => hit.id)).toEqual(
      expect.arrayContaining([first.id, second.id, third.id])
    );
  });
});
