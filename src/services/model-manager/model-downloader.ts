/**
 * Model Downloader
 *
 * Downloads GGUF models from Hugging Face with:
 * - Progress tracking
 * - Resume support (Range requests)
 * - Atomic file operations (download to temp, then move)
 * - Structured logging
 */

import { createWriteStream, mkdirSync, existsSync, unlinkSync, statSync, renameSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ModelConfig } from './types.js';
import { resolveModelPath, getModelsBasePath } from './model-path-resolver.js';
import { createLogger, type Logger } from '../../utils/logger.js';

// Lazy-initialized logger to avoid issues during import
let _logger: Logger | null = null;
function getLogger(): Logger {
  if (!_logger) {
    _logger = createLogger();
  }
  return _logger;
}

/** Progress callback for downloads */
export type ProgressCallback = (info: DownloadProgress) => void;

/** Download progress information */
export interface DownloadProgress {
  /** Model being downloaded */
  readonly model: ModelConfig;
  /** Bytes downloaded so far */
  readonly downloadedBytes: number;
  /** Total bytes (may be 0 if unknown) */
  readonly totalBytes: number;
  /** Percentage (0-100) */
  readonly percentage: number;
  /** Download status */
  readonly status: 'downloading' | 'completed' | 'failed' | 'skipped' | 'resuming';
  /** Error message if failed */
  readonly error?: string;
}

/**
 * Build Hugging Face download URL
 */
function buildHfUrl(model: ModelConfig): string {
  return `https://huggingface.co/${model.hfRepo}/resolve/main/${model.hfFile}`;
}

/**
 * Get temp file path for downloading
 */
function getTempFilePath(model: ModelConfig): string {
  return join(tmpdir(), `memhub-${model.name}-${model.filename}.downloading`);
}

/**
 * Download a single model file with resume support
 */
