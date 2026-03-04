/**
 * Cline MCP configuration generator
 */

export function generateClineConfig(_memhubPath: string): Record<string, unknown> {
  return {
    mcpServers: {
      memhub: {
        command: 'npx',
        args: ['-y', '@synth-coder/memhub'],
      },
    },
  };
}
