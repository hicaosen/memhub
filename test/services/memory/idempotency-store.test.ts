/**
 * IdempotencyStore Tests
 * Tests for idempotency store functionality (issues #17, #18)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileIdempotencyStore } from '../../../src/services/memory/idempotency-store.js';
import type { MemoryUpdateInput, MemoryUpdateOutput } from '../../../src/contracts/types.js';

// ── helpers ────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<MemoryUpdateInput> = {}): MemoryUpdateInput {
  return { mode: 'append', content: 'hello', ...overrides };
}

function makeOutput(id = 'test-id'): MemoryUpdateOutput {
  return {
    id,
    sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    filePath: `/memories/${id}.md`,
    created: true,
    updated: false,
    memory: {
      id,
      title: 'Test memory',
      content: 'hello',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: [],
      category: 'general',
      importance: 3,
    },
  };
}

// ── suite ──────────────────────────────────────────────────────────────────

describe('FileIdempotencyStore', () => {
  let tempDir: string;
  let store: FileIdempotencyStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'memhub-idempotency-test-'));
    store = new FileIdempotencyStore(join(tempDir, 'idempotency.json'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── #17: fingerprint must include ttl ─────────────────────────────────────

  describe('#17: fingerprint ttl field', () => {
    it('should produce different fingerprints for different ttl values', () => {
      const fp1 = store.computeFingerprint(makeInput({ ttl: 'permanent' }));
      const fp2 = store.computeFingerprint(makeInput({ ttl: 'session' }));
      expect(fp1).not.toBe(fp2);
    });

    it('should produce different fingerprints when ttl is present vs absent', () => {
      const fpWithTtl = store.computeFingerprint(makeInput({ ttl: 'permanent' }));
      const fpNoTtl = store.computeFingerprint(makeInput());
      expect(fpWithTtl).not.toBe(fpNoTtl);
    });

    it('should produce the same fingerprint for identical ttl values', () => {
      const fp1 = store.computeFingerprint(makeInput({ ttl: 'long' }));
      const fp2 = store.computeFingerprint(makeInput({ ttl: 'long' }));
      expect(fp1).toBe(fp2);
    });

    it('should treat undefined ttl and no-ttl as equivalent', () => {
      const fp1 = store.computeFingerprint(makeInput({ ttl: undefined }));
      const fp2 = store.computeFingerprint(makeInput());
      expect(fp1).toBe(fp2);
    });
  });

  // ── #18: no stale in-memory cache ─────────────────────────────────────────

  describe('#18: no stale cache across process boundaries', () => {
    it('should pick up records written by an external process', async () => {
      const externalKey = 'external-key';
      const externalFp = 'external-fingerprint-abc123';
      const externalOutput = makeOutput('external-id');

      const externalIndex = {
        [externalKey]: {
          fingerprint: externalFp,
          recordedAt: new Date().toISOString(),
          result: externalOutput,
        },
      };
      writeFileSync(join(tempDir, 'idempotency.json'), JSON.stringify(externalIndex), 'utf-8');

      const replay = await store.findReplay(externalKey, externalFp);
      expect(replay).not.toBeNull();
      expect(replay?.id).toBe('external-id');
    });

    it('should not return stale cached result after the index file is replaced externally', async () => {
      const key = 'shared-key';

      const fpA = store.computeFingerprint(makeInput({ content: 'process-A' }));
      await store.persistRecord(key, fpA, makeOutput('id-a'));

      const replayA = await store.findReplay(key, fpA);
      expect(replayA?.id).toBe('id-a');

      const fpB = 'fp-process-b';
      const indexB = {
        [key]: {
          fingerprint: fpB,
          recordedAt: new Date().toISOString(),
          result: makeOutput('id-b'),
        },
      };
      writeFileSync(join(tempDir, 'idempotency.json'), JSON.stringify(indexB), 'utf-8');

      const replayB = await store.findReplay(key, fpB);
      expect(replayB?.id).toBe('id-b');
    });
  });
});
