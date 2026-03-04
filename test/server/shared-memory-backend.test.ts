import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SharedMemoryBackend } from '../../src/server/shared-memory-backend.js';

const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('SharedMemoryBackend', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'memhub-shared-backend-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('elects first backend as daemon and second as client', async () => {
    const first = new SharedMemoryBackend({ storagePath: tempDir, vectorSearch: false });
    const second = new SharedMemoryBackend({ storagePath: tempDir, vectorSearch: false });

    await first.initialize();
    await second.initialize();

    expect(first._getRoleForTest()).toBe('daemon');
    expect(second._getRoleForTest()).toBe('client');

    await first.close();
    await second.close();
  });

  it('shares one storage backend across multiple clients', async () => {
    const daemonOwner = new SharedMemoryBackend({ storagePath: tempDir, vectorSearch: false });
    const client = new SharedMemoryBackend({ storagePath: tempDir, vectorSearch: false });

    await daemonOwner.initialize();
    await client.initialize();

    const created = await client.memoryUpdate({
      sessionId: SESSION_ID,
      entryType: 'decision',
      title: 'Shared daemon write',
      content: 'created by client',
      category: 'project',
      tags: ['shared'],
    });

    const loaded = await daemonOwner.memoryLoad({ id: created.id });
    expect(loaded.total).toBe(1);
    expect(loaded.items[0]?.content).toBe('created by client');

    await daemonOwner.close();
    await client.close();
  });

  it('promotes a client to daemon when original daemon stops', async () => {
    const first = new SharedMemoryBackend({ storagePath: tempDir, vectorSearch: false });
    const second = new SharedMemoryBackend({ storagePath: tempDir, vectorSearch: false });

    await first.initialize();
    await second.initialize();

    await first.close();

    const created = await second.memoryUpdate({
      sessionId: SESSION_ID,
      entryType: 'fact',
      title: 'Failover test',
      content: 'second should takeover',
      category: 'project',
      tags: ['failover'],
    });

    expect(created.id).toBeDefined();
    expect(second._getRoleForTest()).toBe('daemon');

    await second.close();
  });
});
