/**
 * Storage Path Constants
 *
 * Centralized path definitions for the .memhub directory structure.
 * All storage components should use these constants for path resolution.
 */

import { join } from 'path';

/**
 * Subdirectory names
 */
export const SUBDIR = {
  /** User memory files (Markdown) */
  memories: 'memories',
  /** System internal data */
  internal: '.internal',
} as const;

/**
 * Internal subdirectory paths (relative to storage root)
 */
export const INTERNAL_PATHS = {
  /** Vector index (LanceDB) */
  lancedb: '.internal/lancedb',
  /** Write-Ahead Log */
  wal: '.internal/wal',
  /** Idempotency store */
  idempotency: '.internal/idempotency',
  /** Daemon lock file */
  daemonLock: '.internal/daemon.lock',
  /** Daemon endpoint metadata */
  daemonJson: '.internal/daemon.json',
} as const;

/**
 * Legacy paths (for migration detection)
 */
export const LEGACY_PATHS = {
  /** Legacy vector index */
  lancedb: '.lancedb',
  /** Legacy WAL */
  wal: 'wal',
  /** Legacy idempotency */
  idempotency: 'idempotency',
  /** Legacy daemon lock */
  daemonLock: '.memhub-daemon.lock',
  /** Legacy daemon endpoint */
  daemonJson: '.memhub-daemon.json',
} as const;

/**
 * Get the memories directory path
 */
export function getMemoriesPath(storagePath: string): string {
  return join(storagePath, SUBDIR.memories);
}

/**
 * Get the internal directory path
 */
export function getInternalPath(storagePath: string): string {
  return join(storagePath, SUBDIR.internal);
}

/**
 * Get the LanceDB path
 */
export function getLanceDBPath(storagePath: string): string {
  return join(storagePath, INTERNAL_PATHS.lancedb);
}

/**
 * Get the WAL directory path
 */
export function getWALPath(storagePath: string): string {
  return join(storagePath, INTERNAL_PATHS.wal);
}

/**
 * Get the idempotency directory path
 */
export function getIdempotencyPath(storagePath: string): string {
  return join(storagePath, INTERNAL_PATHS.idempotency);
}

/**
 * Get the daemon lock file path
 */
export function getDaemonLockPath(storagePath: string): string {
  return join(storagePath, INTERNAL_PATHS.daemonLock);
}

/**
 * Get the daemon JSON file path
 */
export function getDaemonJsonPath(storagePath: string): string {
  return join(storagePath, INTERNAL_PATHS.daemonJson);
}

/**
 * Archive directory name
 */
export const ARCHIVE_DIR = 'archive';

/**
 * Get the archive directory path
 * Archive contains expired memories that are no longer in the active index.
 */
export function getArchivePath(storagePath: string): string {
  return join(storagePath, ARCHIVE_DIR);
}
