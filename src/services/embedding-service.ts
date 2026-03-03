/**
 * Embedding Service - Text embedding using @xenova/transformers
 *
 * Uses the all-MiniLM-L6-v2 model (~23MB, downloaded on first use to ~/.cache/huggingface).
 * Singleton pattern with lazy initialization.
 *
 * Note: Uses dynamic imports to avoid loading native modules (sharp) during tests.
 */

/** ONNX model identifier */
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

/** Output vector dimension for all-MiniLM-L6-v2 */
export const VECTOR_DIM = 384;

type FeatureExtractionPipeline = (
    text: string,
    options: { pooling: string; normalize: boolean }
) => Promise<{ data: Float32Array }>;

type TransformersModule = {
    pipeline: (
        task: string,
        model: string,
        options?: { progress_callback?: null }
    ) => Promise<unknown>;
    env: {
        allowRemoteModels: boolean;
        allowLocalModels: boolean;
    };
};

/**
 * Singleton embedding service backed by a local ONNX model.
 * The model is downloaded once and cached in `~/.cache/huggingface`.
 */
export class EmbeddingService {
    private static instance: EmbeddingService | null = null;
    private extractor: FeatureExtractionPipeline | null = null;
    private initPromise: Promise<void> | null = null;
    private transformers: TransformersModule | null = null;

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
     * Initializes the pipeline (idempotent, safe to call multiple times).
     */
    async initialize(): Promise<void> {
        if (this.extractor) return;

        if (!this.initPromise) {
            this.initPromise = (async () => {
                // Dynamic import to avoid loading sharp during tests
                this.transformers = await import('@xenova/transformers') as TransformersModule;
                
                // Configure environment
                this.transformers.env.allowRemoteModels = true;
                this.transformers.env.allowLocalModels = true;
                
                this.extractor = (await this.transformers.pipeline(
                    'feature-extraction',
                    MODEL_NAME
                )) as FeatureExtractionPipeline;
            })();
        }

        await this.initPromise;
    }

    /**
     * Embeds `text` into a 384-dimension float vector.
     *
     * @param text - The text to embed (title + content recommended)
     * @returns Normalised float vector of length VECTOR_DIM
     */
    async embed(text: string): Promise<number[]> {
        await this.initialize();

        if (!this.extractor) {
            throw new Error('EmbeddingService: extractor not initialized');
        }

        const output = await this.extractor(text, {
            pooling: 'mean',
            normalize: true,
        });

        return Array.from(output.data);
    }

    /**
     * Convenience: embed a memory's title and content together.
     */
    async embedMemory(title: string, content: string): Promise<number[]> {
        return this.embed(`${title} ${content}`.trim());
    }

    /** Reset the singleton (for testing purposes only). */
    static _reset(): void {
        EmbeddingService.instance = null;
    }
}
