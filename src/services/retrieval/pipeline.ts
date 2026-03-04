import type { Memory, SearchMemoryInput, SearchResult } from '../../contracts/types.js';
import { scoreCandidate } from './hybrid-scorer.js';
import { RuleBasedIntentRouter } from './intent-router.js';
import { RuleBasedQueryRewriter } from './query-rewriter.js';
import { createReranker } from './reranker.js';
import type {
  IntentRouter,
  QueryRewriter,
  RetrievalCandidate,
  RetrievalPipelineContext,
  Reranker,
} from './types.js';

interface InternalCandidateState {
  memory: Memory;
  vectorScore: number;
  keywordScore: number;
  factScore: number;
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

function scoreFactMatch(memory: Memory, variants: readonly string[]): number {
  if (!memory.facts || memory.facts.length === 0) return 0;
  const query = variants.join(' ');
  const isScheduleQuery = /(下班|加班|几点|时间|when|time)/i.test(query);
  if (!isScheduleQuery) return 0;

  const hasOffTime = memory.facts.some(fact => fact.key === 'work_schedule.off_time');
  return hasOffTime ? 1 : 0;
}

export class RetrievalPipeline {
  private readonly intentRouter: IntentRouter;
  private readonly queryRewriter: QueryRewriter;
  private readonly reranker: Reranker;
  private readonly now: () => Date;

  constructor(
    private readonly context: RetrievalPipelineContext,
    deps?: { intentRouter?: IntentRouter; queryRewriter?: QueryRewriter; reranker?: Reranker }
  ) {
    this.intentRouter = deps?.intentRouter ?? new RuleBasedIntentRouter();
    this.queryRewriter = deps?.queryRewriter ?? new RuleBasedQueryRewriter();
    this.reranker = deps?.reranker ?? createReranker({ mode: 'auto' });
    this.now = context.now ?? (() => new Date());
  }

  async search(input: SearchMemoryInput): Promise<{ results: SearchResult[]; total: number }> {
    const routed = await this.intentRouter.route(input.query);
    const rewritten = await this.queryRewriter.rewrite(input.query);
    const limit = input.limit ?? 10;

    const memories = await this.context.listMemories({
      category: input.category,
      tags: input.tags,
    });

    const stateById = new Map<string, InternalCandidateState>();
    for (const memory of memories) {
      const keyword = scoreKeywordMatch(memory, rewritten.variants);
      const factScore = scoreFactMatch(memory, rewritten.variants);
      if (keyword.score === 0 && factScore === 0) continue;

      stateById.set(memory.id, {
        memory,
        vectorScore: 0,
        keywordScore: keyword.score,
        factScore,
        matches: keyword.matches,
      });
    }

    if (this.context.vectorRetriever) {
      const vectorHits = await this.context.vectorRetriever.search({
        query: rewritten.normalized,
        variants: rewritten.variants,
        limit: Math.max(limit * 3, 20),
        category: input.category,
        tags: input.tags,
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
          factScore: scoreFactMatch(memory, rewritten.variants),
          matches: [...hit.matches],
        });
      }
    }

    const candidates: RetrievalCandidate[] = [];
    for (const state of stateById.values()) {
      const scored = scoreCandidate({
        intent: routed.intent,
        vectorScore: state.vectorScore,
        keywordScore: state.keywordScore,
        factScore: state.factScore,
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
          fact: scored.fact,
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
      query: rewritten.normalized,
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
