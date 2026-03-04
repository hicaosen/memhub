import type { Memory, MemoryFact, SearchMemoryInput, SearchResult } from '../../contracts/types.js';

export type RetrievalIntent = 'fact_lookup' | 'keyword_lookup' | 'semantic_lookup';

export type RetrievalPrimary = 'fact' | 'hybrid';

export interface IntentRoute {
  readonly intent: RetrievalIntent;
  readonly confidence: number;
  readonly primary: RetrievalPrimary;
}

export interface RewriteOutput {
  readonly normalized: string;
  readonly variants: readonly string[];
}

export interface CandidateScoreBreakdown {
  readonly vector: number;
  readonly keyword: number;
  readonly fact: number;
  readonly importanceBoost: number;
  readonly freshnessBoost: number;
  readonly rerank: number;
}

export interface RetrievalCandidate {
  readonly memory: Memory;
  readonly matches: readonly string[];
  readonly breakdown: CandidateScoreBreakdown;
  readonly finalScore: number;
}

export interface VectorHit {
  readonly id: string;
  readonly score: number;
  readonly matches: readonly string[];
}

export interface VectorRetriever {
  search(input: {
    query: string;
    variants: readonly string[];
    limit: number;
    category?: string;
    tags?: readonly string[];
  }): Promise<readonly VectorHit[]>;
}

export interface RetrievalPipelineContext {
  listMemories(input: { category?: string; tags?: readonly string[] }): Promise<readonly Memory[]>;
  vectorRetriever?: VectorRetriever;
  now?: () => Date;
}

export interface QueryRewriter {
  rewrite(query: string): RewriteOutput;
}

export interface IntentRouter {
  route(query: string): IntentRoute;
}

export interface FactExtractor {
  extract(input: { title: string; content: string }): readonly MemoryFact[];
}

export interface Reranker {
  rerank(input: {
    query: string;
    candidates: readonly RetrievalCandidate[];
  }): Promise<readonly RetrievalCandidate[]>;
}

export interface RetrievalPipelinePort {
  search(input: SearchMemoryInput): Promise<{ results: SearchResult[]; total: number }>;
}
