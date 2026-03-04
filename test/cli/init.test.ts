/**
 * Tests for CLI init command
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { initAgent } from '../../src/cli/init.js';
import { AGENTS, type AgentType } from '../../src/cli/types.js';
import { parse as parseToml } from 'smol-toml';
import {
  extractMemHubVersion,
  needsUpdate,
  updateInstructionsContent,
} from '../../src/cli/instructions.js';

const TEST_DIR = join(process.cwd(), 'test-temp-cli');

describe('CLI Init Command', () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('initAgent', () => {
    it('should create local config and instructions for cursor', () => {
      const result = initAgent({
        agent: 'cursor',
        local: true,
        projectPath: TEST_DIR,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.agent.id).toBe('cursor');
        expect(result.configPath).toBe('.cursor/mcp.json');
        expect(result.instructionsPath).toBe('.cursorrules');
        expect(existsSync(join(TEST_DIR, '.cursor/mcp.json'))).toBe(true);
        expect(existsSync(join(TEST_DIR, '.cursorrules'))).toBe(true);
      }
    });

    it('should create local config and instructions for claude-code', () => {
      const result = initAgent({
        agent: 'claude-code',
        local: true,
        projectPath: TEST_DIR,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.agent.id).toBe('claude-code');
        expect(result.configPath).toBe('.mcp.json');
        expect(result.instructionsPath).toBe('CLAUDE.md');
      }
    });

    it('should create local config and instructions for cline', () => {
      const result = initAgent({
        agent: 'cline',
        local: true,
        projectPath: TEST_DIR,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.agent.id).toBe('cline');
        expect(result.configPath).toBe('.cline/mcp.json');
        expect(result.instructionsPath).toBe('.clinerules');
      }
    });

    it('should create local config and instructions for windsurf', () => {
      const result = initAgent({
        agent: 'windsurf',
        local: true,
        projectPath: TEST_DIR,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.agent.id).toBe('windsurf');
        expect(result.configPath).toBe('.codeium/windsurf/mcp_config.json');
        expect(result.instructionsPath).toBe('.windsurfrules');
      }
    });

    it('should create local config and instructions for factory-droid', () => {
      const result = initAgent({
        agent: 'factory-droid',
        local: true,
        projectPath: TEST_DIR,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.agent.id).toBe('factory-droid');
        expect(result.configPath).toBe('.factory/mcp.json');
        expect(result.instructionsPath).toBe('.factory/AGENTS.md');
      }
    });

    it('should create local config and instructions for gemini-cli', () => {
      const result = initAgent({
        agent: 'gemini-cli',
        local: true,
        projectPath: TEST_DIR,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.agent.id).toBe('gemini-cli');
        expect(result.configPath).toBe('.gemini/settings.json');
        expect(result.instructionsPath).toBe('GEMINI.md');
      }
    });

    it('should create local config and instructions for codex', () => {
      const result = initAgent({
        agent: 'codex',
        local: true,
        projectPath: TEST_DIR,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.agent.id).toBe('codex');
        expect(result.configPath).toBe('.codex/config.toml');
        expect(result.instructionsPath).toBe('AGENTS.md');
        expect(existsSync(join(TEST_DIR, '.codex/config.toml'))).toBe(true);
        expect(existsSync(join(TEST_DIR, 'AGENTS.md'))).toBe(true);
      }
    });

    it('should fail for unknown agent', () => {
      const result = initAgent({
        agent: 'unknown-agent' as AgentType,
        local: true,
        projectPath: TEST_DIR,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Unknown agent');
      }
    });

    it('should fail if memhub already configured without force', () => {
      // First init
      initAgent({
        agent: 'claude-code',
        local: true,
        projectPath: TEST_DIR,
      });

      // Second init without force
      const result = initAgent({
        agent: 'claude-code',
        local: true,
        projectPath: TEST_DIR,
        force: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('already configured');
      }
    });

    it('should update config with force', () => {
      // First init
      initAgent({
        agent: 'claude-code',
        local: true,
        projectPath: TEST_DIR,
      });

      // Second init with force
      const result = initAgent({
        agent: 'claude-code',
        local: true,
        projectPath: TEST_DIR,
        force: true,
      });

      expect(result.success).toBe(true);
    });

    it('should generate valid JSON config', () => {
      initAgent({
        agent: 'cursor',
        local: true,
        projectPath: TEST_DIR,
      });

      const configPath = join(TEST_DIR, '.cursor/mcp.json');
      const content = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);

      expect(config).toHaveProperty('mcpServers');
      expect(config.mcpServers).toHaveProperty('memhub');
      expect(config.mcpServers.memhub).toHaveProperty('command');
      expect(config.mcpServers.memhub.command).toBe('npx');
    });

    it('should generate valid TOML config for codex', () => {
      initAgent({
        agent: 'codex',
        local: true,
        projectPath: TEST_DIR,
      });

      const configPath = join(TEST_DIR, '.codex/config.toml');
      const content = readFileSync(configPath, 'utf-8');
      const config = parseToml(content) as Record<string, unknown>;
      const servers = config.mcp_servers as Record<string, unknown>;
      const memhub = servers.memhub as Record<string, unknown>;
      const args = memhub.args as string[];

      expect(config).toHaveProperty('mcp_servers');
      expect(servers).toHaveProperty('memhub');
      expect(memhub.command).toBe('npx');
      expect(args).toContain('@synth-coder/memhub@latest');
    });

    it('should generate instructions with version tag', () => {
      initAgent({
        agent: 'claude-code',
        local: true,
        projectPath: TEST_DIR,
      });

      const instructionsPath = join(TEST_DIR, 'CLAUDE.md');
      const content = readFileSync(instructionsPath, 'utf-8');

      expect(content).toContain('<!-- MEMHUB:v');
      expect(content).toContain('<!-- MEMHUB:END -->');
    });

    it('should merge with existing config preserving other servers', () => {
      // Create existing config with other servers
      const configDir = join(TEST_DIR, '.mcp.json');
      const existingConfig = {
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
          },
        },
      };
      writeFileSync(configDir, JSON.stringify(existingConfig, null, 2), 'utf-8');

      // Run init
      const result = initAgent({
        agent: 'claude-code',
        local: true,
        projectPath: TEST_DIR,
      });

      expect(result.success).toBe(true);

      // Verify both servers exist
      const content = readFileSync(configDir, 'utf-8');
      const config = JSON.parse(content);

      expect(config.mcpServers).toHaveProperty('github');
      expect(config.mcpServers).toHaveProperty('memhub');
    });

    it('should fail if memhub already in config without force', () => {
      // Create config with memhub already configured
      const configDir = join(TEST_DIR, '.mcp.json');
      const existingConfig = {
        mcpServers: {
          memhub: {
            command: 'npx',
            args: ['-y', '@synth-coder/memhub@latest'],
          },
        },
      };
      writeFileSync(configDir, JSON.stringify(existingConfig, null, 2), 'utf-8');

      // Run init without force
      const result = initAgent({
        agent: 'claude-code',
        local: true,
        projectPath: TEST_DIR,
        force: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('already configured');
      }
    });

    it('should update memhub with force preserving other servers', () => {
      // Create config with existing servers including memhub
      const configDir = join(TEST_DIR, '.mcp.json');
      const existingConfig = {
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
          },
          memhub: {
            command: 'old-command',
            args: [],
          },
        },
      };
      writeFileSync(configDir, JSON.stringify(existingConfig, null, 2), 'utf-8');

      // Run init with force
      const result = initAgent({
        agent: 'claude-code',
        local: true,
        projectPath: TEST_DIR,
        force: true,
      });

      expect(result.success).toBe(true);

      // Verify github preserved, memhub updated
      const content = readFileSync(configDir, 'utf-8');
      const config = JSON.parse(content);

      expect(config.mcpServers).toHaveProperty('github');
      expect(config.mcpServers).toHaveProperty('memhub');
      expect(config.mcpServers.memhub.command).toBe('npx');
    });

  });

  describe('Instructions Update', () => {
    it('should prepend instructions to empty file', () => {
      const result = updateInstructionsContent('', AGENTS[1]); // claude-code

      expect(result.updated).toBe(true);
      expect(result.content).toContain('<!-- MEMHUB:v');
    });

    it('should prepend instructions to existing content', () => {
      const existing = '# My Project\n\nSome instructions';
      const result = updateInstructionsContent(existing, AGENTS[1]);

      expect(result.updated).toBe(true);
      expect(result.content).toContain('<!-- MEMHUB:v');
      expect(result.content).toContain('# My Project');
    });

    it('should not update if already current version', () => {
      const content = '<!-- MEMHUB:v0.2.3:START -->\nContent\n<!-- MEMHUB:END -->';
      const result = updateInstructionsContent(content, AGENTS[1]);

      expect(result.updated).toBe(false);
      expect(result.reason).toBe('Already up to date');
    });

    it('should extract version correctly', () => {
      expect(extractMemHubVersion('<!-- MEMHUB:v0.2.3:START -->')).toBe('0.2.3');
      expect(extractMemHubVersion('No version here')).toBeNull();
    });

    it('should detect when update is needed', () => {
      expect(needsUpdate('No MemHub content')).toBe(true);
      expect(needsUpdate('<!-- MEMHUB:v0.1.0:START -->')).toBe(true);
    });
  });
});

describe('Agent Types', () => {
  it('should have all expected agents', () => {
    const agentIds = AGENTS.map(a => a.id);
    expect(agentIds).toContain('cursor');
    expect(agentIds).toContain('claude-code');
    expect(agentIds).toContain('cline');
    expect(agentIds).toContain('windsurf');
    expect(agentIds).toContain('factory-droid');
    expect(agentIds).toContain('gemini-cli');
    expect(agentIds).toContain('codex');
  });

  it('should have valid config for each agent', () => {
    AGENTS.forEach(agent => {
      expect(agent.configFile).toBeTruthy();
      expect(agent.globalConfigFile).toBeTruthy();
      expect(agent.name).toBeTruthy();
      expect(agent.configFormat).toMatch(/^(json|markdown|toml)$/);
      expect(agent.instructionsFile).toBeTruthy();
      expect(agent.globalInstructionsFile).toBeTruthy();
      expect(agent.instructionsFormat).toMatch(/^(markdown|plain)$/);
    });
  });
});
