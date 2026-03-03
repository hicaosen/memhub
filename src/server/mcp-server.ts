#!/usr/bin/env node
/**
 * MCP Server - Model Context Protocol server implementation
 * Uses @modelcontextprotocol/sdk for protocol handling
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { MemoryService, ServiceError } from '../services/memory-service.js';
import {
  MemoryLoadInputSchema,
  MemoryUpdateInputV2Schema,
} from '../contracts/schemas.js';
import { TOOL_DEFINITIONS, SERVER_INFO } from '../contracts/mcp.js';
import { ErrorCode } from '../contracts/types.js';

// Get package version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
interface PackageJson {
  version?: string;
}

// npm package runtime: dist/src/server -> package root
// test runtime: src/server -> package root
let packageJsonPath = join(__dirname, '../../../package.json');
if (!existsSync(packageJsonPath)) {
  // Fallback for test environment (running from src/)
  packageJsonPath = join(__dirname, '../../package.json');
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageJson;

/**
 * Create McpServer instance using SDK
 */
export function createMcpServer(): Server {
  const storagePath = process.env.MEMHUB_STORAGE_PATH || './memories';
  const vectorSearch = process.env.MEMHUB_VECTOR_SEARCH !== 'false';
  const memoryService = new MemoryService({ storagePath, vectorSearch });

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
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: unknown;

      switch (name) {
        case 'memory_load': {
          const input = MemoryLoadInputSchema.parse(args ?? {});
          result = await memoryService.memoryLoad(input);
          break;
        }

        case 'memory_update': {
          const input = MemoryUpdateInputV2Schema.parse(args ?? {});
          result = await memoryService.memoryUpdate(input);
          break;
        }

        default:
          throw new ServiceError(
            `Unknown tool: ${name}`,
            ErrorCode.METHOD_NOT_FOUND
          );
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

/**
 * Start the MCP server
 */
async function main(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error('MemHub MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// Check if this file is being run directly
const isMain = import.meta.url === `file://${process.argv[1]}` || false;
if (isMain) {
  // Defer main() execution to avoid blocking module loading
  setImmediate(() => {
    main().catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
  });
}