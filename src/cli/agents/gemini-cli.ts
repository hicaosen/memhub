/**
 * Gemini CLI MCP configuration generator
 */

export function generateGeminiCliConfig(_memhubPath: string): Record<string, unknown> {
  return {
    mcpServers: {
      memhub: {
        command: 'npx',
        args: ['-y', 'memhub@latest'],
      },
    },
  };
}
