/**
 * Agent configuration generators index
 */

export { generateCursorConfig } from './cursor.js';
export { generateClaudeCodeConfig } from './claude-code.js';
export { generateClineConfig } from './cline.js';
export { generateWindsurfConfig } from './windsurf.js';
export { generateFactoryDroidConfig } from './factory-droid.js';
export { generateGeminiCliConfig } from './gemini-cli.js';
export { generateCodexConfig } from './codex.js';

import type { AgentType } from '../types.js';
import { generateCursorConfig } from './cursor.js';
import { generateClaudeCodeConfig } from './claude-code.js';
import { generateClineConfig } from './cline.js';
import { generateWindsurfConfig } from './windsurf.js';
import { generateFactoryDroidConfig } from './factory-droid.js';
import { generateGeminiCliConfig } from './gemini-cli.js';
import { generateCodexConfig } from './codex.js';

export type ConfigGenerator = (memhubPath: string) => Record<string, unknown>;

const generators: Record<AgentType, ConfigGenerator> = {
  cursor: generateCursorConfig,
  'claude-code': generateClaudeCodeConfig,
  cline: generateClineConfig,
  windsurf: generateWindsurfConfig,
  'factory-droid': generateFactoryDroidConfig,
  'gemini-cli': generateGeminiCliConfig,
  codex: generateCodexConfig,
};

export function getConfigGenerator(agentId: AgentType): ConfigGenerator {
  return generators[agentId];
}
