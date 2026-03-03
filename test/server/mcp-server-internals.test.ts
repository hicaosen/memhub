import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { McpServer } from '../../src/server/mcp-server.js';
import { MCP_METHODS, ERROR_CODES, MCP_PROTOCOL_VERSION } from '../../src/contracts/mcp.js';
import { ErrorCode } from '../../src/contracts/types.js';
import { ServiceError } from '../../src/services/memory-service.js';

interface ServerPrivate {
  handleMethod: (method: string, params: unknown) => Promise<unknown>;
  handleMessage: (message: string) => Promise<void>;
  handleError: (id: string | number | null, error: unknown) => void;
  sendResponse: (id: string | number, result: unknown) => void;
  sendError: (id: string | number | null, code: number, message: string, data?: Record<string, unknown>) => void;
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void;
}

describe('McpServer internals', () => {
  let tempDir: string;
  let server: McpServer;
  let serverPrivate: ServerPrivate;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'memhub-server-int-test-'));
    process.env.MEMHUB_STORAGE_PATH = tempDir;
    server = new McpServer();
    serverPrivate = server as unknown as ServerPrivate;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.MEMHUB_STORAGE_PATH;
    delete process.env.MEMHUB_LOG_LEVEL;
    vi.restoreAllMocks();
  });

  it('handles initialize method', async () => {
    const result = (await serverPrivate.handleMethod(MCP_METHODS.INITIALIZE, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'tester', version: '1.0.0' },
    })) as { protocolVersion: string; serverInfo: { name: string; version: string } };

    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(result.serverInfo.name).toBe('memhub');
    expect(result.serverInfo.version.length).toBeGreaterThan(0);
  });

  it('handles tools/list method', async () => {
    const result = (await serverPrivate.handleMethod(MCP_METHODS.TOOLS_LIST, {})) as {
      tools: Array<{ name: string }>;
    };

    expect(result.tools.length).toBe(2);
    expect(result.tools.some(t => t.name === 'memory_load')).toBe(true);
  });

  it('handles tools/call for STM load + update flow', async () => {
    const updateResult = (await serverPrivate.handleMethod(MCP_METHODS.TOOLS_CALL, {
      name: 'memory_update',
      arguments: {
        sessionId: '550e8400-e29b-41d4-a716-446655440111',
        entryType: 'decision',
        title: 'TDD note',
        content: 'Write tests first',
        tags: ['tdd'],
        category: 'engineering',
      },
    })) as { content: Array<{ text: string }> };

    const updatePayload = JSON.parse(updateResult.content[0].text) as { id: string; sessionId: string };
    expect(updatePayload.id).toBeTruthy();
    expect(updatePayload.sessionId).toBe('550e8400-e29b-41d4-a716-446655440111');

    const loadById = (await serverPrivate.handleMethod(MCP_METHODS.TOOLS_CALL, {
      name: 'memory_load',
      arguments: { id: updatePayload.id },
    })) as { content: Array<{ text: string }> };
    expect(loadById.content[0].text).toContain('TDD note');

    const loadBySession = (await serverPrivate.handleMethod(MCP_METHODS.TOOLS_CALL, {
      name: 'memory_load',
      arguments: { sessionId: '550e8400-e29b-41d4-a716-446655440111', limit: 10 },
    })) as { content: Array<{ text: string }> };
    expect(loadBySession.content[0].text).toContain('items');
  });

  it('returns tool error payload for unknown tool', async () => {
    const result = (await serverPrivate.handleMethod(MCP_METHODS.TOOLS_CALL, {
      name: 'unknown_tool',
      arguments: {},
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });

  it('handles lifecycle methods', async () => {
    await expect(serverPrivate.handleMethod(MCP_METHODS.INITIALIZED, {})).resolves.toBeNull();
    await expect(serverPrivate.handleMethod(MCP_METHODS.SHUTDOWN, {})).resolves.toBeNull();

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);

    await expect(serverPrivate.handleMethod(MCP_METHODS.EXIT, {})).resolves.toBeNull();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('throws ServiceError for unknown method', async () => {
    await expect(serverPrivate.handleMethod('unknown/method', {})).rejects.toMatchObject({
      code: ErrorCode.METHOD_NOT_FOUND,
    });
  });

  it('routes parse errors from handleMessage', async () => {
    const sendErrorSpy = vi
      .spyOn(serverPrivate, 'sendError')
      .mockImplementation(() => undefined);

    await serverPrivate.handleMessage('{bad-json');

    expect(sendErrorSpy).toHaveBeenCalledWith(
      null,
      ERROR_CODES.PARSE_ERROR,
      'Parse error: Invalid JSON'
    );
  });

  it('routes invalid request errors from handleMessage', async () => {
    const sendErrorSpy = vi
      .spyOn(serverPrivate, 'sendError')
      .mockImplementation(() => undefined);

    await serverPrivate.handleMessage(JSON.stringify({ jsonrpc: '2.0' }));

    expect(sendErrorSpy).toHaveBeenCalledWith(
      null,
      ERROR_CODES.INVALID_REQUEST,
      'Invalid Request'
    );
  });

  it('does not send response for notifications without id', async () => {
    const sendResponseSpy = vi
      .spyOn(serverPrivate, 'sendResponse')
      .mockImplementation(() => undefined);

    await serverPrivate.handleMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        method: MCP_METHODS.INITIALIZED,
        params: {},
      })
    );

    expect(sendResponseSpy).not.toHaveBeenCalled();
  });

  it('returns INVALID_PARAMS on schema validation errors', async () => {
    const sendErrorSpy = vi
      .spyOn(serverPrivate, 'sendError')
      .mockImplementation(() => undefined);

    await serverPrivate.handleMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 123,
        method: MCP_METHODS.TOOLS_CALL,
        params: {
          name: 'memory_update',
          arguments: { title: '' },
        },
      })
    );

    expect(sendErrorSpy).toHaveBeenCalledWith(
      123,
      ERROR_CODES.INVALID_PARAMS,
      expect.stringContaining('Invalid parameters')
    );
  });

  it('handleError maps ServiceError, validation error, and generic error', () => {
    const sendErrorSpy = vi
      .spyOn(serverPrivate, 'sendError')
      .mockImplementation(() => undefined);

    serverPrivate.handleError(
      1,
      new ServiceError('boom', ErrorCode.STORAGE_ERROR, { foo: 'bar' })
    );
    const zodLikeError = new Error('invalid');
    zodLikeError.name = 'ZodError';
    serverPrivate.handleError(2, zodLikeError);
    serverPrivate.handleError(3, new Error('oops'));

    expect(sendErrorSpy).toHaveBeenNthCalledWith(
      1,
      1,
      ErrorCode.STORAGE_ERROR,
      'boom',
      { foo: 'bar' }
    );
    expect(sendErrorSpy).toHaveBeenNthCalledWith(
      2,
      2,
      ERROR_CODES.INVALID_PARAMS,
      'Invalid parameters: invalid'
    );
    expect(sendErrorSpy).toHaveBeenNthCalledWith(
      3,
      3,
      ERROR_CODES.INTERNAL_ERROR,
      'Internal error: oops'
    );
  });

  it('sendResponse writes valid JSON-RPC response', () => {
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockReturnValue(true);

    serverPrivate.sendResponse(7, { ok: true });

    const output = String(writeSpy.mock.calls[0][0]).trim();
    const parsed = JSON.parse(output) as { id: number; result: { ok: boolean } };
    expect(parsed.id).toBe(7);
    expect(parsed.result.ok).toBe(true);
  });

  it('sendError writes valid JSON-RPC error response', () => {
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockReturnValue(true);

    serverPrivate.sendError(null, ERROR_CODES.INTERNAL_ERROR, 'failure');

    const output = String(writeSpy.mock.calls[0][0]).trim();
    const parsed = JSON.parse(output) as { id: null; error: { code: number; message: string } };
    expect(parsed.id).toBeNull();
    expect(parsed.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(parsed.error.message).toBe('failure');
  });

  it('log respects configured log level', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    process.env.MEMHUB_LOG_LEVEL = 'error';
    serverPrivate.log('info', 'ignore');
    serverPrivate.log('error', 'report');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('[ERROR] report');
  });
});
