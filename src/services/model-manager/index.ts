/**
 * Model Manager
 *
 * Centralized management for GGUF models used by MemHub.
 * Provides model configuration, path resolution, and download functionality.
 */

export {
  type ModelKind,
  type ModelConfig,
  MODELS,
  getModelByKind,
  getModelByName,
  TOTAL_DOWNLOAD_SIZE,
  formatBytes,
} from './types.js';

export {
  getModelsBasePath,
  resolveModelPath,
  type ResolvedModelPath,
  areAllModelsDownloaded,
  getMissingModels,
  getDownloadStatus,
  isModelDownloaded,
} from './model-path-resolver.js';

export {
  downloadModel,
  downloadAllModels,
  type ProgressCallback,
  type DownloadProgress,
} from './model-downloader.js';
