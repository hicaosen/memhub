import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promises as fs } from 'fs';
import { createLogger } from '../../src/utils/logger.js';

describe('JsonFileLogger', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('writes jsonl log lines and mirrors error logs', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'memhub-logger-test-'));
    tempDirs.push(tempDir);

    const now = new Date('2026-03-04T10:00:00.000Z');
    const logger = createLogger({
      role: 'client',
      level: 'info',
      logDir: tempDir,
      now: () => now,
    });

    await logger.info('memory_load.start', 'start load', {
      requestId: 'req-1',
      meta: { content: 'secret', category: 'project' },
    });

    await logger.error('memory_load.fail', 'failed load', {
      requestId: 'req-1',
      meta: { token: 'very-secret-token' },
    });

    const roleFile = join(tempDir, 'client-2026-03-04.log');
    const errorFile = join(tempDir, 'error-2026-03-04.log');

    const roleContent = await fs.readFile(roleFile, 'utf8');
    const errorContent = await fs.readFile(errorFile, 'utf8');

    const roleLines = roleContent
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>);

    expect(roleLines).toHaveLength(2);
    expect(roleLines[0]['event']).toBe('memory_load.start');
    expect((roleLines[0]['meta'] as Record<string, unknown>)['content']).toBe('[REDACTED]');
    expect((roleLines[1]['meta'] as Record<string, unknown>)['token']).toBe('[REDACTED]');

    const errorLines = errorContent
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>);

    expect(errorLines).toHaveLength(1);
    expect(errorLines[0]['level']).toBe('error');
  });

  it('cleans up files older than retention policy on first write', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'memhub-logger-retention-test-'));
    tempDirs.push(tempDir);

    writeFileSync(join(tempDir, 'client-2026-02-01.log'), 'old\n', 'utf8');
    writeFileSync(join(tempDir, 'client-2026-03-04.log'), 'keep\n', 'utf8');

    const now = new Date('2026-03-04T12:00:00.000Z');
    const logger = createLogger({
      role: 'client',
      level: 'info',
      logDir: tempDir,
      retentionDays: 7,
      now: () => now,
    });

    await logger.info('backend.initialize', 'init');

    const files = await fs.readdir(tempDir);
    expect(files).not.toContain('client-2026-02-01.log');
    expect(files).toContain('client-2026-03-04.log');
  });
});
