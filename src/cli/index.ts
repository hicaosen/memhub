#!/usr/bin/env node
/**
 * MemHub CLI entry point
 * - No args: start MCP server
 * - With args: run CLI commands
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as p from '@clack/prompts';
import { AGENTS, type AgentType } from './types.js';
import { initAgent, selectAgentInteractive } from './init.js';
import { createMcpServer, resolveStoragePath } from '../server/mcp-server.js';
import {
  DaemonAlreadyRunningError,
  DaemonController,
  DaemonNotRunningError,
  getDaemonLogDir,
} from '../server/daemon.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { installStdioLifecycleGuard } from '../server/stdio-lifecycle.js';
import {
  MODELS,
  formatBytes,
  TOTAL_DOWNLOAD_SIZE,
  getDownloadStatus,
  downloadAllModels,
  isModelDownloaded,
  type DownloadProgress,
} from '../services/model-manager/index.js';
import type { RerankerMode } from '../services/retrieval/reranker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface PackageJson {
  version?: string;
}

// Get package version
let packageJsonPath = join(__dirname, '../../../package.json');
if (!existsSync(packageJsonPath)) {
  packageJsonPath = join(__dirname, '../../package.json');
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageJson;
const VERSION = packageJson.version || '0.0.0';

/**
 * Start MCP server (no args mode)
 */
async function startMcpServer(): Promise<void> {
  const stopLifecycleGuard = installStdioLifecycleGuard();
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  try {
    await server.connect(transport);
    console.error('MemHub MCP Server running on stdio');
  } catch (error) {
    stopLifecycleGuard();
    throw error;
  }
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`
MemHub CLI v${VERSION} - Git-friendly memory for AI agents

Usage:
  memhub                       Start MCP server (default)
  memhub daemon                Start daemon in background
  memhub daemon start          Start daemon in background
  memhub daemon run            Run daemon in foreground
  memhub daemon status         Show daemon status
  memhub daemon stop           Stop daemon
  memhub daemon restart        Restart daemon in background
  memhub daemon logs           Show daemon log directory
  memhub install [options]     Download models and configure agent
  memhub --help                Show this help message
  memhub --version             Show version

Options:
  -a, --agent <agent>          Agent type (skip interactive selection)
  -f, --force                  Update existing configuration
  -l, --local                  Configure for current project (default: global)
  --skip-models                Skip model download (use existing models)

Supported agents:
${AGENTS.map(a => `  ${a.id.padEnd(15)} ${a.name}`).join('\n')}

Examples:
  memhub                               # Start MCP server
  memhub daemon                        # Start background daemon
  memhub daemon run                    # Run foreground daemon
  memhub install                       # Download models + interactive selection
  memhub install --local               # Download models + project config
  memhub install --agent cursor        # Download models + configure for Cursor
  memhub install --skip-models -a claude-code  # Skip download, configure agent
`);
}

function printVersion(): void {
  // eslint-disable-next-line no-console
  console.log(`MemHub CLI v${VERSION}`);
}

function parseAgent(value: string): AgentType | null {
  const validAgents = AGENTS.map(a => a.id);
  if (validAgents.includes(value as AgentType)) {
    return value as AgentType;
  }
  console.error(`Invalid agent: ${value}`);
  console.error(`Valid agents: ${validAgents.join(', ')}`);
  return null;
}

function resolveRerankerMode(raw?: string): RerankerMode {
  if (raw === 'model' || raw === 'lightweight' || raw === 'auto') {
    return raw;
  }
  return 'auto';
}

function createDaemonController(): DaemonController {
  return new DaemonController({
    storagePath: resolveStoragePath(),
    vectorSearch: process.env.MEMHUB_VECTOR_SEARCH !== 'false',
    rerankerMode: resolveRerankerMode(process.env.MEMHUB_RERANKER_MODE),
    rerankerModelName: process.env.MEMHUB_RERANKER_MODEL,
  });
}

function printDaemonStatus(status: Awaited<ReturnType<DaemonController['status']>>): void {
  if (status.endpoint) {
    // eslint-disable-next-line no-console
    console.log(`MemHub daemon is running`);
    // eslint-disable-next-line no-console
    console.log(`  pid: ${status.endpoint.pid}`);
    // eslint-disable-next-line no-console
    console.log(`  endpoint: ${status.endpoint.host}:${status.endpoint.port}`);
    // eslint-disable-next-line no-console
    console.log(`  protocol: ${status.endpoint.protocolVersion}`);
  } else {
    // eslint-disable-next-line no-console
    console.log('MemHub daemon is not running');
  }
  // eslint-disable-next-line no-console
  console.log(`  lock: ${status.lockPath}`);
  // eslint-disable-next-line no-console
  console.log(`  endpoint file: ${status.endpointPath}`);
}

function printDaemonLogs(): void {
  const logDir = getDaemonLogDir();
  // eslint-disable-next-line no-console
  console.log(`MemHub daemon logs: ${logDir}`);
  if (!existsSync(logDir)) return;

  const names = readdirSync(logDir)
    .filter(name => name.startsWith('daemon-') || name.startsWith('error-'))
    .sort()
    .slice(-5);

  for (const name of names) {
    // eslint-disable-next-line no-console
    console.log(`  ${name}`);
  }
}