export async function downloadModel(
  model: ModelConfig,
  onProgress?: ProgressCallback
): Promise<{ success: boolean; error?: string }> {
  const resolved = resolveModelPath(model);

  // Skip if already downloaded (file exists and has reasonable size)
  if (resolved.exists && resolved.sizeBytes > 1_000_000) {
    await getLogger().info('model_skip', `Model already downloaded: ${model.name}`, {
      meta: { model: model.name, kind: model.kind, sizeBytes: resolved.sizeBytes },
    });
    onProgress?.({
      model,
      downloadedBytes: resolved.sizeBytes,
      totalBytes: model.sizeBytes,
      percentage: 100,
      status: 'skipped',
    });
    return { success: true };
  }

  await getLogger().info('model_download_start', `Starting download: ${model.name}`, {
    meta: { model: model.name, kind: model.kind, expectedSize: model.sizeBytes },
  });

  // Ensure model directory exists
  const modelsBase = getModelsBasePath();
  if (!existsSync(modelsBase)) {
    mkdirSync(modelsBase, { recursive: true });
  }
  if (!existsSync(resolved.modelDir)) {
    mkdirSync(resolved.modelDir, { recursive: true });
  }

  const url = buildHfUrl(model);
  const tempFile = getTempFilePath(model);

  // Check for existing temp file (resume support)
  let resumeOffset = 0;
  if (existsSync(tempFile)) {
    try {
      const stat = statSync(tempFile);
      resumeOffset = stat.size;
      if (resumeOffset > 0) {
        await getLogger().info(
          'model_download_resume',
          `Resuming download: ${model.name} from ${Math.round((resumeOffset / model.sizeBytes) * 100)}%`,
          {
            meta: { model: model.name, resumeOffset, expectedSize: model.sizeBytes },
          }
        );
        onProgress?.({
          model,
          downloadedBytes: resumeOffset,
          totalBytes: model.sizeBytes,
          percentage: Math.round((resumeOffset / model.sizeBytes) * 100),
          status: 'resuming',
        });
      }
    } catch {
      // Ignore stat errors, will start fresh
    }
  }

  try {
    // Build headers with Range support for resume
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    };

    if (resumeOffset > 0) {
      headers['Range'] = `bytes=${resumeOffset}-`;
    }

    const response = await fetch(url, {
      redirect: 'follow',
      headers,
    });

    if (!response.ok) {
      // If Range request not satisfiable, file might be complete
      if (resumeOffset > 0 && response.status === 416) {
        // Check if final file exists now
        const recheckResolved = resolveModelPath(model);
        if (recheckResolved.exists && recheckResolved.sizeBytes > 1_000_000) {
          await getLogger().info(
            'model_download_complete',
            `Model already complete: ${model.name}`,
            {
              meta: { model: model.name, sizeBytes: recheckResolved.sizeBytes },
            }
          );
          onProgress?.({
            model,
            downloadedBytes: recheckResolved.sizeBytes,
            totalBytes: model.sizeBytes,
            percentage: 100,
            status: 'completed',
          });
          return { success: true };
        }
        // Otherwise restart download
        await getLogger().warn(
          'model_download_restart',
          `Range not satisfiable, restarting: ${model.name}`
        );
        resumeOffset = 0;
        if (existsSync(tempFile)) {
          unlinkSync(tempFile);
        }
        // Retry without Range header
        const retryResponse = await fetch(url, {
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        if (!retryResponse.ok) {
          throw new Error(`HTTP ${retryResponse.status}: ${retryResponse.statusText}`);
        }
        return handleDownload(retryResponse, model, tempFile, resolved.modelFile, 0, onProgress);
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return handleDownload(response, model, tempFile, resolved.modelFile, resumeOffset, onProgress);
  } catch (error) {
    // Keep temp file for resume (don't delete!)
    const errorMessage = error instanceof Error ? error.message : String(error);
    await getLogger().error('model_download_failed', `Download failed: ${model.name}`, {
      meta: { model: model.name, error: errorMessage, downloadedBytes: resumeOffset },
    });
    onProgress?.({
      model,
      downloadedBytes: resumeOffset,
      totalBytes: model.sizeBytes,
      percentage: Math.round((resumeOffset / model.sizeBytes) * 100),
      status: 'failed',
      error: errorMessage,
    });

    return { success: false, error: errorMessage };
  }
}

/**
 * Handle the actual download with progress tracking
 */
async function handleDownload(
  response: Response,
  model: ModelConfig,
  tempFile: string,
  finalFile: string,
  resumeOffset: number,
  onProgress?: ProgressCallback
): Promise<{ success: boolean; error?: string }> {
  const contentLength = response.headers.get('content-length');
  let totalBytes = contentLength ? parseInt(contentLength, 10) : model.sizeBytes;

  // If resuming (206 Partial Content), total includes already downloaded bytes
  if (resumeOffset > 0 && response.status === 206) {
    totalBytes += resumeOffset;
  }

  if (!response.body) {
    throw new Error('No response body');
  }

  await getLogger().debug('model_download_response', `Got response for ${model.name}`, {
    meta: {
      model: model.name,
      status: response.status,
      contentLength,
      totalBytes,
      isResume: resumeOffset > 0,
    },
  });

  // Append to existing temp file if resuming, otherwise create new
  const fileStream = createWriteStream(tempFile, { flags: resumeOffset > 0 ? 'a' : 'w' });
  const reader = response.body.getReader();
  let downloadedBytes = resumeOffset;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { done, value } = await reader.read();
    if (done) break;

    fileStream.write(value);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    downloadedBytes += value ? value.length : 0;

    onProgress?.({
      model,
      downloadedBytes,
      totalBytes,
      percentage: Math.round((downloadedBytes / totalBytes) * 100),
      status: 'downloading',
    });
  }

  fileStream.end();
  await new Promise<void>((resolve, reject) => {
    fileStream.on('finish', () => resolve());
    fileStream.on('error', reject);
  });

  // Atomic move: temp file -> final file
  renameSync(tempFile, finalFile);

  await getLogger().info('model_download_complete', `Download complete: ${model.name}`, {
    meta: { model: model.name, kind: model.kind, totalBytes },
  });

  onProgress?.({
    model,
    downloadedBytes: totalBytes,
    totalBytes,
    percentage: 100,
    status: 'completed',
  });

  return { success: true };
}

/**
 * Download all missing models
 */
export async function downloadAllModels(
  onProgress?: ProgressCallback
): Promise<{ success: boolean; errors: readonly string[] }> {
  const { MODELS } = await import('./types.js');
  const errors: string[] = [];

  await getLogger().info(
    'model_download_batch_start',
    `Starting batch download of ${MODELS.length} models`
  );

  for (const model of MODELS) {
    const result = await downloadModel(model, onProgress);
    if (!result.success && result.error) {
      errors.push(`${model.name}: ${result.error}`);
    }
  }

  const success = errors.length === 0;
  await getLogger().info('model_download_batch_complete', `Batch download complete`, {
    meta: { success, errorCount: errors.length, errors: errors.length > 0 ? errors : undefined },
  });

  return {
    success,
    errors,
  };
}

/**
 * Clean up any leftover temp files (call on startup if needed)
 */
export async function cleanupTempFiles(): Promise<void> {
  const { MODELS } = await import('./types.js');
  for (const model of MODELS) {
    const tempFile = getTempFilePath(model);
    if (existsSync(tempFile)) {
      // Only delete if final file exists (download completed but temp not cleaned)
      const resolved = resolveModelPath(model);
      if (resolved.exists && resolved.sizeBytes > 1_000_000) {
        try {
          unlinkSync(tempFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
}
