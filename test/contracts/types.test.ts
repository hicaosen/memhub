/**
 * Types Tests
 * Tests for type definitions and error codes
 */

import { describe, it, expect } from 'vitest';
import { ErrorCode } from '../../src/contracts/types.js';

describe('ErrorCode', () => {
  it('should have correct error code values', () => {
    expect(ErrorCode.PARSE_ERROR).toBe(-32700);
    expect(ErrorCode.INVALID_REQUEST).toBe(-32600);
    expect(ErrorCode.METHOD_NOT_FOUND).toBe(-32601);
    expect(ErrorCode.INVALID_PARAMS).toBe(-32602);
    expect(ErrorCode.INTERNAL_ERROR).toBe(-32603);
    expect(ErrorCode.NOT_FOUND).toBe(-32001);
    expect(ErrorCode.STORAGE_ERROR).toBe(-32002);
    expect(ErrorCode.VALIDATION_ERROR).toBe(-32003);
    expect(ErrorCode.DUPLICATE_ERROR).toBe(-32004);
  });
});
