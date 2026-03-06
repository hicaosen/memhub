import { describe, it, expect } from 'vitest';
import { join } from 'path';
import {
  SUBDIR,
  INTERNAL_PATHS,
  LEGACY_PATHS,
  getMemoriesPath,
  getInternalPath,
  getLanceDBPath,
  getWALPath,
  getIdempotencyPath,
  getDaemonLockPath,
  getDaemonJsonPath,
} from '../../src/storage/paths.js';

describe('paths constants', () => {
  describe('SUBDIR', () => {
    it('defines memories subdirectory', () => {
      expect(SUBDIR.memories).toBe('memories');
    });

    it('defines internal subdirectory', () => {
      expect(SUBDIR.internal).toBe('.internal');
    });
  });

  describe('INTERNAL_PATHS', () => {
    it('defines lancedb path', () => {
      expect(INTERNAL_PATHS.lancedb).toBe('.internal/lancedb');
    });

    it('defines wal path', () => {
      expect(INTERNAL_PATHS.wal).toBe('.internal/wal');
    });

    it('defines idempotency path', () => {
      expect(INTERNAL_PATHS.idempotency).toBe('.internal/idempotency');
    });

    it('defines daemon lock path', () => {
      expect(INTERNAL_PATHS.daemonLock).toBe('.internal/daemon.lock');
    });

    it('defines daemon json path', () => {
      expect(INTERNAL_PATHS.daemonJson).toBe('.internal/daemon.json');
    });
  });

  describe('LEGACY_PATHS', () => {
    it('defines legacy lancedb path', () => {
      expect(LEGACY_PATHS.lancedb).toBe('.lancedb');
    });

    it('defines legacy wal path', () => {
      expect(LEGACY_PATHS.wal).toBe('wal');
    });

    it('defines legacy idempotency path', () => {
      expect(LEGACY_PATHS.idempotency).toBe('idempotency');
    });

    it('defines legacy daemon lock path', () => {
      expect(LEGACY_PATHS.daemonLock).toBe('.memhub-daemon.lock');
    });

    it('defines legacy daemon json path', () => {
      expect(LEGACY_PATHS.daemonJson).toBe('.memhub-daemon.json');
    });
  });
});

describe('path functions', () => {
  const storagePath = '/home/user/.memhub';

  describe('getMemoriesPath', () => {
    it('returns memories subdirectory path', () => {
      expect(getMemoriesPath(storagePath)).toBe(join(storagePath, 'memories'));
    });
  });

  describe('getInternalPath', () => {
    it('returns internal subdirectory path', () => {
      expect(getInternalPath(storagePath)).toBe(join(storagePath, '.internal'));
    });
  });

  describe('getLanceDBPath', () => {
    it('returns lancedb path', () => {
      expect(getLanceDBPath(storagePath)).toBe(join(storagePath, '.internal', 'lancedb'));
    });
  });

  describe('getWALPath', () => {
    it('returns wal path', () => {
      expect(getWALPath(storagePath)).toBe(join(storagePath, '.internal', 'wal'));
    });
  });

  describe('getIdempotencyPath', () => {
    it('returns idempotency path', () => {
      expect(getIdempotencyPath(storagePath)).toBe(join(storagePath, '.internal', 'idempotency'));
    });
  });

  describe('getDaemonLockPath', () => {
    it('returns daemon lock path', () => {
      expect(getDaemonLockPath(storagePath)).toBe(join(storagePath, '.internal', 'daemon.lock'));
    });
  });

  describe('getDaemonJsonPath', () => {
    it('returns daemon json path', () => {
      expect(getDaemonJsonPath(storagePath)).toBe(join(storagePath, '.internal', 'daemon.json'));
    });
  });
});
