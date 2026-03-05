import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import type { Logger } from '../../utils/logger.js';
import type { DaemonEndpoint } from './types.js';
import { PROTOCOL_VERSION } from './types.js';
import { parseJson } from './ipc-client.js';

/**
 * Checks if a process is alive
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      return (error as { code?: string }).code === 'EPERM';
    }
    return false;
  }
}

/**
 * Safely unlink a file
 */
export async function safeUnlink(path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch {
    // Best-effort cleanup only.
  }
}

/**
 * Lock file payload structure
 */
interface LockPayload {
  pid: number;
  createdAt: string;
}

/**
 * Daemon manager - handles daemon election and lifecycle
 */
export class DaemonManager {
  private readonly lockPath: string;
  private readonly endpointPath: string;
  private readonly logger: Logger;

  constructor(storagePath: string, logger: Logger) {
    this.lockPath = join(storagePath, '.memhub-daemon.lock');
    this.endpointPath = join(storagePath, '.memhub-daemon.json');
    this.logger = logger;
  }

  /**
   * Gets the lock file path
   */
  getLockPath(): string {
    return this.lockPath;
  }

  /**
   * Gets the endpoint file path
   */
  getEndpointPath(): string {
    return this.endpointPath;
  }

  /**
   * Tries to become the daemon process
   */
  async tryBecomeDaemon(): Promise<{ becameDaemon: boolean; endpoint?: DaemonEndpoint }> {
    const lockPayload: LockPayload = {
      pid: process.pid,
      createdAt: new Date().toISOString(),
    };

    try {
      await fs.writeFile(this.lockPath, JSON.stringify(lockPayload), {
        encoding: 'utf8',
        flag: 'wx',
      });
      await this.logger.info('lock.acquire', 'Acquired daemon election lock', {
        meta: { lockPath: this.lockPath },
      });
    } catch (error) {
      const alreadyExists =
        !!error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: string }).code === 'EEXIST';

      if (!alreadyExists) throw error;

      const staleRecovered = await this.tryRecoverStaleLock();
      if (!staleRecovered) return { becameDaemon: false };

      await fs.writeFile(this.lockPath, JSON.stringify(lockPayload), {
        encoding: 'utf8',
        flag: 'wx',
      });
      await this.logger.warn('lock.recovered', 'Recovered stale daemon lock and acquired it');
    }

    // Note: The caller is responsible for starting the server and writing the endpoint
    return { becameDaemon: true };
  }

  /**
   * Publishes the daemon endpoint
   */
  async publishEndpoint(endpoint: DaemonEndpoint): Promise<void> {
    await fs.mkdir(dirname(this.endpointPath), { recursive: true });
    await fs.writeFile(this.endpointPath, JSON.stringify(endpoint), 'utf8');
    await this.logger.info('daemon.ready', 'Daemon endpoint published', {
      meta: { endpoint },
    });
  }

  /**
   * Tries to recover a stale lock
   */
  private async tryRecoverStaleLock(): Promise<boolean> {
    let raw = '';
    try {
      raw = await fs.readFile(this.lockPath, 'utf8');
    } catch {
      return true;
    }

    let stale = true;
    try {
      const lock = parseJson<{ pid?: number }>(raw);
      stale = !isProcessAlive(lock.pid ?? -1);
    } catch {
      stale = true;
    }

    if (stale) {
      await safeUnlink(this.lockPath);
      await safeUnlink(this.endpointPath);
      await this.logger.warn('lock.stale_recovered', 'Recovered stale daemon lock');
      return true;
    }

    return false;
  }

  /**
   * Waits for a daemon endpoint to be available
   */
  async waitForEndpoint(): Promise<DaemonEndpoint | null> {
    for (let i = 0; i < 40; i += 1) {
      try {
        const raw = await fs.readFile(this.endpointPath, 'utf8');
        const endpoint = parseJson<DaemonEndpoint>(raw);
        if (endpoint.protocolVersion !== PROTOCOL_VERSION) {
          throw new Error(
            `Daemon protocol mismatch: expected ${PROTOCOL_VERSION}, got ${endpoint.protocolVersion}`
          );
        }

        if (!isProcessAlive(endpoint.pid)) {
          await safeUnlink(this.lockPath);
          await safeUnlink(this.endpointPath);
          await this.logger.warn(
            'daemon.dead',
            'Discovered dead daemon endpoint, triggering election'
          );
          break;
        }

        return endpoint;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }

    return null;
  }

  /**
   * Registers exit hooks for cleanup
   */
  registerExitHooks(): void {
    const cleanup = (): void => {
      void safeUnlink(this.endpointPath);
      void safeUnlink(this.lockPath);
    };

    process.once('exit', cleanup);
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }

  /**
   * Cleans up daemon files
   */
  async cleanup(): Promise<void> {
    await safeUnlink(this.endpointPath);
    await safeUnlink(this.lockPath);
  }
}
