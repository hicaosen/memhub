import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogRole = 'daemon' | 'client';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEYS = new Set([
  'content',
  'token',
  'password',
  'authorization',
  'apiKey',
  'api_key',
  'path',
  'filePath',
  'file_path',
]);

const DATE_PATTERN = /^(daemon|client|error)-(\d{4}-\d{2}-\d{2})\.log(?:\.\d+)?$/;

export interface LogContext {
  readonly requestId?: string;
  readonly sessionId?: string;
  readonly durationMs?: number;
  readonly meta?: Record<string, unknown>;
}

export interface Logger {
  setRole(role: LogRole): void;
  debug(event: string, message: string, context?: LogContext): Promise<void>;
  info(event: string, message: string, context?: LogContext): Promise<void>;
  warn(event: string, message: string, context?: LogContext): Promise<void>;
  error(event: string, message: string, context?: LogContext): Promise<void>;
}

export interface LoggerConfig {
  readonly level?: LogLevel;
  readonly role?: LogRole;
  readonly logDir?: string;
  readonly retentionDays?: number;
  readonly maxFileSizeBytes?: number;
  readonly now?: () => Date;
}

interface JsonLogLine {
  readonly ts: string;
  readonly level: LogLevel;
  readonly role: LogRole;
  readonly pid: number;
  readonly event: string;
  readonly message: string;
  readonly requestId?: string;
  readonly sessionId?: string;
  readonly durationMs?: number;
  readonly meta?: Record<string, unknown>;
}

function defaultLogDir(): string {
  return join(homedir(), '.memhub', 'logs');
}

function dateStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => redact(item));
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redact(raw);
      }
    }
    return out;
  }

  return value;
}

async function safeStatSize(path: string): Promise<number> {
  try {
    const stat = await fs.stat(path);
    return stat.size;
  } catch {
    return 0;
  }
}

export class JsonFileLogger implements Logger {
  private readonly minLevel: LogLevel;
  private readonly logDir: string;
  private readonly retentionDays: number;
  private readonly maxFileSizeBytes: number;
  private readonly now: () => Date;
  private role: LogRole;
  private initPromise: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(config: LoggerConfig = {}) {
    const envLevel = process.env.MEMHUB_LOG_LEVEL as LogLevel | undefined;
    const envDir = process.env.MEMHUB_LOG_DIR;
    const envRetention = process.env.MEMHUB_LOG_RETENTION_DAYS;

    this.minLevel = config.level ?? envLevel ?? 'info';
    this.role = config.role ?? 'client';
    this.logDir = config.logDir ?? envDir ?? defaultLogDir();
    this.retentionDays = config.retentionDays ?? Number(envRetention || '14');
    this.maxFileSizeBytes = config.maxFileSizeBytes ?? 20 * 1024 * 1024;
    this.now = config.now ?? (() => new Date());
  }

  setRole(role: LogRole): void {
    this.role = role;
  }

  debug(event: string, message: string, context?: LogContext): Promise<void> {
    return this.log('debug', event, message, context);
  }

  info(event: string, message: string, context?: LogContext): Promise<void> {
    return this.log('info', event, message, context);
  }

  warn(event: string, message: string, context?: LogContext): Promise<void> {
    return this.log('warn', event, message, context);
  }

  error(event: string, message: string, context?: LogContext): Promise<void> {
    return this.log('error', event, message, context);
  }

  private async log(
    level: LogLevel,
    event: string,
    message: string,
    context?: LogContext
  ): Promise<void> {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minLevel]) return;

    const ts = this.now();
    const line: JsonLogLine = {
      ts: ts.toISOString(),
      level,
      role: this.role,
      pid: process.pid,
      event,
      message,
      ...(context?.requestId !== undefined && { requestId: context.requestId }),
      ...(context?.sessionId !== undefined && { sessionId: context.sessionId }),
      ...(context?.durationMs !== undefined && { durationMs: context.durationMs }),
      ...(context?.meta !== undefined && {
        meta: redact(context.meta) as Record<string, unknown>,
      }),
    };

    const payload = `${JSON.stringify(line)}\n`;

    this.writeQueue = this.writeQueue
      .then(async () => {
        await this.ensureInitialized();
        const stamp = dateStamp(ts);
        const roleFile = join(this.logDir, `${this.role}-${stamp}.log`);
        const errorFile = join(this.logDir, `error-${stamp}.log`);

        await this.rotateIfNeeded(roleFile, payload.length);
        await fs.appendFile(roleFile, payload, 'utf8');

        if (level === 'error') {
          await this.rotateIfNeeded(errorFile, payload.length);
          await fs.appendFile(errorFile, payload, 'utf8');
        }
      })
      .catch(() => {
        // Never throw from logger.
      });

    return this.writeQueue;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await fs.mkdir(this.logDir, { recursive: true });
        await this.cleanupOldLogs();
      })();
    }

    await this.initPromise;
  }

  private async rotateIfNeeded(path: string, incomingBytes: number): Promise<void> {
    const currentSize = await safeStatSize(path);
    if (currentSize + incomingBytes <= this.maxFileSizeBytes) return;

    for (let i = 2; i >= 1; i -= 1) {
      const src = `${path}.${i}`;
      const dest = `${path}.${i + 1}`;
      try {
        await fs.rename(src, dest);
      } catch {
        // Ignore missing backup files.
      }
    }

    try {
      await fs.rename(path, `${path}.1`);
    } catch {
      // Ignore missing current file.
    }
  }

  private async cleanupOldLogs(): Promise<void> {
    let names: string[] = [];
    try {
      names = await fs.readdir(this.logDir);
    } catch {
      return;
    }

    const nowMs = this.now().getTime();
    const keepMs = Math.max(1, this.retentionDays) * 24 * 60 * 60 * 1000;

    await Promise.all(
      names.map(async name => {
        const match = name.match(DATE_PATTERN);
        if (!match) return;

        const day = match[2];
        const fileDateMs = new Date(`${day}T00:00:00.000Z`).getTime();
        if (!Number.isFinite(fileDateMs)) return;

        if (nowMs - fileDateMs > keepMs) {
          try {
            await fs.unlink(join(this.logDir, name));
          } catch {
            // Ignore race and permission errors.
          }
        }
      })
    );
  }
}

export function createLogger(config: LoggerConfig = {}): Logger {
  return new JsonFileLogger(config);
}
