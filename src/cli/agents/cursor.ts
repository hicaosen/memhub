/**
 * Cursor MCP configuration generator
 */

export function generateCursorConfig(_memhubPath: string): Record<string, unknown> {
  return {
    mcpServers: {
      memhub: {
        command: 'npx',
        args: ['-y', '@synth-coder/memhub@latest'],
      },
    },
  };
}