async function runDaemonCommand(args: string[]): Promise<void> {
  const subcommand = args[1] ?? 'start';
  const controller = createDaemonController();
  const cliEntryPath = process.argv[1] ?? __filename;

  try {
    switch (subcommand) {
      case 'start': {
        const result = await controller.startBackground(cliEntryPath);
        const action = result.started ? 'started' : 'already running';
        // eslint-disable-next-line no-console
        console.log(`MemHub daemon ${action} (pid=${result.endpoint.pid})`);
        break;
      }
      case 'run': {
        const endpoint = await controller.startForeground();
        // eslint-disable-next-line no-console
        console.log(`MemHub daemon running in foreground (pid=${endpoint.pid})`);
        break;
      }
      case 'status': {
        printDaemonStatus(await controller.status());
        break;
      }
      case 'stop': {
        await controller.stop();
        // eslint-disable-next-line no-console
        console.log('MemHub daemon stopped');
        break;
      }
      case 'restart': {
        const result = await controller.restart(cliEntryPath);
        // eslint-disable-next-line no-console
        console.log(`MemHub daemon restarted (pid=${result.endpoint.pid})`);
        break;
      }
      case 'logs': {
        printDaemonLogs();
        break;
      }
      default:
        p.log.error(`Unknown daemon command: ${subcommand}`);
        p.log.info('Run "memhub --help" for usage information.');
        process.exit(1);
    }
  } catch (error) {
    if (error instanceof DaemonAlreadyRunningError) {
      p.log.error(error.message);
      process.exit(1);
    }
    if (error instanceof DaemonNotRunningError) {
      p.log.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

async function runCli(args: string[]): Promise<void> {
  // Parse command
  const command = args[0];

  if (command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  if (command === '--version' || command === '-v') {
    printVersion();
    process.exit(0);
  }

  if (command === 'daemon') {
    await runDaemonCommand(args);
    return;
  }

  if (command !== 'install') {
    p.log.error(`Unknown command: ${command}`);
    p.log.info('Run "memhub --help" for usage information.');
    process.exit(1);
  }

  // Parse install options
  let agent: AgentType | undefined;
  let force = false;
  let local = false;
  let skipModels = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-a' || arg === '--agent') {
      const value = args[++i];
      if (!value) {
        p.log.error('--agent requires a value');
        process.exit(1);
      }
      const parsed = parseAgent(value);
      if (!parsed) {
        process.exit(1);
      }
      agent = parsed;
    } else if (arg === '-f' || arg === '--force') {
      force = true;
    } else if (arg === '-l' || arg === '--local') {
      local = true;
    } else if (arg === '--skip-models') {
      skipModels = true;
    } else {
      p.log.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }

  // Start interactive session
  p.intro(`MemHub v${VERSION}`);

  // Step 1: Check and download models
  if (!skipModels) {
    const status = await getDownloadStatus();

    if (status.missing === 0) {
      p.log.success('All models already downloaded');
    } else {
      // Show download summary
      p.log.info(
        `MemHub needs to download ${status.missing} model(s) (~${formatBytes(TOTAL_DOWNLOAD_SIZE - status.downloadedSize)}):`
      );
      for (const model of MODELS) {
        const downloaded = isModelDownloaded(model);
        const modelStatus = downloaded ? '✓' : '○';
        p.log.info(
          `  ${modelStatus} ${model.kind}: ${model.name} (~${formatBytes(model.sizeBytes)})`
        );
      }

      // Confirm download
      const shouldDownload = await p.confirm({
        message: 'Download models now?',
        initialValue: true,
      });

      if (p.isCancel(shouldDownload) || !shouldDownload) {
        p.cancel('Operation cancelled.');
        process.exit(0);
      }

      // Download models with progress
      const downloadSpinner = p.spinner();
      let currentModel = '';

      const result = await downloadAllModels((progress: DownloadProgress) => {
        if (progress.model.name !== currentModel) {
          if (currentModel) {
            downloadSpinner.stop(`✓ ${currentModel}`);
          }
          currentModel = progress.model.name;

          if (progress.status === 'skipped') {
            downloadSpinner.start(`✓ ${currentModel} (already downloaded)`);
          } else if (progress.status === 'resuming') {
            downloadSpinner.start(`↻ ${currentModel} (resuming from ${progress.percentage}%)`);
          } else {
            downloadSpinner.start(`↓ ${currentModel}... ${progress.percentage}%`);
          }
        } else if (progress.status === 'downloading') {
          downloadSpinner.message(`↓ ${currentModel}... ${progress.percentage}%`);
        }
      });

      // Stop the last spinner
      if (currentModel) {
        downloadSpinner.stop(`✓ ${currentModel}`);
      }

      if (!result.success) {
        for (const error of result.errors) {
          p.log.error(error);
        }
        process.exit(1);
      }

      p.log.success('All models downloaded');
    }
  } else {
    p.log.info('Skipping model download');
  }

  // Step 2: Configure agent
  // If no agent specified, run interactive selection
  if (!agent) {
    const selectedAgent = await selectAgentInteractive();
    if (!selectedAgent) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }
    agent = selectedAgent;
  }

  // Run init with spinner
  const s = p.spinner();
  s.start(`Configuring MemHub for ${agent}...`);

  const result = initAgent({
    agent,
    force,
    local,
  });

  if (result.success) {
    s.stop(`Configured for ${result.agent.name}`);
    p.log.success(`MCP config: ${result.configPath}`);

    if (result.instructionsUpdated) {
      p.log.success(`Instructions: ${result.instructionsPath} (${result.instructionsReason})`);
    } else {
      p.log.info(`Instructions: ${result.instructionsPath} (${result.instructionsReason})`);
    }

    p.outro(`Restart your agent to start using MemHub.`);
  } else {
    s.stop('Configuration failed');
    p.log.error(result.error);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // No args: start MCP server
  if (args.length === 0) {
    await startMcpServer();
    return;
  }

  // With args: run CLI
  await runCli(args);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
