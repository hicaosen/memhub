/**
 * Keep stdio MCP server process alive in non-TTY/piped environments.
 *
 * In some launchers, only attaching stdin listeners is not enough to keep the
 * Node.js event loop alive, which can cause immediate process exit and
 * "Transport closed" errors on the client side.
 */
export function installStdioLifecycleGuard(): () => void {
  const parentPid = process.ppid;
  // Keep one active handle while MCP server is running and detect orphaning.
  const keepAliveTimer = setInterval(() => {
    if (process.ppid !== parentPid || process.ppid === 1) {
      process.exit(0);
    }
  }, 1_000);
  let stopped = false;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(keepAliveTimer);
  };

  return stop;
}
