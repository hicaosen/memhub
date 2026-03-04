# AGENTS.md - MemHub Project Guide

## Project Overview

MemHub is a Git-friendly memory MCP server for coding agents. It stores decisions, preferences, and reusable knowledge as plain Markdown files with YAML front matter.

**Tech Stack**: TypeScript (ES2022), Node.js 18+, MCP SDK, Zod, LanceDB, Transformers.js

## Dev Environment

```bash
# Install dependencies
pnpm install

# Build
pnpm run build

# Quality gate (lint + typecheck + test + coverage)
pnpm run quality
```

## Key Commands

| Command | Description |
|---------|-------------|
| `pnpm run build` | Compile TypeScript |
| `pnpm run lint` | ESLint check |
| `pnpm run lint:fix` | Auto-fix lint issues |
| `pnpm run typecheck` | TypeScript type check |
| `pnpm run test` | Run Vitest tests |
| `pnpm run test:watch` | Watch mode tests |
| `pnpm run test:coverage` | Tests with coverage |
| `pnpm run quality` | Full quality gate |
| `pnpm vitest run -t "test name"` | Run specific test |

## Project Structure

```
src/
  contracts/    # Type definitions, Zod schemas, MCP contracts
  server/       # MCP stdio server entry point
  services/     # Business logic (MemoryService, EmbeddingService)
  storage/      # Storage layer (Markdown, VectorIndex)
  utils/        # Shared utilities (slugify, etc.)
test/           # Vitest unit tests mirroring src/ structure
docs/           # Documentation
```

## Coding Conventions

### TypeScript Style
- Use `readonly` for immutable fields in interfaces
- Use `type` for aliases, `interface` for object shapes
- Prefer `import type` for type-only imports
- Use ESM: `.js` extension in imports, `verbatimModuleSyntax`
- Explicit return types on exported functions
- Use Zod for runtime validation

### File Naming
- `kebab-case.ts` for all files
- Test files: `<module>.test.ts` or `<module>-edge.test.ts`

### Code Organization
- Contracts first: define types and schemas before implementation
- TDD workflow: red → green → refactor
- One export per file preferred; barrel exports in `index.ts`

### Example Code Style

```typescript
// Types with readonly fields
export interface Memory {
  readonly id: UUID;
  readonly tags: readonly string[];
}

// Service with explicit types
export class MemoryService {
  constructor(private readonly config: MemoryServiceConfig) {}

  async create(input: CreateMemoryInput): Promise<CreateResult> {
    // implementation
  }
}

// Zod schema for validation
export const MemorySchema = z.object({
  id: z.string().uuid(),
  tags: z.array(z.string()),
});
```

## Testing Guidelines

- Test coverage threshold: **>= 80%**
- Tests mirror `src/` structure in `test/` directory
- Use Vitest: `describe`, `it`, `expect` pattern
- Edge cases go in `*-edge.test.ts` files
- Run `pnpm run quality` before committing

## Git Workflow

- Commit message format: `type: description` (feat/fix/docs/chore/refactor/test)
- Always run quality gate before committing
- PR title format: `[scope] Description`

## Dos and Don'ts

### Do
- Run `pnpm run quality` before committing
- Add tests for new code
- Use `import type` for type-only imports
- Keep functions small and focused
- Update types and schemas together

### Don't
- Skip the quality gate
- Use `any` without justification
- Mutate function parameters
- Add code without corresponding tests
- Commit directly to main (use branches for features)

## MCP Tool Reference

MemHub exposes two primary tools:

1. **memory_load** - First-turn tool to load STM context
2. **memory_update** - Final-turn tool to write back decisions/knowledge

See `docs/tool-calling-policy.md` for detailed usage patterns.
