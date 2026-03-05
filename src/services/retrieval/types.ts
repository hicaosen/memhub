import type { Memory, SearchMemoryInput, SearchResult } from '../../contracts/types.js';

export type RetrievalPrimary = 'hybrid';

export interface CandidateScoreBreakdown {
  readonly vector: number;
  readonly keyword: number;
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
  }): Promise<readonly VectorHit[]>;
}

export interface RetrievalPipelineContext {
  listMemories(): Promise<readonly Memory[]>;
  vectorRetriever?: VectorRetriever;
  now?: () => Date;
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

export type LlmAssistantMode = 'disabled' | 'auto';

export interface LlmAssistantConfig {
  readonly mode?: LlmAssistantMode;
  readonly modelPath?: string;
  readonly threads?: number;
}
