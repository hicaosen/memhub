import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DaemonManager } from '../../../src/server/ipc/daemon-manager.js';
import type { Logger } from '../../../src/utils/logger.js';

function createLoggerStub(): Logger {
  return {
    setRole: () => undefined,
    debug: async () => undefined,
    info: async () => undefined,
    warn: async () => undefined,
    error: async () => undefined,
  };
}

describe('DaemonManager', () => {
  let tempDir = '';

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
    vi.restoreAllMocks();
  });

  it('registerExitHooks should be idempotent', () => {
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
});
