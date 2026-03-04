#!/usr/bin/env node
/**
 * MCP Server - Model Context Protocol server implementation
 * Uses @modelcontextprotocol/sdk for protocol handling
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ServiceError } from '../services/memory-service.js';
import { MemoryLoadInputSchema, MemoryUpdateInputV2Schema } from '../contracts/schemas.js';
import { MCP_PROTOCOL_VERSION, TOOL_DEFINITIONS, SERVER_INFO } from '../contracts/mcp.js';
import { ErrorCode } from '../contracts/types.js';
import { SharedMemoryBackend, type MemoryBackend } from './shared-memory-backend.js';
import type { RerankerMode } from '../services/retrieval/reranker.js';

// Get package version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
interface PackageJson {
  version?: string;
}

type EffectiveRerankerMode = 'auto' | 'model' | 'lightweight';

export interface StartupReport {
  readonly serverName: string;
  readonly serverVersion: string;
  readonly pid: number;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly storagePath: string;
  readonly storageExists: boolean;
  readonly vectorSearchEnabled: boolean;
  readonly rerankerMode: EffectiveRerankerMode;
  readonly rerankerModel: string;
  readonly logLevel: string;
  readonly protocolVersion: string;
  readonly tools: readonly string[];
}

// npm package runtime: dist/src/server -> package root
// test runtime: src/server -> package root
let packageJsonPath = join(__dirname, '../../../package.json');
if (!existsSync(packageJsonPath)) {
  // Fallback for test environment (running from src/)
  packageJsonPath = join(__dirname, '../../package.json');
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageJson;

function resolveRerankerMode(raw?: string): EffectiveRerankerMode {
  if (raw === 'model' || raw === 'lightweight' || raw === 'auto') {
    return raw;
  }
  return 'auto';
}

/**
 * Resolve storage path with the following priority:
 * 1. MEMHUB_STORAGE_PATH env var (if set):
 *    - Absolute path: use as-is
 *    - Relative path starting with '.': resolve from current working directory
 * 2. Default: ~/.memhub (user home directory)
 */
export function resolveStoragePath(): string {
  const envPath = process.env.MEMHUB_STORAGE_PATH;

  if (envPath) {
    // If it's an absolute path, use as-is
    if (envPath.startsWith('/') || envPath.match(/^[A-Z]:\\/i)) {
      return envPath;
    }
    // Relative path: resolve from current working directory
    return resolve(process.cwd(), envPath);
  }

  // Default: ~/.memhub
  return join(homedir(), '.memhub');
}

/**
 * Create McpServer instance using SDK
 */
export function createMcpServer(): Server {
  const storagePath = resolveStoragePath();
  const vectorSearch = process.env.MEMHUB_VECTOR_SEARCH !== 'false';
  const rerankerMode = resolveRerankerMode(process.env.MEMHUB_RERANKER_MODE) as RerankerMode;
  const rerankerModelName = process.env.MEMHUB_RERANKER_MODEL;
  const memoryBackend: MemoryBackend = new SharedMemoryBackend({
    storagePath,
    vectorSearch,
    rerankerMode,
    rerankerModelName,
  });

  // Create server using SDK
  const server = new Server(
    {
      name: SERVER_INFO.name,
      version: packageJson.version || SERVER_INFO.version,
    },
    {
      capabilities: {
        tools: { listChanged: false },
        logging: {},
      },
    }
  );

  // Handle tools/list request
  server.setRequestHandler(ListToolsRequestSchema, () => {
    return { tools: TOOL_DEFINITIONS };
  });

  // Handle tools/call request
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params;

    try {
      let result: unknown;

      switch (name) {
        case 'memory_load': {
          const input = MemoryLoadInputSchema.parse(args ?? {});
          result = await memoryBackend.memoryLoad(input);
          break;
        }

        case 'memory_update': {
          const input = MemoryUpdateInputV2Schema.parse(args ?? {});
          result = await memoryBackend.memoryUpdate(input);
          break;
        }

        default:
          throw new ServiceError(`Unknown tool: ${name}`, ErrorCode.METHOD_NOT_FOUND);
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      if (error instanceof ServiceError) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: error.message }, null, 2),
            },
          ],
          isError: true,
        };
      }

      if (error instanceof Error && error.name === 'ZodError') {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: `Invalid parameters: ${error.message}` }, null, 2),
            },
          ],
          isError: true,
        };
      }

      // Re-throw for SDK error handling
      throw error;
    }
  });

  return server;
}

export function buildStartupReport(): StartupReport {
  const storagePath = resolveStoragePath();
  const vectorSearchEnabled = process.env.MEMHUB_VECTOR_SEARCH !== 'false';
  const rerankerMode = resolveRerankerMode(process.env.MEMHUB_RERANKER_MODE);
  const rerankerModel = process.env.MEMHUB_RERANKER_MODEL ?? 'BAAI/bge-reranker-v2-m3';

  return {
    serverName: SERVER_INFO.name,
    serverVersion: packageJson.version || SERVER_INFO.version,
    pid: process.pid,
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    storagePath,
    storageExists: existsSync(storagePath),
    vectorSearchEnabled,
    rerankerMode,
    rerankerModel,
    logLevel: process.env.MEMHUB_LOG_LEVEL ?? 'info',
    protocolVersion: MCP_PROTOCOL_VERSION,
    tools: TOOL_DEFINITIONS.map(tool => tool.name),
  };
}

export function formatStartupBanner(report: StartupReport): string {
  return [
    '[MemHub] Startup',
    `  server: ${report.serverName}@${report.serverVersion}`,
    `  pid/node: ${report.pid} / ${report.nodeVersion}`,
    `  platform: ${report.platform}`,
    `  protocol: ${report.protocolVersion}`,
    `  storage: ${report.storagePath} (exists=${report.storageExists})`,
    `  retrieval: vector=${report.vectorSearchEnabled}, reranker=${report.rerankerMode}, model=${report.rerankerModel}`,
    `  logLevel: ${report.logLevel}`,
    `  tools: ${report.tools.join(', ')}`,
  ].join('\n');
}

/**
 * Start the MCP server (only when run directly)
 */
async function main(): Promise<void> {
  const startupReport = buildStartupReport();
  console.error(formatStartupBanner(startupReport));

  const server = createMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error('[MemHub] Ready: MCP Server running on stdio');
}

// Only run main() when this file is executed directly
const isMain = import.meta.url === `file://${process.argv[1]}` || false;
if (isMain) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
