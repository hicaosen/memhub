import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DaemonClientBackend } from '../../src/server/daemon-client-backend.js';
import { DaemonAlreadyRunningError, DaemonController } from '../../src/server/daemon.js';

const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('DaemonClientBackend', () => {
  let tempDir: string;
  let daemon: DaemonController | null;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'memhub-daemon-client-test-'));
    daemon = null;
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.closeForeground();
      daemon = null;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('forwards memory calls to an explicit daemon', async () => {
    daemon = new DaemonController({ storagePath: tempDir, vectorSearch: false });
    await daemon.startForeground();

    const client = new DaemonClientBackend({
      storagePath: tempDir,
      vectorSearch: false,
      autoStart: false,
      cliEntryPath: process.argv[1] ?? '',
    });

    const created = await client.memoryUpdate({
      sessionId: SESSION_ID,
      entryType: 'decision',
      ttl: 'permanent',
      title: 'Explicit daemon write',
      content: 'created through daemon client',
    });

    const loaded = await client.memoryLoad({
      id: created.id,
      rewrittenQueries: ['explicit lookup', 'explicit recall', 'explicit id'],
    });

    expect(loaded.total).toBe(1);
    expect(loaded.items[0]?.content).toBe('created through daemon client');
    await client.close();
  });

  it('does not become a daemon when auto-start is disabled', async () => {
    const client = new DaemonClientBackend({
      storagePath: tempDir,
      vectorSearch: false,
      autoStart: false,
      cliEntryPath: process.argv[1] ?? '',
    });

    await expect(client.initialize()).rejects.toThrow('MemHub daemon is not running');
  });
});

describe('DaemonController', () => {
  let tempDir: string;
  let daemon: DaemonController | null;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'memhub-daemon-controller-test-'));
    daemon = null;
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.closeForeground();
      daemon = null;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects a second foreground daemon for the same storage path', async () => {
    daemon = new DaemonController({ storagePath: tempDir, vectorSearch: false });
    await daemon.startForeground();

    const second = new DaemonController({ storagePath: tempDir, vectorSearch: false });

    await expect(second.startForeground()).rejects.toBeInstanceOf(DaemonAlreadyRunningError);
  });
});
