import type { RetrievalCandidate, Reranker } from './types.js';

function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const latin = lower.split(/\s+/).filter(Boolean);
  const cjk = (text.match(/[\u4e00-\u9fff]{1,}/g) ?? []).flatMap(token =>
    token.length > 1 ? [token, ...Array.from(token)] : [token]
  );
  return [...latin, ...cjk];
}

export class LightweightCrossEncoderReranker implements Reranker {
  rerank(input: {
    query: string;
    candidates: readonly RetrievalCandidate[];
  }): Promise<readonly RetrievalCandidate[]> {
    const qTokens = new Set(tokenize(input.query));

    const scored = input.candidates.map(candidate => {
      const text = `${candidate.memory.title}\n${candidate.memory.content}`;
      const mTokens = tokenize(text);
      const hitCount = mTokens.reduce((acc, token) => (qTokens.has(token) ? acc + 1 : acc), 0);
      const denom = Math.max(1, qTokens.size + mTokens.length * 0.2);
      const rerankScore = Math.min(1, hitCount / denom);

      return {
        candidate,
        rerankScore,
      };
    });

    return Promise.resolve(
      scored.sort((a, b) => b.rerankScore - a.rerankScore).map(item => item.candidate)
    );
  }
}

type SequenceClassifier = (
  input: string | [string, string],
  options?: { topk?: number }
) => Promise<
  | Array<{ label?: string; score?: number }>
  | Array<Array<{ label?: string; score?: number }>>
  | { label?: string; score?: number }
>;

type TransformersModule = {
  pipeline: (task: string, model: string, options?: { progress_callback?: null }) => Promise<unknown>;
  env: {
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
  };
};

export type RerankerMode = 'lightweight' | 'model' | 'auto';

export interface ModelCrossEncoderRerankerOptions {
  modelName?: string;
  maxCandidates?: number;
  mode?: RerankerMode;
  scorePair?: (query: string, candidateText: string) => Promise<number>;
}

const DEFAULT_MODEL_NAME = 'BAAI/bge-reranker-v2-m3';

function normalizeScore(raw: unknown): number {
  if (typeof raw !== 'number' || Number.isNaN(raw)) return 0;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

function extractClassifierScore(
  raw:
    | Array<{ label?: string; score?: number }>
    | Array<Array<{ label?: string; score?: number }>>
    | { label?: string; score?: number }
): number {
  const flattened = Array.isArray(raw)
    ? raw.flatMap(item => (Array.isArray(item) ? item : [item]))
    : [raw];
  if (flattened.length === 0) return 0;
  const preferred = flattened.find(item => /relevant|1|true/i.test(item.label ?? ''));
  return normalizeScore(preferred?.score ?? flattened[0]?.score);
}

export class ModelCrossEncoderReranker implements Reranker {
  private classifier: SequenceClassifier | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly fallback: LightweightCrossEncoderReranker;

  constructor(private readonly options: ModelCrossEncoderRerankerOptions = {}) {
    this.fallback = new LightweightCrossEncoderReranker();
  }

  private async initialize(): Promise<void> {
    if (this.options.scorePair || this.classifier) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const transformers = (await import('@xenova/transformers')) as TransformersModule;
        transformers.env.allowRemoteModels = true;
        transformers.env.allowLocalModels = true;
        const pipeline = (await transformers.pipeline(
          'text-classification',
          this.options.modelName ?? DEFAULT_MODEL_NAME,
          { progress_callback: null }
        )) as SequenceClassifier;
        this.classifier = pipeline;
      })();
    }
    await this.initPromise;
  }

  private async scorePair(query: string, candidateText: string): Promise<number> {
    if (this.options.scorePair) {
      return normalizeScore(await this.options.scorePair(query, candidateText));
    }
    await this.initialize();
    if (!this.classifier) return 0;

    const raw = await this.classifier([query, candidateText], { topk: 1 });
    return extractClassifierScore(raw);
  }

  async rerank(input: {
    query: string;
    candidates: readonly RetrievalCandidate[];
  }): Promise<readonly RetrievalCandidate[]> {
    const mode = this.options.mode ?? 'auto';
    if (mode === 'lightweight') {
      return this.fallback.rerank(input);
    }

    const capped = input.candidates.slice(0, this.options.maxCandidates ?? 50);
    try {
      const scored = await Promise.all(
        capped.map(async candidate => {
          const text = `${candidate.memory.title}\n${candidate.memory.content}`;
          const score = await this.scorePair(input.query, text);
          return { candidate, score };
        })
      );

      const reranked = scored.sort((a, b) => b.score - a.score).map(item => item.candidate);
      return reranked;
    } catch (error) {
      if (mode === 'model') {
        throw error;
      }
      return this.fallback.rerank(input);
    }
  }
}

export function createReranker(options: ModelCrossEncoderRerankerOptions = {}): Reranker {
  const mode = options.mode ?? 'auto';
  if (mode === 'lightweight') {
    return new LightweightCrossEncoderReranker();
  }
  return new ModelCrossEncoderReranker(options);
}
