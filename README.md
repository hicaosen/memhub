# MemHub

Git-friendly memory MCP server for coding agents.

MemHub stores decisions, preferences, and reusable knowledge as plain Markdown files with YAML front matter, so everything is easy to review, diff, and version with Git.

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

## Quick Start

### 1) Install from npm

```bash
npm i @synth-coder/memhub
```

### 2) Or install dependencies for local development

```bash
npm install
```

### 3) Build

```bash
npm run build
```

### 4) Run quality gate
```bash
npm run quality
```

---

## Use as MCP Server (stdio)

### Option A: run directly via npx (recommended)

```bash
npx -y @synth-coder/memhub
```

> On Windows, do **not** append `memhub` after the package name.
> If a source `.js` file opens in editor, upgrade to latest package version (`0.1.2+`) and retry.

Example MCP client config:

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

### Option B: local repo run

```json
{
  "mcpServers": {
    "memhub": {
      "command": "node",
      "args": ["dist/src/server/mcp-server.js"]
    }
  }
}
```

---

## Environment Variables

- `MEMHUB_STORAGE_PATH` (default: `./memories`)
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

## MCP Tools

- `memory_load`  
  First-turn tool. Load STM context for the current task/session.
- `memory_update`  
  Final-turn tool. Write back decisions, preferences, knowledge, and task-state updates.

Calling policy: see `docs/tool-calling-policy.md`.

---

## Development

### Scripts

```bash
npm run build
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run quality
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
- [x] npm release (`@synth-coder/memhub@0.1.2`)

---

## License

MIT
