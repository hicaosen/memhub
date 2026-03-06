/**
 * FrontMatter Parser - Handles YAML Front Matter and Markdown content
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Memory, MemoryFrontMatter } from '../contracts/types.js';
import { slugify } from '../utils/slugify.js';

/**
 * Result of parsing a markdown file
 */
export interface ParseResult {
  frontMatter: MemoryFrontMatter;
  title: string;
  content: string;
}

/**
 * Custom error for front matter parsing
 */
export class FrontMatterError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'FrontMatterError';
  }
}

/**
 * Parses a markdown file with YAML front matter
 *
 * Expected format:
 * ---
 * id: "uuid"
 * created_at: "ISO8601"
 * updated_at: "ISO8601"
 * importance: 3
 * ---
 *
 * # Title
 *
 * Content...
 *
 * @param markdown - The markdown content to parse
 * @returns Parsed front matter, title, and content
 * @throws FrontMatterError if parsing fails
 */
export function parseFrontMatter(markdown: string): ParseResult {
  // Check for front matter delimiter
  if (!markdown.startsWith('---')) {
    throw new FrontMatterError('Missing front matter delimiter');
  }

  // Find the end of front matter
  const endMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!endMatch) {
    throw new FrontMatterError('Invalid front matter format');
  }

  const frontMatterYaml = endMatch[1];
  const restOfContent = markdown.slice(endMatch[0].length);

  // Parse YAML front matter
  let frontMatter: unknown;
  try {
    frontMatter = parseYaml(frontMatterYaml);
  } catch (error) {
    throw new FrontMatterError('Invalid YAML in front matter', error);
  }

  // Validate required fields
  if (!isValidFrontMatter(frontMatter)) {
    throw new FrontMatterError('Missing required fields in front matter');
  }

  // Parse title and content from markdown body
  const { title, content } = parseMarkdownBody(restOfContent);

  return {
    frontMatter,
    title,
    content,
  };
}

/**
 * Converts front matter and content to markdown string
 *
 * @param frontMatter - The front matter data
 * @param title - The title (H1 heading)
 * @param content - The markdown content
 * @returns Complete markdown string
 */
export function stringifyFrontMatter(
  frontMatter: MemoryFrontMatter,
  title: string,
  content: string
): string {
  // Convert camelCase to snake_case for YAML
  const yamlData = {
    id: frontMatter.id,
    created_at: frontMatter.created_at,
    updated_at: frontMatter.updated_at,
    ...(frontMatter.expires_at ? { expires_at: frontMatter.expires_at } : {}),
    ...(frontMatter.session_id ? { session_id: frontMatter.session_id } : {}),
    ...(frontMatter.entry_type ? { entry_type: frontMatter.entry_type } : {}),
    ...(frontMatter.ttl ? { ttl: frontMatter.ttl } : {}),
    importance: frontMatter.importance,
  };

  // Stringify YAML with specific options for consistent formatting
  const yamlString = stringifyYaml(yamlData, {
    indent: 2,
    defaultKeyType: 'PLAIN',
    defaultStringType: 'QUOTE_DOUBLE',
  });

  // Build the complete markdown
  const parts: string[] = ['---', yamlString.trim(), '---', ''];

  // Add title if provided
  if (title) {
    parts.push(`# ${title}`, '');
  }

  // Add content if provided
  if (content) {
    parts.push(content);
  }

  // Ensure content ends with a single newline
  let result = parts.join('\n');
  if (!result.endsWith('\n')) {
    result += '\n';
  }

  return result;
}

/**
 * Parses the markdown body to extract title and content
 *
 * @param body - The markdown body (after front matter)
 * @returns Title and content
 */
function parseMarkdownBody(body: string): { title: string; content: string } {
  const trimmed = body.trim();

  if (!trimmed) {
    return { title: '', content: '' };
  }

  // Try to extract H1 title
  const h1Match = trimmed.match(/^#\s+(.+)$/m);
  if (h1Match) {
    const title = h1Match[1].trim();
    // Remove the H1 line from content
    const content = trimmed.replace(/^#\s+.+$/m, '').trim();
    return { title, content };
  }

  // No H1 found, treat entire body as content
  return { title: '', content: trimmed };
}

/**
 * Type guard to validate front matter structure
 *
 * @param value - The value to check
 * @returns True if valid front matter
 */
function isValidFrontMatter(value: unknown): value is MemoryFrontMatter {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const fm = value as Record<string, unknown>;

  // Check required fields
  if (typeof fm.id !== 'string') return false;
  if (typeof fm.created_at !== 'string') return false;
  if (typeof fm.updated_at !== 'string') return false;
  if (fm.session_id !== undefined && typeof fm.session_id !== 'string') return false;
  if (fm.entry_type !== undefined && typeof fm.entry_type !== 'string') return false;
  if (typeof fm.importance !== 'number') return false;

  return true;
}

/**
 * Converts a Memory object to front matter format
 *
 * @param memory - The memory object
 * @returns Memory in front matter format
 */
export function memoryToFrontMatter(memory: Memory): MemoryFrontMatter {
  return {
    id: memory.id,
    created_at: memory.createdAt,
    updated_at: memory.updatedAt,
    expires_at: memory.expiresAt,
    session_id: memory.sessionId,
    entry_type: memory.entryType,
    ttl: memory.ttl,
    importance: memory.importance,
  };
}

/**
 * Converts front matter format to Memory object
 *
 * @param frontMatter - The front matter data
 * @param title - The memory title
 * @param content - The memory content
 * @returns Complete Memory object
 */
export function frontMatterToMemory(
  frontMatter: MemoryFrontMatter,
  title: string,
  content: string
): Memory {
  return {
    id: frontMatter.id,
    createdAt: frontMatter.created_at,
    updatedAt: frontMatter.updated_at,
    expiresAt: frontMatter.expires_at,
    sessionId: frontMatter.session_id,
    entryType: frontMatter.entry_type,
    ttl: frontMatter.ttl,
    importance: frontMatter.importance,
    title,
    content,
  };
}

// Re-export slugify for convenience
export { slugify };
