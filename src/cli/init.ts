/**
 * Init command implementation
 * Generates MCP configuration for different AI agents
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { AGENTS, type AgentType, type AgentConfig, getAgentById } from './types.js';
import { getConfigGenerator } from './agents/index.js';
import { updateInstructionsContent } from './instructions.js';

export interface InitOptions {
  readonly agent: AgentType;
  /** @deprecated Use local instead */
  readonly projectPath?: string;
  readonly force?: boolean;
  readonly local?: boolean;
}

export interface InitResult {
  readonly success: true;
  readonly configPath: string;
  readonly instructionsPath: string;
  readonly instructionsUpdated: boolean;
  readonly instructionsReason: string;
  readonly agent: AgentConfig;
}

export interface InitError {
  readonly success: false;
  readonly error: string;
}

export type InitOutcome = InitResult | InitError;

/**
 * Parse config file content based on format
 */
function parseConfig(
  content: string,
  format: 'json' | 'markdown' | 'toml'
): Record<string, unknown> {
  if (format === 'toml') {
    const parsed = parseToml(content);
    if (!isRecord(parsed)) {
      throw new Error('TOML config root must be an object');
    }
    return parsed;
  }
  return JSON.parse(content) as Record<string, unknown>;
}

/**
 * Stringify config to string based on format
 */
function stringifyConfig(
  config: Record<string, unknown>,
  format: 'json' | 'markdown' | 'toml'
): string {
  if (format === 'toml') {
    return stringifyToml(config);
  }
  return JSON.stringify(config, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getTargetMcpKey(config: Record<string, unknown>): 'mcpServers' | 'mcp_servers' {
  return isRecord(config.mcp_servers) ? 'mcp_servers' : 'mcpServers';
}

async function getPrompts(): Promise<typeof import('@clack/prompts')> {
  return import('@clack/prompts');
}

/**
 * Merge memhub config into existing config
 * Preserves all existing servers, adds/updates memhub
 */
function mergeMcpConfig(
  existing: Record<string, unknown>,
  newConfig: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...existing };
  const targetKey = getTargetMcpKey(newConfig);
  const existingServers = isRecord(result[targetKey]) ? result[targetKey] : {};
  const newServers = (newConfig[targetKey] as Record<string, unknown>) ?? {};
  result[targetKey] = { ...existingServers, ...newServers };

  return result;
}

/**
 * Run interactive agent selection using clack
 */
export async function selectAgentInteractive(): Promise<AgentType | null> {
  const p = await getPrompts();
  const selection = await p.select({
    message: 'Select your AI agent',
    options: AGENTS.map(agent => ({
      value: agent.id,
      label: agent.name,
      hint: agent.description,
    })),
  });

  if (p.isCancel(selection)) {
    return null;
  }

  return selection;
}

/**
 * Generate and write MCP configuration for the specified agent
 */
export function initAgent(options: InitOptions): InitOutcome {
  const { agent, force = false, local = false, projectPath } = options;

  const agentConfig = getAgentById(agent);
  if (!agentConfig) {
    return {
      success: false,
      error: `Unknown agent: ${agent}. Valid agents: ${AGENTS.map(a => a.id).join(', ')}`,
    };
  }

  // Determine base path and file paths based on local flag
  const basePath = projectPath ?? (local ? process.cwd() : homedir());
  const configFile = local ? agentConfig.configFile : agentConfig.globalConfigFile;
  const instructionsFile = local
    ? agentConfig.instructionsFile
    : agentConfig.globalInstructionsFile;

  const configPath = join(basePath, configFile);
  const configDir = dirname(configPath);
  const instructionsPath = join(basePath, instructionsFile);
  const instructionsDir = dirname(instructionsPath);

  // Generate MCP configuration
  const generator = getConfigGenerator(agent);
  const newConfig = generator(basePath);

  let finalConfig: Record<string, unknown>;

  // Check if config already exists
  const configFormat = agentConfig.configFormat;
  if (existsSync(configPath)) {
    if (force) {
      // Force: still merge, but this updates memhub entry
      try {
        const existingContent = readFileSync(configPath, 'utf-8');
        const existingConfig = parseConfig(existingContent, configFormat);
        finalConfig = mergeMcpConfig(existingConfig, newConfig);
      } catch {
        // Invalid config, use new config
        finalConfig = newConfig;
      }
    } else {
      // No force: check if memhub already exists
      try {
        const existingContent = readFileSync(configPath, 'utf-8');
        const existingConfig = parseConfig(existingContent, configFormat);
        const targetKey = getTargetMcpKey(newConfig);
        const servers = existingConfig[targetKey] as Record<string, unknown> | undefined;

        if (servers && 'memhub' in servers) {
          return {
            success: false,
            error: `MemHub is already configured in ${configFile}. Use --force to update.`,
          };
        }

        // Merge with existing config
        finalConfig = mergeMcpConfig(existingConfig, newConfig);
      } catch {
        return {
          success: false,
          error: `Failed to parse existing config at ${configFile}. Use --force to overwrite.`,
        };
      }
    }
  } else {
    finalConfig = newConfig;
  }

  // Ensure directories exist
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  if (!existsSync(instructionsDir)) {
    mkdirSync(instructionsDir, { recursive: true });
  }

  // Write MCP configuration
  writeFileSync(configPath, stringifyConfig(finalConfig, configFormat), 'utf-8');

  // Handle instructions file
  let existingContent = '';
  if (existsSync(instructionsPath)) {
    existingContent = readFileSync(instructionsPath, 'utf-8');
  }

  const {
    content: updatedContent,
    updated: instructionsUpdated,
    reason: instructionsReason,
  } = updateInstructionsContent(existingContent, agentConfig);

  if (instructionsUpdated || !existsSync(instructionsPath)) {
    writeFileSync(instructionsPath, updatedContent, 'utf-8');
  }

  return {
    success: true,
    configPath: configFile,
    instructionsPath: instructionsFile,
    instructionsUpdated,
    instructionsReason,
    agent: agentConfig,
  };
}
