import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installStdioLifecycleGuard } from '../../src/server/stdio-lifecycle.js';

describe('stdio-lifecycle', () => {
  let originalPpid: number;

  beforeEach(() => {
    originalPpid = process.ppid;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(process, 'ppid', {
      value: originalPpid,
      configurable: true,
    });
  });

  it('sets up a keep-alive timer', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    installStdioLifecycleGuard();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
  });

  it('returns a stop function that clears the timer', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const stop = installStdioLifecycleGuard();

    stop();

    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('stop function is idempotent', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const stop = installStdioLifecycleGuard();

    stop();
    stop();
    stop();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('exits process when parent process changes', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    installStdioLifecycleGuard();

    // Change ppid after guard is installed
    Object.defineProperty(process, 'ppid', {
      value: 9999,
      configurable: true,
    });

    // Advance timer by one interval (1000ms)
    vi.advanceTimersByTime(1000);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('exits process when ppid becomes 1 (orphaned)', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    installStdioLifecycleGuard();

    // Simulate becoming orphaned (ppid = 1)
    Object.defineProperty(process, 'ppid', {
      value: 1,
      configurable: true,
    });

    vi.advanceTimersByTime(1000);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('does not exit when parent process stays the same', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    installStdioLifecycleGuard();

    // ppid stays the same (original value)
    vi.advanceTimersByTime(1000);

    expect(exitSpy).not.toHaveBeenCalled();
  });
});
