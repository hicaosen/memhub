import { ErrorCode } from '../contracts/types.js';

/**
 * Custom error for service operations
 */
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly data?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}
