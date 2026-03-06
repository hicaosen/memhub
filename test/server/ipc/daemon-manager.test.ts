import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  DaemonManager,
  isProcessAlive,
  safeUnlink,
} from '../../../src/server/ipc/daemon-manager.js';
import type { Logger } from '../../../src/utils/logger.js';
import { getInternalPath } from '../../../src/storage/paths.js';

function createLoggerStub(): Logger {
  return {
    setRole: () => undefined,
    debug: async () => undefined,
    info: async () => undefined,
    warn: async () => undefined,
    error: async () => undefined,
  };
}

describe('isProcessAlive', () => {
  it('returns false for invalid pid', () => {
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(1.5)).toBe(false);
    expect(isProcessAlive(NaN)).toBe(false);
  });

  it('returns true for current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('returns false for non-existent process', () => {
    // Use a very high PID that is unlikely to exist
    expect(isProcessAlive(9999999)).toBe(false);
  });
});

describe('safeUnlink', () => {
  let tempDir = '';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'memhub-safeunlink-test-'));
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('removes existing file', async () => {
    const filePath = join(tempDir, 'test.txt');
    writeFileSync(filePath, 'test');

    await safeUnlink(filePath);

    expect(existsSync(filePath)).toBe(false);
  });

  it('does not throw for non-existent file', async () => {
    const filePath = join(tempDir, 'nonexistent.txt');

    await expect(safeUnlink(filePath)).resolves.not.toThrow();
  });
});

