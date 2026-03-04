/**
 * Model Path Resolver
 *
 * Resolves model paths in ~/.memhub/models/ directory.
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, statSync } from 'fs';
import type { ModelConfig } from './types.js';

/**
 * Get the base path for all models: ~/.memhub/models
 */
export function getModelsBasePath(): string {
  return join(homedir(), '.memhub', 'models');
}

/**
 * Resolved model path information
 */
export interface ResolvedModelPath {
  /** Directory containing the model file */
  readonly modelDir: string;
  /** Full path to the model file */
  readonly modelFile: string;
  /** Whether the model file exists */
  readonly exists: boolean;
  /** File size in bytes (0 if not exists) */
  readonly sizeBytes: number;
}

/**
 * Resolve the path for a model configuration
 */
export function resolveModelPath(model: ModelConfig): ResolvedModelPath {
  const modelDir = join(getModelsBasePath(), model.name);
  const modelFile = join(modelDir, model.filename);
  const exists = existsSync(modelFile);

  let sizeBytes = 0;
  if (exists) {
    try {
      sizeBytes = statSync(modelFile).size;
    } catch {
      // Ignore stat errors
    }
  }

  return {
    modelDir,
    modelFile,
    exists,
    sizeBytes,
  };
}

/**
 * Check if all required models are downloaded
 */
export async function areAllModelsDownloaded(): Promise<boolean> {
  const { MODELS } = await import('./types.js');
  return MODELS.every(model => {
    const resolved = resolveModelPath(model);
    return resolved.exists && resolved.sizeBytes > 0;
  });
}

/**
 * Get list of models that need to be downloaded
 */
export async function getMissingModels(): Promise<readonly ModelConfig[]> {
  const { MODELS } = await import('./types.js');
  return MODELS.filter(model => {
    const resolved = resolveModelPath(model);
    return !resolved.exists || resolved.sizeBytes === 0;
  });
}

/**
 * Get download status summary
 */
export async function getDownloadStatus(): Promise<{
  readonly total: number;
  readonly downloaded: number;
  readonly missing: number;
  readonly totalSize: number;
  readonly downloadedSize: number;
}> {
  const { MODELS } = await import('./types.js');

  let downloaded = 0;
  let downloadedSize = 0;

  for (const model of MODELS) {
    const resolved = resolveModelPath(model);
    if (resolved.exists && resolved.sizeBytes > 0) {
      downloaded++;
      downloadedSize += resolved.sizeBytes;
    }
  }

  const { TOTAL_DOWNLOAD_SIZE } = await import('./types.js');

  return {
    total: MODELS.length,
    downloaded,
    missing: MODELS.length - downloaded,
    totalSize: TOTAL_DOWNLOAD_SIZE,
    downloadedSize,
  };
}

/**
 * Check if a specific model is downloaded
 */
export function isModelDownloaded(model: ModelConfig): boolean {
  const resolved = resolveModelPath(model);
  return resolved.exists && resolved.sizeBytes > 0;
}
