/**
 * MCP Server Tests
 * Tests for the MCP Server using @modelcontextprotocol/sdk
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createMcpServer } from '../../src/server/mcp-server.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  TOOL_DEFINITIONS,
  SERVER_INFO,
  ERROR_CODES,
  MCP_PROTOCOL_VERSION,
} from '../../src/contracts/mcp.js';
import { MemoryService } from '../../src/services/memory-service.js';
import { MemoryLoadInputSchema, MemoryUpdateInputV2Schema } from '../../src/contracts/schemas.js';

describe('McpServer (SDK)', () => {
  let tempDir: string;
  let server: Server;
  let memoryService: MemoryService;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'memhub-server-test-'));
    process.env.MEMHUB_STORAGE_PATH = tempDir;
    process.env.MEMHUB_VECTOR_SEARCH = 'false';
    server = createMcpServer();
    memoryService = new MemoryService({ storagePath: tempDir, vectorSearch: false });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.MEMHUB_STORAGE_PATH;
    delete process.env.MEMHUB_VECTOR_SEARCH;
  });

  describe('createMcpServer', () => {
    it('should create server instance', () => {
      expect(server).toBeDefined();
      expect(server).toBeInstanceOf(Server);
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

  describe('Tool Integration Tests', () => {
    it('should handle memory_update via MemoryService', async () => {
      const input = MemoryUpdateInputV2Schema.parse({
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        entryType: 'decision',
        title: 'Test decision',
        content: 'This is a test decision',
        tags: ['test'],
        category: 'general',
      });

      const result = await memoryService.memoryUpdate(input);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('sessionId');
      expect(result.sessionId).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(result.created).toBe(true);
    });

    it('should handle memory_load via MemoryService', async () => {
      // First create a memory
      const updateInput = MemoryUpdateInputV2Schema.parse({
        sessionId: '550e8400-e29b-41d4-a716-446655440001',
        entryType: 'preference',
        title: 'Test preference',
        content: 'I prefer chocolate ice cream',
        tags: ['food', 'preference'],
        category: 'personal',
      });

      const updateResult = await memoryService.memoryUpdate(updateInput);

      // Then load it
      const loadInput = MemoryLoadInputSchema.parse({
        id: updateResult.id,
      });

      const loadResult = await memoryService.memoryLoad(loadInput);

      expect(loadResult).toHaveProperty('items');
      expect(loadResult.items.length).toBeGreaterThan(0);
      expect(loadResult.items[0].title).toBe('Test preference');
    });

    it('should return error for invalid tool arguments', () => {
      expect(() => {
        MemoryUpdateInputV2Schema.parse({ title: '' }); // content is required
      }).toThrow();
    });

    it('should validate memory_load input schema', () => {
      const validInput = MemoryLoadInputSchema.parse({
        sessionId: '550e8400-e29b-41d4-a716-446655440002',
        limit: 10,
        scope: 'stm',
      });

      expect(validInput.sessionId).toBe('550e8400-e29b-41d4-a716-446655440002');
      expect(validInput.limit).toBe(10);
      expect(validInput.scope).toBe('stm');
    });
  });
});
