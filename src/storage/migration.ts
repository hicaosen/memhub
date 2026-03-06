/**
 * Storage Migration - Handles migration from legacy paths to new structure
 *
 * Migration paths:
 * - .lancedb/ → .internal/lancedb/
 * - wal/ → .internal/wal/
 * - idempotency/ → .internal/idempotency/
 * - .memhub-daemon.lock → .internal/daemon.lock
 * - .memhub-daemon.json → .internal/daemon.json
 * - {date}/ → memories/{date}/
 */

import { access, rename, mkdir, readdir } from 'fs/promises';
import { join, basename } from 'path';
import { constants } from 'fs';
import {
  LEGACY_PATHS,
  INTERNAL_PATHS,
  getInternalPath,
  getMemoriesPath,
} from './paths.js';
import type { Logger } from '../utils/logger.js';

/**
 * Migration result for a single path
 */
export interface MigrationResult {
  /** Legacy path that was migrated */
  from: string;
  /** New path */
  to: string;
  /** Whether migration was successful */
  success: boolean;
  /** Error message if migration failed */
  error?: string;
}

/**
 * Overall migration result
 */
export interface MigrationReport {
  /** All migration results */
  migrations: MigrationResult[];
  /** Number of successful migrations */
  succeeded: number;
  /** Number of failed migrations */
  failed: number;
  /** Whether any legacy paths were found */
  legacyFound: boolean;
}

/**
 * Checks if a path exists
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if legacy paths exist
 */
export async function hasLegacyPaths(storagePath: string): Promise<boolean> {
  const legacyPaths = [
    join(storagePath, LEGACY_PATHS.lancedb),
    join(storagePath, LEGACY_PATHS.wal),
    join(storagePath, LEGACY_PATHS.idempotency),
    join(storagePath, LEGACY_PATHS.daemonLock),
    join(storagePath, LEGACY_PATHS.daemonJson),
  ];

  // Also check for date directories (YYYY-MM-DD pattern)
  const dateDirs = await findLegacyDateDirectories(storagePath);
  if (dateDirs.length > 0) return true;

  for (const path of legacyPaths) {
    if (await pathExists(path)) return true;
  }

  return false;
}

/**
 * Finds legacy date directories in storage root
 */
async function findLegacyDateDirectories(storagePath: string): Promise<string[]> {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const dirs: string[] = [];

  try {
    const entries = await readdir(storagePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && datePattern.test(entry.name)) {
        dirs.push(join(storagePath, entry.name));
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return dirs;
}

/**
 * Migrates a single path (file or directory)
 */
async function migratePath(from: string, to: string, logger?: Logger): Promise<MigrationResult> {
  const result: MigrationResult = { from, to, success: false };

  try {
    // Check if source exists
    if (!(await pathExists(from))) {
      // Nothing to migrate
      result.success = true;
      return result;
    }

    // Check if target already exists
    if (await pathExists(to)) {
      // Target exists, don't overwrite
      result.error = 'Target path already exists';
      result.success = false;
      return result;
    }

    // Ensure target parent directory exists
    const targetParent = join(to, '..');
    await mkdir(targetParent, { recursive: true });

    // Atomic move
    await rename(from, to);

    result.success = true;
    await logger?.info('migration.moved', `Migrated: ${basename(from)} → ${to}`, {
      meta: { from, to },
    });
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
    result.success = false;
    await logger?.error('migration.failed', `Migration failed: ${from}`, {
      meta: { from, to, error: result.error },
    });
  }

  return result;
}

/**
 * Runs all migrations
 */
export async function runMigration(storagePath: string, logger?: Logger): Promise<MigrationReport> {
  const migrations: MigrationResult[] = [];
  let legacyFound = false;

  await logger?.info('migration.start', 'Starting storage migration check', {
    meta: { storagePath },
  });

  // Ensure .internal directory exists
  const internalPath = getInternalPath(storagePath);
  await mkdir(internalPath, { recursive: true });

  // Ensure memories directory exists
  const memoriesPath = getMemoriesPath(storagePath);
  await mkdir(memoriesPath, { recursive: true });

  // Migrate system paths
  const systemMigrations = [
    {
      from: join(storagePath, LEGACY_PATHS.lancedb),
      to: join(storagePath, INTERNAL_PATHS.lancedb),
    },
    {
      from: join(storagePath, LEGACY_PATHS.wal),
      to: join(storagePath, INTERNAL_PATHS.wal),
    },
    {
      from: join(storagePath, LEGACY_PATHS.idempotency),
      to: join(storagePath, INTERNAL_PATHS.idempotency),
    },
    {
      from: join(storagePath, LEGACY_PATHS.daemonLock),
      to: join(storagePath, INTERNAL_PATHS.daemonLock),
    },
    {
      from: join(storagePath, LEGACY_PATHS.daemonJson),
      to: join(storagePath, INTERNAL_PATHS.daemonJson),
    },
  ];

  for (const { from, to } of systemMigrations) {
    if (await pathExists(from)) {
      legacyFound = true;
      const result = await migratePath(from, to, logger);
      migrations.push(result);
    }
  }

  // Migrate date directories
  const dateDirs = await findLegacyDateDirectories(storagePath);
  if (dateDirs.length > 0) {
    legacyFound = true;
  }
  for (const dateDir of dateDirs) {
    const dirName = basename(dateDir);
    const result = await migratePath(dateDir, join(memoriesPath, dirName), logger);
    migrations.push(result);
  }

  const report: MigrationReport = {
    migrations,
    succeeded: migrations.filter(m => m.success).length,
    failed: migrations.filter(m => !m.success).length,
    legacyFound,
  };

  if (migrations.length > 0) {
    await logger?.info('migration.complete', 'Migration complete', {
      meta: { succeeded: report.succeeded, failed: report.failed },
    });
  }

  return report;
}
