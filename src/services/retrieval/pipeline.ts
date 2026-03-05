import type { Memory, RetrievalIntent, SearchResult } from '../../contracts/types.js';
import { scoreCandidate } from './hybrid-scorer.js';
import { createReranker } from './reranker.js';
import type {
  RetrievalCandidate,
  RetrievalPipelineContext,
  Reranker,
} from './types.js';

interface InternalCandidateState {
  memory: Memory;
  vectorScore: number;
  keywordScore: number;
  matches: string[];
}

function tokenize(text: string): string[] {
  const lower = text.toLowerCase().trim();
  const pieces = lower.split(/\s+/).filter(Boolean);
  const cjkChunks = text.match(/[\u4e00-\u9fff]{1,}/g) ?? [];
  for (const chunk of cjkChunks) {
    pieces.push(chunk);
    if (chunk.length > 1) {
      pieces.push(...Array.from(chunk));
    }
  }
  return Array.from(new Set(pieces));
}

function scoreKeywordMatch(
  memory: Memory,
  variants: readonly string[]
): { score: number; matches: string[] } {
  const textTitle = memory.title.toLowerCase();
  const textContent = memory.content.toLowerCase();
  const matches: string[] = [];
  let score = 0;

  for (const variantRaw of variants) {
    const variant = variantRaw.toLowerCase();
    if (textTitle.includes(variant)) {
      score += 0.5;
      matches.push(memory.title);
    }
    if (textContent.includes(variant)) {
      score += 0.3;
      const idx = textContent.indexOf(variant);
      const snippet = memory.content.slice(
        Math.max(0, idx - 20),
        Math.min(memory.content.length, idx + 40)
      );
      matches.push(snippet);
    }
    for (const tag of memory.tags) {
      if (tag.toLowerCase().includes(variant)) {
        score += 0.2;
        matches.push(`Tag: ${tag}`);
      }
    }
  }

  const queryTokens = new Set(variants.flatMap(tokenize));
  const memoryTokens = new Set(
    tokenize(`${memory.title} ${memory.content} ${(memory.tags ?? []).join(' ')}`)
  );
  let overlap = 0;
  for (const token of queryTokens) {
    if (memoryTokens.has(token)) overlap += 1;
  }
  if (queryTokens.size > 0) {
    score += Math.min(0.5, overlap / queryTokens.size);
  }

  return {
    score: Math.min(1, score),
    matches: Array.from(new Set(matches)).slice(0, 4),
  };
}

/** Internal input type with caller-provided intents and rewrites */
interface PipelineSearchInput {
  readonly query: string;
  readonly category?: string;
  readonly intents: {
    readonly primary: RetrievalIntent;
    readonly fallbacks: readonly [RetrievalIntent, RetrievalIntent];
  };
  readonly rewrittenQueries?: readonly [string, string, string];
  readonly limit: number;
}

export class RetrievalPipeline {
  private readonly reranker: Reranker;
  private readonly now: () => Date;

  constructor(
    private readonly context: RetrievalPipelineContext,
    deps?: { reranker?: Reranker }
  ) {
    this.reranker = deps?.reranker ?? createReranker({ mode: 'auto' });
    this.now = context.now ?? (() => new Date());
  }

  async search(input: PipelineSearchInput): Promise<{ results: SearchResult[]; total: number }> {
    // Build query variants: original + caller-provided rewrites
    const variants: string[] = [input.query];
    if (input.rewrittenQueries) {
      variants.push(...input.rewrittenQueries);
    }

    const limit = input.limit;
    const memories = await this.context.listMemories();

    const stateById = new Map<string, InternalCandidateState>();
    for (const memory of memories) {
      const keyword = scoreKeywordMatch(memory, variants);
      if (keyword.score === 0) continue;

      stateById.set(memory.id, {
        memory,
        vectorScore: 0,
        keywordScore: keyword.score,
        matches: keyword.matches,
      });
    }

    if (this.context.vectorRetriever) {
      const vectorHits = await this.context.vectorRetriever.search({
        query: input.query,
        variants,
        limit: Math.max(limit * 3, 20),
      });

      const memoryMap = new Map(memories.map(memory => [memory.id, memory]));
      for (const hit of vectorHits) {
        const memory = memoryMap.get(hit.id);
        if (!memory) continue;
        const existing = stateById.get(hit.id);
        if (existing) {
          existing.vectorScore = Math.max(existing.vectorScore, hit.score);
          existing.matches = Array.from(new Set([...existing.matches, ...hit.matches]));
          continue;
        }
        stateById.set(hit.id, {
          memory,
          vectorScore: hit.score,
          keywordScore: 0,
          matches: [...hit.matches],
        });
      }
    }

    // Map caller's intent to internal scoring
    const intentMap: Record<RetrievalIntent, 'keyword_lookup' | 'semantic_lookup'> = {
      semantic: 'semantic_lookup',
      keyword: 'keyword_lookup',
      hybrid: 'semantic_lookup',
    };

    const candidates: RetrievalCandidate[] = [];
    for (const state of stateById.values()) {
      // Apply category filter if specified
      if (input.category && state.memory.category !== input.category) {
        continue;
      }

      const scored = scoreCandidate({
        intent: intentMap[input.intents.primary],
        vectorScore: state.vectorScore,
        keywordScore: state.keywordScore,
        importance: state.memory.importance,
        updatedAt: state.memory.updatedAt,
        now: this.now(),
      });
      candidates.push({
        memory: state.memory,
        matches: state.matches.slice(0, 4),
        breakdown: {
          vector: scored.vector,
          keyword: scored.keyword,
          importanceBoost: scored.importanceBoost,
          freshnessBoost: scored.freshnessBoost,
          rerank: scored.rerank,
        },
        finalScore: scored.finalScore,
      });
    }

    const topCandidates = candidates
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, Math.max(limit * 3, 20));
    const reranked = await this.reranker.rerank({
      query: input.query,
      candidates: topCandidates,
    });

    const results: SearchResult[] = reranked
      .map(candidate => ({
        memory: candidate.memory,
        score: candidate.finalScore,
        matches: candidate.matches,
      }))
      .slice(0, limit);

    return {
      results,
      total: results.length,
    };
  }
}
