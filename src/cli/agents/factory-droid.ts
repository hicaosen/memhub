/**
 * Factory Droid MCP configuration generator
 */

export function generateFactoryDroidConfig(_memhubPath: string): Record<string, unknown> {
  return {
    mcpServers: {
      memhub: {
        command: 'npx',
        args: ['-y', 'memhub@latest'],
      },
    },
  };
}
