/**
 * Model Manager Types
 *
 * Centralized configuration for all GGUF models used by MemHub.
 */

/** Types of models used in MemHub */
export type ModelKind = 'embedding' | 'reranker';

/** Configuration for a single model */
export interface ModelConfig {
  /** Model type */
  readonly kind: ModelKind;
  /** Short name for display and directory */
  readonly name: string;
  /** GGUF filename */
  readonly filename: string;
  /** Hugging Face repository */
  readonly hfRepo: string;
  /** Hugging Face file path within repo */
  readonly hfFile: string;
  /** Approximate size in bytes for progress display */
  readonly sizeBytes: number;
}

/** All models required by MemHub */
export const MODELS: readonly ModelConfig[] = [
  {
    kind: 'embedding',
    name: 'nomic-embed-text-v2-moe',
    filename: 'nomic-embed-text-v2-moe.Q4_K_M.gguf',
    hfRepo: 'nomic-ai/nomic-embed-text-v2-moe-GGUF',
    hfFile: 'nomic-embed-text-v2-moe.Q4_K_M.gguf',
    sizeBytes: 328_000_000, // ~328MB
  },
  {
    kind: 'reranker',
    name: 'bge-reranker-v2-m3',
    filename: 'bge-reranker-v2-m3-Q4_K_M.gguf',
    hfRepo: 'gpustack/bge-reranker-v2-m3-GGUF',
    hfFile: 'bge-reranker-v2-m3-Q4_K_M.gguf',
    sizeBytes: 300_000_000, // ~300MB
  },
] as const;

/** Get model config by kind */
export function getModelByKind(kind: ModelKind): ModelConfig | undefined {
  return MODELS.find(m => m.kind === kind);
}

/** Get model config by name */
export function getModelByName(name: string): ModelConfig | undefined {
  return MODELS.find(m => m.name === name);
}

/** Total download size in bytes */
export const TOTAL_DOWNLOAD_SIZE = MODELS.reduce((sum, m) => sum + m.sizeBytes, 0);

/** Format bytes to human readable string */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
