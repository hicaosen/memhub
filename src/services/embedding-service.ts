/**
 * Embedding Service - Text embedding using node-llama-cpp
 *
 * Uses the nomic-embed-text-v2-moe GGUF model (~328MB, stored in ~/.memhub/models/).
 * Singleton pattern with lazy initialization.
 *
 * Note: Uses dynamic imports to avoid loading native modules during tests.
 */

import { getModelByKind, resolveModelPath } from './model-manager/index.js';
import { createLogger, type Logger } from '../utils/logger.js';

/** Model kind for embedding */
const MODEL_KIND = 'embedding' as const;

/** Output vector dimension for nomic-embed-text-v2-moe */
export const VECTOR_DIM = 768;

// Lazy-initialized logger
let _logger: Logger | null = null;
function getLogger(): Logger {
  if (!_logger) {
    _logger = createLogger();
  }
  return _logger;
}

/**
 * Singleton embedding service backed by a local GGUF model.
 * The model file is stored in `~/.memhub/models/nomic-embed-text-v2-moe/`.
 */
export class EmbeddingService {
  private static instance: EmbeddingService | null = null;
  private context: object | null = null;
  private initPromise: Promise<void> | null = null;
  private initError: Error | null = null;

  private constructor() {
    // Constructor is empty - initialization happens in initialize()
  }

  static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  /**
   * Initializes the embedding context (idempotent, safe to call multiple times).
   */
  async initialize(): Promise<void> {
    // Return early if already initialized
    if (this.context) {
      return;
    }

    // Return any existing initialization error
    if (this.initError) {
      throw this.initError;
    }

    // Use existing promise if initialization is in progress
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const startTime = Date.now();
        try {
          await getLogger().info('embedding_init_start', 'Initializing embedding model');

          // Get model configuration and resolve path
          const model = getModelByKind(MODEL_KIND);
          if (!model) {
            throw new Error(`Model configuration not found for kind: ${MODEL_KIND}`);
          }

          const { modelFile, exists } = resolveModelPath(model);
          if (!exists) {
            throw new Error(
              `Embedding model file not found at ${modelFile}. ` +
                `Please run 'memhub install' to download required models.`
            );
          }

          // Dynamic import to avoid loading native modules during tests
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
          const { getLlama } = await import('node-llama-cpp');

          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
          const llama = await getLlama();
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          const llamaModel = await llama.loadModel({ modelPath: modelFile });
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          this.context = await llamaModel.createEmbeddingContext();

          await getLogger().info('embedding_init_complete', 'Embedding model initialized', {
            durationMs: Date.now() - startTime,
            meta: { model: model.name },
          });
        } catch (error) {
          // Store error for future calls and clean up promise
          this.initError = error instanceof Error ? error : new Error(String(error));
          this.initPromise = null;
          await getLogger().error(
            'embedding_init_failed',
            `Failed to initialize embedding model: ${this.initError.message}`,
            {
              durationMs: Date.now() - startTime,
            }
          );
          throw this.initError;
        }
      })();
    }

    await this.initPromise;
  }

  /**
   * Embeds `text` into a 768-dimension float vector.
   *
   * @param text - The text to embed (title + content recommended)
   * @returns Normalised float vector of length VECTOR_DIM
   */
  async embed(text: string): Promise<number[]> {
    const startTime = Date.now();
    await this.initialize();

    if (!this.context) {
      throw new Error('EmbeddingService: context not initialized');
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const embedding = await (
      this.context as { getEmbeddingFor(text: string): Promise<{ vector: readonly number[] }> }
    ).getEmbeddingFor(text);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const vector = embedding.vector;

    await getLogger().debug('embedding_complete', `Embedded text (${text.length} chars)`, {
      durationMs: Date.now() - startTime,
      meta: { textLength: text.length, vectorDim: vector.length },
    });

    return Array.from(vector);
  }

  /**
   * Convenience: embed a memory's title and content together.
   */
  async embedMemory(title: string, content: string): Promise<number[]> {
    return this.embed(`${title} ${content}`.trim());
  }

  /**
   * Reset the singleton instance.
   * @internal For testing purposes only. Do not use in production code.
   */
  static _reset(): void {
    EmbeddingService.instance = null;
  }
}
