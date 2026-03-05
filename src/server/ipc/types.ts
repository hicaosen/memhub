import type {
  MemoryLoadInput,
  MemoryLoadOutput,
  MemoryUpdateInput,
  MemoryUpdateOutput,
} from '../../contracts/types.js';

// Protocol constants
export const PROTOCOL_VERSION = 1;
export const LOOPBACK_HOST = '127.0.0.1';
export const IPC_RETRY_DELAYS_MS = [50, 100, 200] as const;
export const LOAD_CONNECT_TIMEOUT_MS = 300;
export const LOAD_RESPONSE_TIMEOUT_MS = 8000;
export const UPDATE_CONNECT_TIMEOUT_MS = 300;
export const UPDATE_RESPONSE_TIMEOUT_MS = 30000;

// Types
export type BackendRole = 'daemon' | 'client';

export type DaemonEndpoint = {
  readonly pid: number;
  readonly host: string;
  readonly port: number;
  readonly protocolVersion: number;
};

export type DaemonRequest =
  | {
      readonly id: string;
      readonly method: 'memory_load';
      readonly params: MemoryLoadInput;
    }
  | {
      readonly id: string;
      readonly method: 'memory_update';
      readonly params: MemoryUpdateInput;
    };

export type DaemonResponse = {
  readonly id: string;
  readonly ok: boolean;
  readonly result?: MemoryLoadOutput | MemoryUpdateOutput;
  readonly error?: string;
};

export type SendRequestOptions = {
  readonly endpoint?: DaemonEndpoint;
  readonly connectTimeoutMs: number;
  readonly responseTimeoutMs: number;
};

export type RetryRequestOptions = SendRequestOptions & {
  readonly retryDelaysMs: readonly number[];
};
