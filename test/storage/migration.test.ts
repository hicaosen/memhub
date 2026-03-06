import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { hasLegacyPaths, runMigration } from '../../src/storage/migration.js';
import { LEGACY_PATHS, INTERNAL_PATHS, SUBDIR } from '../../src/storage/paths.js';

describe('Migration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `memhub-migration-test-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('hasLegacyPaths', () => {
    it('returns false when no legacy paths exist', async () => {
      const result = await hasLegacyPaths(tempDir);
      expect(result).toBe(false);
    });

    it('returns true when legacy lancedb exists', async () => {
      await mkdir(join(tempDir, LEGACY_PATHS.lancedb), { recursive: true });
      const result = await hasLegacyPaths(tempDir);
      expect(result).toBe(true);
    });

    it('returns true when legacy wal exists', async () => {
      await mkdir(join(tempDir, LEGACY_PATHS.wal), { recursive: true });
      const result = await hasLegacyPaths(tempDir);
      expect(result).toBe(true);
    });

    it('returns true when legacy idempotency exists', async () => {
      await mkdir(join(tempDir, LEGACY_PATHS.idempotency), { recursive: true });
      const result = await hasLegacyPaths(tempDir);
      expect(result).toBe(true);
    });

    it('returns true when legacy daemon files exist', async () => {
      await writeFile(join(tempDir, LEGACY_PATHS.daemonLock), '{}');
      const result = await hasLegacyPaths(tempDir);
      expect(result).toBe(true);
    });

    it('returns true when legacy date directories exist', async () => {
      await mkdir(join(tempDir, '2026-03-06'), { recursive: true });
      const result = await hasLegacyPaths(tempDir);
      expect(result).toBe(true);
    });
  });

  describe('runMigration', () => {
    it('creates new directory structure when no legacy paths exist', async () => {
      const report = await runMigration(tempDir);

      expect(report.legacyFound).toBe(false);
      expect(report.succeeded).toBe(0);
      expect(report.failed).toBe(0);

      // Check new directories were created
      const internalDir = join(tempDir, SUBDIR.internal);
      const memoriesDir = join(tempDir, SUBDIR.memories);

      await expect(
        readFile(join(internalDir), { encoding: 'utf-8' })
      ).rejects.toThrow(); // It's a directory, not a file

      // Directories should exist
      const { access, constants } = await import('fs/promises');
      await access(internalDir, constants.F_OK);
      await access(memoriesDir, constants.F_OK);
    });

    it('migrates legacy lancedb to new path', async () => {
      const legacyPath = join(tempDir, LEGACY_PATHS.lancedb);
      await mkdir(legacyPath, { recursive: true });
      await writeFile(join(legacyPath, 'test.txt'), 'test data');

      const report = await runMigration(tempDir);

      expect(report.legacyFound).toBe(true);
      expect(report.succeeded).toBe(1);
      expect(report.failed).toBe(0);

      // Verify migration
      const newPath = join(tempDir, INTERNAL_PATHS.lancedb);
      const content = await readFile(join(newPath, 'test.txt'), 'utf-8');
      expect(content).toBe('test data');
    });

    it('migrates legacy wal to new path', async () => {
      const legacyPath = join(tempDir, LEGACY_PATHS.wal);
      await mkdir(legacyPath, { recursive: true });
      await writeFile(join(legacyPath, 'wal.log'), 'wal data');

      const report = await runMigration(tempDir);

      expect(report.legacyFound).toBe(true);
      expect(report.succeeded).toBe(1);

      const newPath = join(tempDir, INTERNAL_PATHS.wal);
      const content = await readFile(join(newPath, 'wal.log'), 'utf-8');
      expect(content).toBe('wal data');
    });

    it('migrates legacy idempotency to new path', async () => {
      const legacyPath = join(tempDir, LEGACY_PATHS.idempotency);
      await mkdir(legacyPath, { recursive: true });
      await writeFile(join(legacyPath, 'index.json'), '{}');

      const report = await runMigration(tempDir);

      expect(report.succeeded).toBe(1);

      const newPath = join(tempDir, INTERNAL_PATHS.idempotency);
      const content = await readFile(join(newPath, 'index.json'), 'utf-8');
      expect(content).toBe('{}');
    });

    it('migrates legacy daemon files to new path', async () => {
      await writeFile(join(tempDir, LEGACY_PATHS.daemonLock), '{"pid":123}');
      await writeFile(join(tempDir, LEGACY_PATHS.daemonJson), '{"port":8080}');

      const report = await runMigration(tempDir);

      expect(report.succeeded).toBe(2);

      const lockContent = await readFile(
        join(tempDir, INTERNAL_PATHS.daemonLock),
        'utf-8'
      );
      expect(lockContent).toBe('{"pid":123}');

      const jsonContent = await readFile(
        join(tempDir, INTERNAL_PATHS.daemonJson),
        'utf-8'
      );
      expect(jsonContent).toBe('{"port":8080}');
    });

    it('migrates legacy date directories to memories/', async () => {
      const dateDir = join(tempDir, '2026-03-06');
      await mkdir(join(dateDir, 'session-123'), { recursive: true });
      await writeFile(join(dateDir, 'session-123', 'memory.md'), '# Memory');

      const report = await runMigration(tempDir);

      expect(report.legacyFound).toBe(true);
      expect(report.succeeded).toBe(1);

      const newPath = join(tempDir, SUBDIR.memories, '2026-03-06', 'session-123', 'memory.md');
      const content = await readFile(newPath, 'utf-8');
      expect(content).toBe('# Memory');
    });

    it('handles multiple legacy paths at once', async () => {
      // Create multiple legacy paths
      await mkdir(join(tempDir, LEGACY_PATHS.lancedb), { recursive: true });
      await mkdir(join(tempDir, LEGACY_PATHS.wal), { recursive: true });
      await mkdir(join(tempDir, '2026-03-06'), { recursive: true });

      const report = await runMigration(tempDir);

      expect(report.legacyFound).toBe(true);
      expect(report.succeeded).toBe(3);
      expect(report.failed).toBe(0);
    });

    it('does not overwrite existing new paths', async () => {
      // Create legacy and new paths
      await mkdir(join(tempDir, LEGACY_PATHS.lancedb), { recursive: true });
      await writeFile(join(tempDir, LEGACY_PATHS.lancedb, 'old.txt'), 'old data');

      const newPath = join(tempDir, INTERNAL_PATHS.lancedb);
      await mkdir(newPath, { recursive: true });
      await writeFile(join(newPath, 'new.txt'), 'new data');

      const report = await runMigration(tempDir);

      // Migration should fail for this path
      expect(report.failed).toBe(1);

      // New path should not be overwritten
      const content = await readFile(join(newPath, 'new.txt'), 'utf-8');
      expect(content).toBe('new data');
    });
  });
});
