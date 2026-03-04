/**
 * Codex MCP configuration generator
 */

export function generateCodexConfig(_memhubPath: string): Record<string, unknown> {
  return {
    mcp_servers: {
      memhub: {
        command: 'npx',
        args: ['-y', '@synth-coder/memhub@latest'],
      },
    },
  };
}
