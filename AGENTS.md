# AGENTS.md - MemHub Project Guide

## Project Overview

MemHub is a Git-friendly memory MCP server for coding agents. It stores decisions, preferences, and reusable knowledge as plain Markdown files with YAML front matter.

**Tech Stack**: TypeScript (ES2022), Node.js 18+, MCP SDK, Zod, LanceDB, Transformers.js

## Dev Environment

```bash
# Install dependencies
npx pnpm install

# Build
npx pnpm run build

# Quality gate (lint + typecheck + test + coverage)
npx pnpm run quality
```

## Key Commands

| Command | Description |
|---------|-------------|
| `npx pnpm run build` | Compile TypeScript |
| `npx pnpm run lint` | ESLint check |
| `npx pnpm run lint:fix` | Auto-fix lint issues |
| `npx pnpm run format` | Format code with Prettier |
| `npx pnpm run format:check` | Check code formatting |
| `npx pnpm run typecheck` | TypeScript type check |
| `npx pnpm run test` | Run Vitest tests |
| `npx pnpm run test:watch` | Watch mode tests |
| `npx pnpm run test:coverage` | Tests with coverage |
| `npx pnpm run quality` | Full quality gate |
| `npx pnpm vitest run -t "test name"` | Run specific test |

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
- Run `npx pnpm run quality` before committing

## Documentation Guidelines

文档是代码契约的一部分，必须与实现保持同步。

### 何时更新文档

**必须更新文档的场景：**

1. **接口变更** — 新增、修改、删除 MCP 工具参数或返回值
2. **类型定义变更** — 修改 `src/contracts/types.ts` 中的类型
3. **Schema 变更** — 修改 `src/contracts/schemas.ts` 中的 Zod schema
4. **行为变更** — 工具的调用逻辑、错误处理、默认值发生变化
5. **版本发布** — package.json 版本号变更时，同步更新 README 中的版本引用

**文档与代码的对应关系：**

| 代码文件 | 对应文档 |
|---------|---------|
| `src/contracts/types.ts` | `docs/contracts.md`、`docs/architecture.md` |
| `src/contracts/schemas.ts` | `docs/contracts.md` |
| `src/contracts/mcp.ts` | `docs/contracts.md`、`docs/tool-calling-policy.md` |
| `package.json` (version) | `README.md` (Roadmap) |

### 文档更新流程

1. 修改代码后，检查相关文档是否需要同步
2. 对照代码实现校对文档描述
3. 移除文档中不存在于代码的参数/字段
4. 补充文档中缺失的新增参数/字段
5. 确保示例代码与实际类型定义一致

### 验证方法

```bash
# 对比代码中的类型定义与文档描述
grep -A 20 "interface MemoryLoadInput" src/contracts/types.ts
grep -A 20 "MemoryLoadInput" docs/contracts.md
```

## Git Workflow

- Commit message format: `type: description` (feat/fix/docs/chore/refactor/test)
- Always run quality gate before committing
- PR title format: `[scope] Description`

## Dos and Don'ts

### Do
- Run `npx pnpm run quality` before committing
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
