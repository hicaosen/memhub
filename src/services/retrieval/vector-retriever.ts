import type { Memory } from '../../contracts/types.js';
import type { VectorHit, VectorRetriever } from './types.js';
import { isExpired } from '../memory/ttl-utils.js';

interface EmbeddingLike {
  embed(text: string): Promise<number[]>;
}

interface VectorIndexLike {
  search(vector: number[], limit?: number): Promise<Array<{ id: string; _distance: number }>>;
}

function distanceToScore(distance: number): number {
  return Math.max(0, Math.min(1, 1 - distance / 2));
}

export class VectorRetrieverAdapter implements VectorRetriever {
  constructor(
    private readonly deps: {
      embedding: EmbeddingLike;
      vectorIndex: VectorIndexLike;
      readMemoryById: (id: string) => Promise<Memory | null>;
    }
  ) {}

  async search(input: {
    query: string;
    variants: readonly string[];
    limit: number;
    category?: string;
    tags?: readonly string[];
  }): Promise<readonly VectorHit[]> {
    const dedup = new Map<string, VectorHit>();
    const now = new Date();

    for (const variant of input.variants.slice(0, 3)) {
      const vector = await this.deps.embedding.embed(variant);
      const results = await this.deps.vectorIndex.search(vector, input.limit);
      for (const item of results) {
        const memory = await this.deps.readMemoryById(item.id);
        if (!memory) continue;
        // Skip expired memories
        if (isExpired(memory.expiresAt, now)) continue;
        if (input.category && memory.category !== input.category) continue;
        if (
          input.tags &&
          input.tags.length > 0 &&
          !input.tags.every(tag => memory.tags.includes(tag))
        ) {
          continue;
        }

        const score = distanceToScore(item._distance);
        const exists = dedup.get(item.id);
        if (!exists || score > exists.score) {
          dedup.set(item.id, {
            id: item.id,
            score,
            matches: [memory.title],
          });
        }
      }
    }

    return Array.from(dedup.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, input.limit);
  }
}
