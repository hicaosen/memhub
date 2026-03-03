/**
 * MCP Server Tests
 * Tests for the McpServer class
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpServer } from '../../src/server/mcp-server.js';
import {
  TOOL_DEFINITIONS,
  SERVER_INFO,
  ERROR_CODES,
  MCP_PROTOCOL_VERSION,
} from '../../src/contracts/mcp.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('McpServer', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'memhub-server-test-'));
    process.env.MEMHUB_STORAGE_PATH = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.MEMHUB_STORAGE_PATH;
  });

  describe('constructor', () => {
    it('should create server instance', () => {
      const server = new McpServer();
      expect(server).toBeDefined();
    });
  });

  describe('TOOL_DEFINITIONS', () => {
    it('should have 2 tools defined', () => {
      expect(TOOL_DEFINITIONS).toHaveLength(2);
    });

    it('should include STM-first tools', () => {
      const toolNames = TOOL_DEFINITIONS.map(t => t.name);
      expect(toolNames).toContain('memory_load');
      expect(toolNames).toContain('memory_update');
    });

    it('should have descriptions for all tools', () => {
      for (const tool of TOOL_DEFINITIONS) {
        expect(tool.description).toBeDefined();
        expect(tool.description.length).toBeGreaterThan(0);
      }
    });

    it('should have input schemas for all tools', () => {
      for (const tool of TOOL_DEFINITIONS) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      }
    });
  });

  describe('ServerInfo', () => {
    it('should have correct server name', () => {
      expect(SERVER_INFO.name).toBe('memhub');
    });

    it('should have version', () => {
      expect(SERVER_INFO.version).toBeDefined();
      expect(SERVER_INFO.version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('ErrorCodes', () => {
    it('should have standard MCP error codes', () => {
      expect(ERROR_CODES.PARSE_ERROR).toBe(-32700);
      expect(ERROR_CODES.INVALID_REQUEST).toBe(-32600);
      expect(ERROR_CODES.METHOD_NOT_FOUND).toBe(-32601);
      expect(ERROR_CODES.INVALID_PARAMS).toBe(-32602);
      expect(ERROR_CODES.INTERNAL_ERROR).toBe(-32603);
    });

    it('should have custom MemHub error codes', () => {
      expect(ERROR_CODES.NOT_FOUND).toBe(-32001);
      expect(ERROR_CODES.STORAGE_ERROR).toBe(-32002);
      expect(ERROR_CODES.VALIDATION_ERROR).toBe(-32003);
      expect(ERROR_CODES.DUPLICATE_ERROR).toBe(-32004);
    });
  });

  describe('Protocol', () => {
    it('should have correct protocol version', () => {
      expect(MCP_PROTOCOL_VERSION).toBe('2024-11-05');
    });
  });
});
