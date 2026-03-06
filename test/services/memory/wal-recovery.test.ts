import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WALRecovery, type WALRecoveryContext } from '../../../src/services/memory/wal-recovery.js';
import type { Memory, WALEntry } from '../../../src/contracts/types.js';
import type { WALStorage } from '../../../src/storage/wal.js';
import type { Logger } from '../../../src/utils/logger.js';

function createMockWAL(entries: WALEntry[]): WALStorage {
  return {
    append: vi.fn(),
    getUnindexed: vi.fn().mockResolvedValue(entries),
    markIndexed: vi.fn().mockResolvedValue(undefined),
    compact: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as WALStorage;
}

function createMockLogger(): Logger {
  return {
    info: vi.fn().mockResolvedValue(undefined),
    debug: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    setRole: vi.fn(),
  };
}

function createTestMemory(id: string): Memory {
  return {
    id,
    title: `Test Memory ${id}`,
    content: 'Test content',
    createdAt: '2026-03-06T00:00:00.000Z',
    updatedAt: '2026-03-06T00:00:00.000Z',
    importance: 3,
  };
}

describe('WALRecovery', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  describe('recover', () => {
    it('does nothing when no unindexed entries', async () => {
      const context: WALRecoveryContext = {
        wal: createMockWAL([]),
        storage: {
          read: vi.fn(),
          write: vi.fn(),
        } as unknown as WALRecoveryContext['storage'],
        vectorIndex: null,
        embedding: null,
        logger: mockLogger,
      };

      const recovery = new WALRecovery(context);
      await recovery.recover();

      expect(vi.mocked(context.wal).getUnindexed).toHaveBeenCalled();
      expect(vi.mocked(context.wal).markIndexed).not.toHaveBeenCalled();
    });

    it('indexes unindexed create entries', async () => {
      const memory = createTestMemory('mem-1');
      const entries: WALEntry[] = [
        {
          offset: 1,
          operation: 'create',
          memoryId: 'mem-1',
          timestamp: '2026-03-06T00:00:00.000Z',
        },
      ];

      const mockVectorIndex = {
        upsert: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn(),
      };

      const mockEmbedding = {
        embedMemory: vi.fn().mockResolvedValue(new Array(384).fill(0)),
      };

      const context: WALRecoveryContext = {
        wal: createMockWAL(entries),
        storage: {
          read: vi.fn().mockResolvedValue(memory),
          write: vi.fn(),
        } as unknown as WALRecoveryContext['storage'],
        vectorIndex: mockVectorIndex as unknown as WALRecoveryContext['vectorIndex'],
        embedding: mockEmbedding as unknown as WALRecoveryContext['embedding'],
        logger: mockLogger,
      };

      const recovery = new WALRecovery(context);
      await recovery.recover();

      expect(vi.mocked(context.storage).read).toHaveBeenCalledWith('mem-1');
      expect(mockEmbedding.embedMemory).toHaveBeenCalledWith(memory.title, memory.content);
      expect(mockVectorIndex.upsert).toHaveBeenCalled();
      expect(vi.mocked(context.wal).markIndexed).toHaveBeenCalledWith(1);
    });

    it('skips delete entries without indexing', async () => {
      const entries: WALEntry[] = [
        {
          offset: 1,
          operation: 'delete',
          memoryId: 'mem-1',
          timestamp: '2026-03-06T00:00:00.000Z',
        },
      ];

      const context: WALRecoveryContext = {
        wal: createMockWAL(entries),
        storage: {
          read: vi.fn(),
          write: vi.fn(),
        } as unknown as WALRecoveryContext['storage'],
        vectorIndex: null,
        embedding: null,
        logger: mockLogger,
      };

      const recovery = new WALRecovery(context);
      await recovery.recover();

      expect(vi.mocked(context.storage).read).not.toHaveBeenCalled();
      expect(vi.mocked(context.wal).markIndexed).toHaveBeenCalledWith(1);
    });

    it('reconstructs memory from WAL entry data when disk read fails', async () => {
      const memory = createTestMemory('mem-1');
      const entries: WALEntry[] = [
        {
          offset: 1,
          operation: 'create',
          memoryId: 'mem-1',
          timestamp: '2026-03-06T00:00:00.000Z',
          data: JSON.stringify(memory),
        },
      ];

      const mockVectorIndex = {
        upsert: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn(),
      };

      const mockEmbedding = {
        embedMemory: vi.fn().mockResolvedValue(new Array(384).fill(0)),
      };

      const context: WALRecoveryContext = {
        wal: createMockWAL(entries),
        storage: {
          read: vi.fn().mockRejectedValue(new Error('File not found')),
          write: vi.fn().mockResolvedValue(undefined),
        } as unknown as WALRecoveryContext['storage'],
        vectorIndex: mockVectorIndex as unknown as WALRecoveryContext['vectorIndex'],
        embedding: mockEmbedding as unknown as WALRecoveryContext['embedding'],
        logger: mockLogger,
      };

      const recovery = new WALRecovery(context);
      await recovery.recover();

      expect(vi.mocked(context.storage).write).toHaveBeenCalled();
      expect(mockEmbedding.embedMemory).toHaveBeenCalled();
      expect(mockVectorIndex.upsert).toHaveBeenCalled();
    });

    it('marks entry as indexed when recovery fails', async () => {
      const entries: WALEntry[] = [
        {
          offset: 1,
          operation: 'create',
          memoryId: 'mem-1',
          timestamp: '2026-03-06T00:00:00.000Z',
          // No data, and read will fail
        },
      ];

      const context: WALRecoveryContext = {
        wal: createMockWAL(entries),
        storage: {
          read: vi.fn().mockRejectedValue(new Error('File not found')),
          write: vi.fn(),
        } as unknown as WALRecoveryContext['storage'],
        vectorIndex: null,
        embedding: null,
        logger: mockLogger,
      };

      const recovery = new WALRecovery(context);
      await recovery.recover();

      // Should still mark as indexed to avoid infinite retry
      expect(vi.mocked(context.wal).markIndexed).toHaveBeenCalledWith(1);
    });

    it('handles multiple entries in order', async () => {
      const memory1 = createTestMemory('mem-1');
      const memory2 = createTestMemory('mem-2');
      const entries: WALEntry[] = [
        {
          offset: 1,
          operation: 'create',
          memoryId: 'mem-1',
          timestamp: '2026-03-06T00:00:00.000Z',
        },
        {
          offset: 2,
          operation: 'create',
          memoryId: 'mem-2',
          timestamp: '2026-03-06T00:00:01.000Z',
        },
      ];

      const mockVectorIndex = {
        upsert: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn(),
      };

      const mockEmbedding = {
        embedMemory: vi.fn().mockResolvedValue(new Array(384).fill(0)),
      };

      const context: WALRecoveryContext = {
        wal: createMockWAL(entries),
        storage: {
          read: vi.fn().mockImplementation(async (id: string) => {
            if (id === 'mem-1') return memory1;
            if (id === 'mem-2') return memory2;
            throw new Error('Not found');
          }),
          write: vi.fn(),
        } as unknown as WALRecoveryContext['storage'],
        vectorIndex: mockVectorIndex as unknown as WALRecoveryContext['vectorIndex'],
        embedding: mockEmbedding as unknown as WALRecoveryContext['embedding'],
        logger: mockLogger,
      };

      const recovery = new WALRecovery(context);
      await recovery.recover();

      expect(vi.mocked(context.wal).markIndexed).toHaveBeenCalledTimes(2);
      expect(vi.mocked(context.wal).markIndexed).toHaveBeenNthCalledWith(1, 1);
      expect(vi.mocked(context.wal).markIndexed).toHaveBeenNthCalledWith(2, 2);
    });

    it('works without vectorIndex (null case)', async () => {
      const memory = createTestMemory('mem-1');
      const entries: WALEntry[] = [
        {
          offset: 1,
          operation: 'create',
          memoryId: 'mem-1',
          timestamp: '2026-03-06T00:00:00.000Z',
        },
      ];

      const context: WALRecoveryContext = {
        wal: createMockWAL(entries),
        storage: {
          read: vi.fn().mockResolvedValue(memory),
          write: vi.fn(),
        } as unknown as WALRecoveryContext['storage'],
        vectorIndex: null,
        embedding: null,
        logger: mockLogger,
      };

      const recovery = new WALRecovery(context);
      await recovery.recover();

      // Should read the memory but not index (no vector index available)
      expect(vi.mocked(context.storage).read).toHaveBeenCalledWith('mem-1');
      expect(vi.mocked(context.wal).markIndexed).not.toHaveBeenCalled();
    });
  });
});