describe('DaemonManager', () => {
  let tempDir = '';

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
    vi.restoreAllMocks();
  });

  describe('constructor and getters', () => {
    it('creates correct lock and endpoint paths', () => {
      tempDir = mkdtempSync(join(tmpdir(), 'memhub-daemon-manager-test-'));
      const manager = new DaemonManager(tempDir, createLoggerStub());
      const internalPath = getInternalPath(tempDir);

      expect(manager.getLockPath()).toBe(join(internalPath, 'daemon.lock'));
      expect(manager.getEndpointPath()).toBe(join(internalPath, 'daemon.json'));
    });
  });

  describe('tryBecomeDaemon', () => {
    it('acquires lock when no existing lock', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'memhub-daemon-manager-test-'));
      mkdirSync(getInternalPath(tempDir), { recursive: true });
      const manager = new DaemonManager(tempDir, createLoggerStub());

      const result = await manager.tryBecomeDaemon();

      expect(result.becameDaemon).toBe(true);
      expect(existsSync(manager.getLockPath())).toBe(true);
    });

    it('fails when another process holds the lock', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'memhub-daemon-manager-test-'));
      mkdirSync(getInternalPath(tempDir), { recursive: true });
      const manager = new DaemonManager(tempDir, createLoggerStub());

      // Write a lock file with current process PID (alive)
      writeFileSync(
        manager.getLockPath(),
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })
      );

      const result = await manager.tryBecomeDaemon();

      expect(result.becameDaemon).toBe(false);
    });

    it('recovers stale lock when process is dead', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'memhub-daemon-manager-test-'));
      mkdirSync(getInternalPath(tempDir), { recursive: true });
      const manager = new DaemonManager(tempDir, createLoggerStub());

      // Write a lock file with non-existent PID
      writeFileSync(
        manager.getLockPath(),
        JSON.stringify({ pid: 9999999, createdAt: new Date().toISOString() })
      );

      const result = await manager.tryBecomeDaemon();

      expect(result.becameDaemon).toBe(true);
    });

    it('recovers malformed lock file', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'memhub-daemon-manager-test-'));
      mkdirSync(getInternalPath(tempDir), { recursive: true });
      const manager = new DaemonManager(tempDir, createLoggerStub());

      // Write an invalid JSON lock file
      writeFileSync(manager.getLockPath(), 'not valid json');

      const result = await manager.tryBecomeDaemon();

      expect(result.becameDaemon).toBe(true);
    });
  });

  describe('publishEndpoint', () => {
    it('writes endpoint file', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'memhub-daemon-manager-test-'));
      mkdirSync(getInternalPath(tempDir), { recursive: true });
      const manager = new DaemonManager(tempDir, createLoggerStub());

      await manager.publishEndpoint({
        pid: process.pid,
        protocolVersion: 1,
        socketPath: join(tempDir, 'socket'),
      });

      expect(existsSync(manager.getEndpointPath())).toBe(true);
      const content = JSON.parse(readFileSync(manager.getEndpointPath(), 'utf8'));
      expect(content.pid).toBe(process.pid);
      expect(content.protocolVersion).toBe(1);
    });
  });

  describe('waitForEndpoint', () => {
    it('returns endpoint when available', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'memhub-daemon-manager-test-'));
      mkdirSync(getInternalPath(tempDir), { recursive: true });
      const manager = new DaemonManager(tempDir, createLoggerStub());

      // Write endpoint file
      writeFileSync(
        manager.getEndpointPath(),
        JSON.stringify({
          pid: process.pid,
          protocolVersion: 1,
          socketPath: join(tempDir, 'socket'),
        })
      );

      const endpoint = await manager.waitForEndpoint(1000);

      expect(endpoint).not.toBeNull();
      expect(endpoint?.pid).toBe(process.pid);
    });

    it('returns null when endpoint not available', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'memhub-daemon-manager-test-'));
      const manager = new DaemonManager(tempDir, createLoggerStub());

      const endpoint = await manager.waitForEndpoint(100);

      expect(endpoint).toBeNull();
    });

    it('returns null when daemon process is dead', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'memhub-daemon-manager-test-'));
      mkdirSync(getInternalPath(tempDir), { recursive: true });
      const manager = new DaemonManager(tempDir, createLoggerStub());

      // Write endpoint with dead process
      writeFileSync(
        manager.getEndpointPath(),
        JSON.stringify({
          pid: 9999999,
          protocolVersion: 1,
          socketPath: join(tempDir, 'socket'),
        })
      );

      const endpoint = await manager.waitForEndpoint(100);

      expect(endpoint).toBeNull();
      // Should clean up dead daemon files
      expect(existsSync(manager.getEndpointPath())).toBe(false);
      expect(existsSync(manager.getLockPath())).toBe(false);
    });

    it('throws on protocol version mismatch', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'memhub-daemon-manager-test-'));
      mkdirSync(getInternalPath(tempDir), { recursive: true });
      const manager = new DaemonManager(tempDir, createLoggerStub());

      // Write endpoint with wrong protocol version
      writeFileSync(
        manager.getEndpointPath(),
        JSON.stringify({
          pid: process.pid,
          protocolVersion: 999,
          socketPath: join(tempDir, 'socket'),
        })
      );

      const endpoint = await manager.waitForEndpoint(100);

      // Should fail to get valid endpoint
      expect(endpoint).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('removes lock and endpoint files', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'memhub-daemon-manager-test-'));
      mkdirSync(getInternalPath(tempDir), { recursive: true });
      const manager = new DaemonManager(tempDir, createLoggerStub());

      // Create files
      writeFileSync(manager.getLockPath(), '{}');
      writeFileSync(manager.getEndpointPath(), '{}');

      await manager.cleanup();

      expect(existsSync(manager.getLockPath())).toBe(false);
      expect(existsSync(manager.getEndpointPath())).toBe(false);
    });

    it('does not throw when files do not exist', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'memhub-daemon-manager-test-'));
      const manager = new DaemonManager(tempDir, createLoggerStub());

      await expect(manager.cleanup()).resolves.not.toThrow();
    });
  });

  describe('registerExitHooks', () => {
    it('should be idempotent', () => {
      tempDir = mkdtempSync(join(tmpdir(), 'memhub-daemon-manager-test-'));
      const manager = new DaemonManager(tempDir, createLoggerStub());

      const onceSpy = vi.spyOn(process, 'once');

      manager.registerExitHooks();
      manager.registerExitHooks();

      expect(onceSpy).toHaveBeenCalledTimes(4);
      expect(onceSpy).toHaveBeenNthCalledWith(1, 'exit', expect.any(Function));
      expect(onceSpy).toHaveBeenNthCalledWith(2, 'SIGINT', expect.any(Function));
      expect(onceSpy).toHaveBeenNthCalledWith(3, 'SIGTERM', expect.any(Function));
      expect(onceSpy).toHaveBeenNthCalledWith(4, 'SIGHUP', expect.any(Function));
    });

    it('signal hooks should cleanup then exit process', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'memhub-daemon-manager-test-'));
      const manager = new DaemonManager(tempDir, createLoggerStub());

      const handlers = new Map<string, () => void>();
      vi.spyOn(process, 'once').mockImplementation(((event: string, handler: () => void) => {
        handlers.set(event, handler);
        return process;
      }) as typeof process.once);
      const cleanupSpy = vi.spyOn(manager, 'cleanup').mockResolvedValue();
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

      manager.registerExitHooks();

      const sigtermHandler = handlers.get('SIGTERM');
      expect(sigtermHandler).toBeDefined();
      sigtermHandler?.();

      expect(cleanupSpy).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => {
        expect(exitSpy).toHaveBeenCalledWith(0);
      });
    });

    it('SIGINT hook should cleanup then exit process', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'memhub-daemon-manager-test-'));
      const manager = new DaemonManager(tempDir, createLoggerStub());

      const handlers = new Map<string, () => void>();
      vi.spyOn(process, 'once').mockImplementation(((event: string, handler: () => void) => {
        handlers.set(event, handler);
        return process;
      }) as typeof process.once);
      const cleanupSpy = vi.spyOn(manager, 'cleanup').mockResolvedValue();
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

      manager.registerExitHooks();

      const sigintHandler = handlers.get('SIGINT');
      sigintHandler?.();

      await vi.waitFor(() => {
        expect(cleanupSpy).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
      });
    });

    it('SIGHUP hook should cleanup then exit process', async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'memhub-daemon-manager-test-'));
      const manager = new DaemonManager(tempDir, createLoggerStub());

      const handlers = new Map<string, () => void>();
      vi.spyOn(process, 'once').mockImplementation(((event: string, handler: () => void) => {
        handlers.set(event, handler);
        return process;
      }) as typeof process.once);
      const cleanupSpy = vi.spyOn(manager, 'cleanup').mockResolvedValue();
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

      manager.registerExitHooks();

      const sighupHandler = handlers.get('SIGHUP');
      sighupHandler?.();

      await vi.waitFor(() => {
        expect(cleanupSpy).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
      });
    });
  });
});
