# MemHub

Git-friendly memory MCP server for coding agents.

---

## Quick Start

### Install from npm

```bash
npm i @synth-coder/memhub
```

### Run as MCP Server

```bash
npx -y @synth-coder/memhub
```

> On Windows, do **not** append `memhub` after the package name.

### Configure MCP Client

```json
{
  "mcpServers": {
    "memhub": {
      "command": "npx",
      "args": ["-y", "@synth-coder/memhub"],
      "env": {
        "MEMHUB_STORAGE_PATH": "/absolute/path/to/memories",
        "MEMHUB_LOG_LEVEL": "info"
      }
    }
  }
}
```

---

## Configure Your Agent

Add the following to your coding agent's system prompt to enable persistent memory:

```markdown
## Memory System

You have access to persistent memory across conversations. Use it wisely:

- **Remember preferences** — Learn what the user likes and avoid repeating mistakes
- **Recall decisions** — Build on past reasoning instead of starting from scratch
- **Store context** — Project knowledge that survives session boundaries

### When to Use

#### `memory_load`

Call when you need context from past conversations:
- User references something from before
- You're unsure about user preferences
- A decision needs historical context

Don't call for simple, self-contained tasks.

#### `memory_update`

Call when you discover something worth remembering:
- User expresses a preference
- You made a significant decision with reasoning
- Project context changed

Don't call for temporary or one-time information.

### Principle

Memory should feel natural — triggered by context, not by schedule. When in doubt, ask: "Would future me benefit from knowing this?"
```

---

## MCP Tools

- `memory_load`  
  First-turn tool. Load STM context for the current task/session.
- `memory_update`  
  Final-turn tool. Write back decisions, preferences, knowledge, and task-state updates.

Calling policy: see `docs/tool-calling-policy.md`.

---

## Why MemHub

- **Git-native**: all memory is plain text files
- **Agent-friendly**: exposed as MCP tools over stdio
- **Human-readable**: YAML metadata + Markdown body
- **Quality-gated**: lint + typecheck + tests + coverage gate

---

## Features

- Markdown-based memory storage (`.md`)
- YAML Front Matter metadata (`id`, `session_id`, `entry_type`, `tags`, `category`, `importance`, timestamps)
- STM-first 2-tool interface: `memory_load` + `memory_update`
- Concurrent CLI-safe storage layout: `YYYY-MM-DD/session_uuid/...`
- MCP stdio server compatible with MCP clients

---

## Environment Variables

- `MEMHUB_STORAGE_PATH` (default: `~/.memhub`)
- `MEMHUB_LOG_LEVEL` (default: `info`, options: `debug|info|warn|error`)

---

## Memory File Format

```markdown
---
id: "550e8400-e29b-41d4-a716-446655440000"
created_at: "2026-03-03T08:00:00.000Z"
updated_at: "2026-03-03T08:00:00.000Z"
tags:
  - architecture
  - tdd
category: "engineering"
importance: 4
---

# Contract-first MCP design

Define tool contracts and schemas before implementation.
```

Filename format:

```text
YYYY-MM-DD-title-slug.md
```

---

## Development

### Install & Build

```bash
npx pnpm install
npx pnpm run build
```

### Scripts

```bash
npx pnpm run build
npx pnpm run lint
npx pnpm run format
npx pnpm run typecheck
npx pnpm run test
npx pnpm run quality
```

### Engineering Workflow

- Contract-first (types + schema first)
- TDD (`red -> green -> refactor`)
- Quality gate enforced before merge
- Coverage threshold: **>= 80%**

---

## Project Structure

```text
memhub/
├── docs/
├── src/
│   ├── contracts/
│   ├── server/
│   ├── services/
│   ├── storage/
│   └── utils/
├── test/
└── .github/workflows/
```

---

## Roadmap

- [x] Architecture and contracts
- [x] Core storage/service/server implementation
- [x] Quality gate (lint/typecheck/test/coverage)
- [ ] Integration tests
- [ ] Performance improvements
- [x] npm release (`@synth-coder/memhub@0.2.3`)

---

## License

MIT
