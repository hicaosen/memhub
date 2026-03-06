/**
 * CLI types and constants
 */

export type AgentType =
  | 'cursor'
  | 'claude-code'
  | 'cline'
  | 'windsurf'
  | 'factory-droid'
  | 'gemini-cli'
  | 'codex';

export interface AgentConfig {
  readonly id: AgentType;
  readonly name: string;
  readonly description: string;
  /** Local config file path (relative to project root) */
  readonly configFile: string;
  /** Global config file path (relative to home directory) */
  readonly globalConfigFile: string;
  readonly configFormat: 'json' | 'markdown' | 'toml';
  /** Local instructions file path */
  readonly instructionsFile: string;
  /** Global instructions file path (relative to home directory) */
  readonly globalInstructionsFile: string;
  readonly instructionsFormat: 'markdown' | 'plain';
}

export const AGENTS: readonly AgentConfig[] = [
  {
    id: 'cursor',
    name: 'Cursor',
    description: 'AI code editor with MCP support',
    configFile: '.cursor/mcp.json',
    globalConfigFile: '.cursor/mcp.json',
    configFormat: 'json',
    instructionsFile: '.cursorrules',
    globalInstructionsFile: '.cursorrules',
    instructionsFormat: 'plain',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Anthropic CLI for Claude',
    configFile: '.mcp.json',
    globalConfigFile: '.claude.json',
    configFormat: 'json',
    instructionsFile: 'CLAUDE.md',
    globalInstructionsFile: '.claude/CLAUDE.md',
    instructionsFormat: 'markdown',
  },
  {
    id: 'cline',
    name: 'Cline',
    description: 'VS Code extension for AI coding',
    configFile: '.cline/mcp.json',
    globalConfigFile: '.cline/mcp.json',
    configFormat: 'json',
    instructionsFile: '.clinerules',
    globalInstructionsFile: '.clinerules',
    instructionsFormat: 'plain',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    description: 'Codeium AI editor',
    configFile: '.codeium/windsurf/mcp_config.json',
    globalConfigFile: '.codeium/windsurf/mcp_config.json',
    configFormat: 'json',
    instructionsFile: '.windsurfrules',
    globalInstructionsFile: '.windsurfrules',
    instructionsFormat: 'plain',
  },
  {
    id: 'factory-droid',
    name: 'Factory Droid',
    description: 'Factory AI coding agent',
    configFile: '.factory/mcp.json',
    globalConfigFile: '.factory/mcp.json',
    configFormat: 'json',
    instructionsFile: '.factory/AGENTS.md',
    globalInstructionsFile: '.factory/AGENTS.md',
    instructionsFormat: 'markdown',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    description: 'Google Gemini command line tool',
    configFile: '.gemini/settings.json',
    globalConfigFile: '.gemini/settings.json',
    configFormat: 'json',
    instructionsFile: 'GEMINI.md',
    globalInstructionsFile: '.gemini/GEMINI.md',
    instructionsFormat: 'markdown',
  },
  {
    id: 'codex',
    name: 'Codex',
    description: 'OpenAI CLI coding agent',
    configFile: '.codex/config.toml',
    globalConfigFile: '.codex/config.toml',
    configFormat: 'toml',
    instructionsFile: 'AGENTS.md',
    globalInstructionsFile: '.codex/AGENTS.md',
    instructionsFormat: 'markdown',
  },
] as const;

export function getAgentById(id: AgentType): AgentConfig | undefined {
  return AGENTS.find(agent => agent.id === id);
}
