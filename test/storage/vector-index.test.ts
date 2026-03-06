/**
 * VectorIndex Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as lancedb from '@lancedb/lancedb';
import { VectorIndex } from '../../src/storage/vector-index.js';
import type { Memory } from '../../src/contracts/types.js';
import { VECTOR_DIM } from '../../src/services/embedding-service.js';

/** Build a random embedding-dim float vector (avoids loading the real model) */
function randomVec(dim = VECTOR_DIM): number[] {
  const vec = Array.from({ length: dim }, () => Math.random() * 2 - 1);
  // L2-normalise so cosine distance is meaningful
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map(v => v / norm);
}

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'test-id-' + Math.random().toString(36).slice(2),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    importance: 3,
    title: 'Test Memory',
    content: 'Test content',
    ...overrides,
  };
}

describe('VectorIndex', () => {
  let tempDir: string;
  let index: VectorIndex;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'memhub-vec-test-'));
    index = new VectorIndex(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should initialize without errors', async () => {
    await expect(index.initialize()).resolves.not.toThrow();
  });

  it('should report 0 rows after initialization', async () => {
    await index.initialize();
    expect(await index.count()).toBe(0);
  });

  it('should upsert a memory and increase count', async () => {
    const memory = makeMemory();
    const vec = randomVec();
    await index.upsert(memory, vec);
    expect(await index.count()).toBe(1);
  });

  it('should overwrite existing row on upsert (same id)', async () => {
    const memory = makeMemory({ id: 'fixed-id' });
    await index.upsert(memory, randomVec());
    await index.upsert({ ...memory, title: 'Updated' }, randomVec());
    expect(await index.count()).toBe(1);
  });

  it('should delete a row by id', async () => {
    const memory = makeMemory();
    await index.upsert(memory, randomVec());
    await index.delete(memory.id);
    expect(await index.count()).toBe(0);
  });

  it('should not throw when deleting non-existent id', async () => {
    await expect(index.delete('non-existent')).resolves.not.toThrow();
  });

  it('should search and return results', async () => {
    const vec = randomVec();
    const memory = makeMemory({ id: 'searchable-id' });
    await index.upsert(memory, vec);

    // Searching with the same vector should return that memory as top result
    const results = await index.search(vec, 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('searchable-id');
  });

  it('should return empty results when index is empty', async () => {
    const results = await index.search(randomVec(), 5);
    expect(results).toHaveLength(0);
  });

  it('should respect the limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await index.upsert(makeMemory(), randomVec());
    }
    const results = await index.search(randomVec(), 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('should return _distance field in results', async () => {
    const vec = randomVec();
    await index.upsert(makeMemory(), vec);
    const results = await index.search(vec, 1);
    expect(results[0]._distance).toBeDefined();
    expect(typeof results[0]._distance).toBe('number');
  });

  it('should handle id with single quotes (SQL injection prevention)', async () => {
    const maliciousId = "test-' OR '1'='1";
    const memory = makeMemory({ id: maliciousId });
    await index.upsert(memory, randomVec());
    expect(await index.count()).toBe(1);

    // Should be able to delete by the same id
    await index.delete(maliciousId);
    expect(await index.count()).toBe(0);
  });

  it('should handle id with special characters', async () => {
    const specialId = "id-with-'quotes'-and-more";
    const memory = makeMemory({ id: specialId });
    await index.upsert(memory, randomVec());
    expect(await index.count()).toBe(1);

    await index.delete(specialId);
    expect(await index.count()).toBe(0);
  });

  // Error scenario tests
  it('should allow concurrent initialization calls', async () => {
    // Multiple concurrent init calls should not cause issues
    const promises = [index.initialize(), index.initialize(), index.initialize()];
    await expect(Promise.all(promises)).resolves.not.toThrow();
  });

  it('should persist data across instances', async () => {
    const memory = makeMemory({ id: 'persistent-id' });
    await index.upsert(memory, randomVec());

    // Create a new instance pointing to the same directory
    const newIndex = new VectorIndex(tempDir);
    expect(await newIndex.count()).toBe(1);
  });

  it('should auto-rebuild legacy table when vector dimensions mismatch', async () => {
    const dbPath = join(tempDir, '.lancedb');
    const db = await lancedb.connect(dbPath);
    await db.createTable('memories', [
      {
        id: '__legacy__',
        vector: randomVec(1024),
        title: '',
        importance: 0,
        createdAt: '',
        updatedAt: '',
        walOffset: -1,
      },
    ]);

    const rebuilt = new VectorIndex(tempDir);
    await rebuilt.initialize();

    const metadata = JSON.parse(readFileSync(join(dbPath, 'memories.meta.json'), 'utf-8')) as {
      vectorDim: number;
    };
    expect(metadata.vectorDim).toBe(VECTOR_DIM);

    await expect(rebuilt.upsert(makeMemory(), randomVec())).resolves.not.toThrow();
  });

  it('should reject vectors with incorrect dimensions', async () => {
    const wrongDim = VECTOR_DIM === 768 ? 1024 : 768;
    await expect(index.search(randomVec(wrongDim), 1)).rejects.toThrow(
      new RegExp(`expects ${VECTOR_DIM} dimensions, got ${wrongDim}`)
    );
  });
});
