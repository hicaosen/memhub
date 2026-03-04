import type { RetrievalCandidate, Reranker } from './types.js';
import { getModelByKind, resolveModelPath } from '../model-manager/index.js';
import { createLogger, type Logger } from '../../utils/logger.js';

// Lazy-initialized logger
let _logger: Logger | null = null;
function getLogger(): Logger {
  if (!_logger) {
    _logger = createLogger();
  }
  return _logger;
}

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

/** Minimal type for node-llama-cpp ranking context */
interface RankingContext {
  rankAndSort(
    query: string,
    documents: readonly string[]
  ): Promise<readonly { text: string; score?: number }[]>;
}

export type RerankerMode = 'lightweight' | 'model' | 'auto';

export interface ModelCrossEncoderRerankerOptions {
  maxCandidates?: number;
  mode?: RerankerMode;
  scorePair?: (query: string, candidateText: string) => Promise<number>;
}

export class ModelCrossEncoderReranker implements Reranker {
  private rankingContext: RankingContext | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly fallback: LightweightCrossEncoderReranker;

  constructor(private readonly options: ModelCrossEncoderRerankerOptions = {}) {
    this.fallback = new LightweightCrossEncoderReranker();
  }

  private async initialize(): Promise<void> {
    if (this.options.scorePair || this.rankingContext) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const startTime = Date.now();
        await getLogger().info('reranker_init_start', 'Initializing reranker model');

        try {
          const model = getModelByKind('reranker');
          if (!model) {
            throw new Error('Reranker model not found in model configuration');
          }

          const { modelFile } = resolveModelPath(model);
          if (!modelFile) {
            throw new Error('Unable to resolve reranker model path');
          }

          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          const { getLlama } = await import('node-llama-cpp');
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
          const llama = await getLlama();
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          const llamaModel = await llama.loadModel({ modelPath: modelFile });
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          const context = await llamaModel.createContext();
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          this.rankingContext = await (
            context as unknown as { getRankingContext: () => Promise<RankingContext> }
          ).getRankingContext();

          await getLogger().info('reranker_init_complete', 'Reranker model initialized', {
            durationMs: Date.now() - startTime,
            meta: { model: model.name },
          });
        } catch (error) {
          await getLogger().error(
            'reranker_init_failed',
            `Failed to initialize reranker: ${error instanceof Error ? error.message : String(error)}`,
            {
              durationMs: Date.now() - startTime,
            }
          );
          throw error;
        }
      })();
    }
    await this.initPromise;
  }

  private async scorePair(query: string, candidateText: string): Promise<number> {
    if (this.options.scorePair) {
      const score = await this.options.scorePair(query, candidateText);
      if (typeof score !== 'number' || Number.isNaN(score)) return 0;
      if (score < 0) return 0;
      if (score > 1) return 1;
      return score;
    }
    await this.initialize();
    if (!this.rankingContext) return 0;

    const results = await this.rankingContext.rankAndSort(query, [candidateText]);
    if (results.length === 0) return 0;
    return results[0].score ?? 0;
  }

  async rerank(input: {
    query: string;
    candidates: readonly RetrievalCandidate[];
  }): Promise<readonly RetrievalCandidate[]> {
    const startTime = Date.now();
    const mode = this.options.mode ?? 'auto';

    if (mode === 'lightweight') {
      await getLogger().debug(
        'rerank_start',
        `Reranking ${input.candidates.length} candidates (lightweight mode)`
      );
      return this.fallback.rerank(input);
    }

    const capped = input.candidates.slice(0, this.options.maxCandidates ?? 50);
    await getLogger().debug('rerank_start', `Reranking ${capped.length} candidates (${mode} mode)`);

    // Use custom scorePair function if provided, otherwise use node-llama-cpp batch ranking
    if (this.options.scorePair) {
      try {
        const scored = await Promise.all(
          capped.map(async candidate => {
            const text = `${candidate.memory.title}\n${candidate.memory.content}`;
            const score = await this.scorePair(input.query, text);
            return { candidate, score };
          })
        );
        const result = scored.sort((a, b) => b.score - a.score).map(item => item.candidate);
        await getLogger().info('rerank_complete', `Reranked ${result.length} candidates`, {
          durationMs: Date.now() - startTime,
          meta: { candidateCount: result.length, mode: 'custom' },
        });
        return result;
      } catch (error) {
        if (mode === 'model') {
          throw error;
        }
        await getLogger().warn('rerank_fallback', `Reranker failed, using fallback`, {
          meta: { error: error instanceof Error ? error.message : String(error) },
        });
        return this.fallback.rerank(input);
      }
    }

    // Use node-llama-cpp batch ranking for better performance
    try {
      await this.initialize();
      if (!this.rankingContext) {
        throw new Error('Ranking context not initialized');
      }

      const documents = capped.map(c => `${c.memory.title}\n${c.memory.content}`);

      const results = await this.rankingContext.rankAndSort(input.query, documents);

      // Map results back to candidates
      const candidateMap = new Map(capped.map((c, i) => [documents[i], c]));
      const reranked = results
        .map(r => candidateMap.get(r.text))
        .filter((c): c is RetrievalCandidate => c !== undefined);

      await getLogger().info('rerank_complete', `Reranked ${reranked.length} candidates`, {
        durationMs: Date.now() - startTime,
        meta: { candidateCount: reranked.length, mode: 'model' },
      });

      return reranked;
    } catch (error) {
      if (mode === 'model') {
        await getLogger().error(
          'rerank_failed',
          `Reranker failed: ${error instanceof Error ? error.message : String(error)}`,
          {
            durationMs: Date.now() - startTime,
          }
        );
        throw error;
      }
      await getLogger().warn(
        'rerank_fallback',
        `Model reranker failed, using lightweight fallback`,
        {
          meta: { error: error instanceof Error ? error.message : String(error) },
        }
      );
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
