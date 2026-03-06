/**
 * MemHub instructions generator
 * Generates agent-specific instruction content with versioned markers
 */

import type { AgentConfig } from './types.js';

const MEMHUB_VERSION = '0.2.3';

const START_TAG = `<!-- MEMHUB:v${MEMHUB_VERSION}:START -->`;
const END_TAG = '<!-- MEMHUB:END -->';

/**
 * Extract MemHub version from content if present
 */
export function extractMemHubVersion(content: string): string | null {
  const match = content.match(/<!-- MEMHUB:v([\d.]+):START -->/);
  return match ? match[1] : null;
}

/**
 * Check if MemHub instructions exist and need update
 */
export function needsUpdate(content: string): boolean {
  const version = extractMemHubVersion(content);
  if (!version) return true;
  return version !== MEMHUB_VERSION;
}

/**
 * Generate MemHub instructions content
 */
export function generateInstructionsContent(agent: AgentConfig): string {
  const isMarkdown = agent.instructionsFormat === 'markdown';

  if (isMarkdown) {
    return `${START_TAG}
## MemHub - AI Memory System

MemHub is a Git-friendly memory system for storing decisions, preferences, and reusable knowledge.

### When to Call memory_load

**Proactively call** memory_load in these scenarios:

- Starting a new conversation or task
- User mentions "before", "remember", "last time" keywords
- Uncertain about user preferences or constraints
- Need project context (tech stack, conventions, architecture)

### When to Call memory_update

**Proactively store** memories in these scenarios:

- User explicitly expresses a preference ("I prefer functional components")
- User makes a decision with reasoning ("Using PostgreSQL because...")
- Discover important project context (tech stack, constraints, patterns)
- User corrects your assumptions ("Actually, we don't use Redux")

### Usage Principles

1. **Load on demand** - Call memory_load at task start to get context
2. **Store timely** - Call memory_update when learning valuable information
3. **Query precisely** - Use focused queries to retrieve relevant memories
4. **Describe concisely** - Be specific in content, helpful in title

### Memory Types

| entryType | Purpose |
|-----------|---------|
| preference | User preferences (coding style, framework choices) |
| decision | Architecture decisions, technology choices |
| context | Project context (team, processes, constraints) |
| fact | Learned facts, important notes |

${END_TAG}`;
  }

  // Plain text format (for .cursorrules, .clinerules, etc.)
  return `${START_TAG}
# MemHub - AI Memory System

MemHub is a Git-friendly memory system for storing decisions, preferences, and reusable knowledge.

## When to Call memory_load

- Starting a new conversation or task
- User mentions "before", "remember", "last time" keywords
- Uncertain about user preferences or constraints
- Need project context (tech stack, conventions, architecture)

## When to Call memory_update

- User explicitly expresses a preference
- User makes a decision with reasoning
- Discover important project context
- User corrects your assumptions

## Memory Types

- preference: User preferences
- decision: Architecture decisions
- context: Project context
- fact: Learned facts

## Principle

Will my future self benefit from knowing this? If yes, store it.

${END_TAG}`;
}

/**
 * Update instructions file content
 * - If no MemHub section: prepend new instructions
 * - If MemHub section exists and outdated: replace with new version
 * - If MemHub section exists and current: no change
 */
export function updateInstructionsContent(
  existingContent: string,
  agent: AgentConfig
): { content: string; updated: boolean; reason: string } {
  const trimmedContent = existingContent.trim();
  const hasMemHub = trimmedContent.includes('<!-- MEMHUB:');

  if (!hasMemHub) {
    // No MemHub section: prepend
    const newInstructions = generateInstructionsContent(agent);
    return {
      content: `${newInstructions}\n\n${trimmedContent}`,
      updated: true,
      reason: 'MemHub instructions added',
    };
  }

  const currentVersion = extractMemHubVersion(trimmedContent);
  if (currentVersion === MEMHUB_VERSION) {
    // Already up to date
    return {
      content: existingContent,
      updated: false,
      reason: 'Already up to date',
    };
  }

  // Need to update: replace old section with new
  const newInstructions = generateInstructionsContent(agent);
  const pattern = /<!-- MEMHUB:v[\d.]+:START -->[\s\S]*?<!-- MEMHUB:END -->/;
  const updatedContent = trimmedContent.replace(pattern, newInstructions);

  return {
    content: updatedContent,
    updated: true,
    reason: `Updated from v${currentVersion} to v${MEMHUB_VERSION}`,
  };
}
