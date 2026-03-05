// Types
export {
  PROTOCOL_VERSION,
  LOOPBACK_HOST,
  IPC_RETRY_DELAYS_MS,
  LOAD_CONNECT_TIMEOUT_MS,
  LOAD_RESPONSE_TIMEOUT_MS,
  UPDATE_CONNECT_TIMEOUT_MS,
  UPDATE_RESPONSE_TIMEOUT_MS,
} from './types.js';
export type {
  BackendRole,
  DaemonEndpoint,
  DaemonRequest,
  DaemonResponse,
  SendRequestOptions,
  RetryRequestOptions,
} from './types.js';

// IPC Client
export { IpcClient, isRetriableIpcError, sleep, parseJson } from './ipc-client.js';

// IPC Server
export { IpcServer } from './ipc-server.js';
export type { RequestHandler } from './ipc-server.js';

// Daemon Manager
export { DaemonManager, isProcessAlive, safeUnlink } from './daemon-manager.js';
