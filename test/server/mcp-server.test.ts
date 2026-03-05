/**
 * MCP Server Tests
 * Tests for the MCP Server using @modelcontextprotocol/sdk
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join, resolve } from 'path';
import {
  buildStartupReport,
  createMcpServer,
  formatStartupBanner,
  resolveStoragePath,
} from '../../src/server/mcp-server.js';
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
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    delete process.env.MEMHUB_STORAGE_PATH;
    delete process.env.MEMHUB_VECTOR_SEARCH;
    delete process.env.MEMHUB_RERANKER_MODE;
    delete process.env.MEMHUB_RERANKER_MODEL;
    delete process.env.MEMHUB_LOG_LEVEL;
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
        query: 'test query',
        limit: 10,
        intents: {
          primary: 'semantic',
          fallbacks: ['keyword', 'hybrid'],
        },
      });

      expect(validInput.query).toBe('test query');
      expect(validInput.limit).toBe(10);
      expect(validInput.intents?.primary).toBe('semantic');
    });
  });

  describe('resolveStoragePath', () => {
    const originalEnv = process.env.MEMHUB_STORAGE_PATH;
    const originalCwd = process.cwd.bind(process);

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.MEMHUB_STORAGE_PATH;
      } else {
        process.env.MEMHUB_STORAGE_PATH = originalEnv;
      }
      process.cwd = originalCwd;
    });

    it('should return ~/.memhub by default', () => {
      delete process.env.MEMHUB_STORAGE_PATH;
      const expectedPath = join(homedir(), '.memhub');
      expect(resolveStoragePath()).toBe(expectedPath);
    });

    it('should use absolute path from MEMHUB_STORAGE_PATH', () => {
      const absolutePath = process.platform === 'win32' ? 'C:\\custom\\path' : '/custom/path';
      process.env.MEMHUB_STORAGE_PATH = absolutePath;
      expect(resolveStoragePath()).toBe(absolutePath);
    });

    it('should resolve relative path from cwd', () => {
      const cwd = process.platform === 'win32' ? 'C:\\project' : '/project';
      process.cwd = () => cwd;
      process.env.MEMHUB_STORAGE_PATH = '.memhub';
      expect(resolveStoragePath()).toBe(resolve(cwd, '.memhub'));
    });

    it('should resolve .memhub relative path', () => {
      const cwd = process.platform === 'win32' ? 'C:\\myproject' : '/myproject';
      process.cwd = () => cwd;
      process.env.MEMHUB_STORAGE_PATH = '.memhub';
      const expected =
        process.platform === 'win32' ? 'C:\\myproject\\.memhub' : '/myproject/.memhub';
      expect(resolveStoragePath()).toBe(expected);
    });
  });

  describe('startup logging', () => {
    it('should build startup report with effective config', () => {
      process.env.MEMHUB_RERANKER_MODE = 'model';
      process.env.MEMHUB_RERANKER_MODEL = 'BAAI/bge-reranker-v2-m3';
      process.env.MEMHUB_LOG_LEVEL = 'debug';

      const report = buildStartupReport();
      expect(report.serverName).toBe('memhub');
      expect(report.storagePath).toBe(tempDir);
      expect(report.vectorSearchEnabled).toBe(false);
      expect(report.rerankerMode).toBe('model');
      expect(report.logLevel).toBe('debug');
      expect(report.tools).toContain('memory_load');
      expect(report.tools).toContain('memory_update');
    });

    it('should format startup banner', () => {
      const banner = formatStartupBanner({
        serverName: 'memhub',
        serverVersion: '0.0.1',
        pid: 123,
        nodeVersion: 'v22.0.0',
        platform: 'win32/x64',
        storagePath: 'C:\\memhub',
        storageExists: true,
        vectorSearchEnabled: true,
        rerankerMode: 'auto',
        rerankerModel: 'BAAI/bge-reranker-v2-m3',
        logLevel: 'info',
        protocolVersion: MCP_PROTOCOL_VERSION,
        tools: ['memory_load', 'memory_update'],
      });

      expect(banner).toContain('[MemHub] Startup');
      expect(banner).toContain('reranker=auto');
      expect(banner).toContain('memory_load, memory_update');
    });
  });
});
