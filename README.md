# MemHub

Git-friendly memory MCP server for coding agents.

---

## Quick Start

### One-Line Setup

Configure MemHub for your AI agent with a single command:

```bash
npx -y @synth-coder/memhub@latest init
```

This launches an interactive prompt to select your agent. MemHub will:
1. Add MCP server config to your agent's configuration file
2. Add MemHub usage instructions to your agent's rules file

**Supported Agents:**

| Agent | Config File | Instructions File |
|-------|-------------|-------------------|
| Claude Code | `~/.claude/settings.json` | `~/.claude/CLAUDE.md` |
| Cursor | `~/.cursor/mcp.json` | `~/.cursorrules` |
| Cline | `~/.cline/mcp.json` | `~/.clinerules` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `~/.windsurfrules` |
| Factory Droid | `~/.factory/mcp.json` | `~/.factory/AGENTS.md` |
| Gemini CLI | `~/.gemini/settings.json` | `~/.gemini/GEMINI.md` |
| Codex | `~/.codex/config.toml` | `~/.codex/AGENTS.md` |

### CLI Options

```bash
# Interactive selection (global - default)
npx -y @synth-coder/memhub@latest init

# Skip interactive prompt
npx -y @synth-coder/memhub@latest init -a claude-code

# Configure for current project only (local)
npx -y @synth-coder/memhub@latest init -a cursor -l

# Update existing configuration
npx -y @synth-coder/memhub@latest init -a claude-code --force
```

| Option | Description |
|--------|-------------|
| `-a, --agent <name>` | Agent type (skip interactive) |
| `-l, --local` | Configure for current project (default: global) |
| `-f, --force` | Update existing configuration |

### Run as MCP Server

```bash
npx -y @synth-coder/memhub@latest
```

> On Windows, do **not** append `memhub` after the package name.

### Manual Configuration

If you prefer manual setup, add this to your MCP client config:

```json
{
  "mcpServers": {
    "memhub": {
      "command": "npx",
      "args": ["-y", "@synth-coder/memhub@latest"],
      "env": {
        "MEMHUB_STORAGE_PATH": "/absolute/path/to/memories",
        "MEMHUB_LOG_LEVEL": "info"
      }
    }
  }
}
```

For Codex (`~/.codex/config.toml`), use TOML key `mcp_servers`:

```toml
[mcp_servers.memhub]
command = "npx"
args = ["-y", "@synth-coder/memhub@latest"]
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

See [docs/mcp-tools.md](docs/mcp-tools.md) for detailed API reference.

---

## Why MemHub

Most AI memory tools rely on external APIs or simple keyword matching. MemHub is different:

### Semantic Search with Local AI

- **Vector Database**: Powered by LanceDB for fast similarity search
- **Local Embeddings**: Quantized Transformers.js model runs entirely on your machine
- **Zero API Costs**: No external services, no API keys, no rate limits
- **Privacy First**: Your memories never leave your computer

### Git-Native Storage

- **Plain Text**: All memories are Markdown files with YAML front matter
- **Version Control**: Commit, branch, review, and revert like any code
- **Human Readable**: Browse and edit memories with any text editor
- **Team Friendly**: Share memories via git repository

### How It Works

```
User Query → Local Embedding Model → Vector Search → Ranked Results
                    ↑                         ↓
              Runs on CPU              LanceDB Index
            (no GPU required)         (embedded database)
```

When you call `memory_load`, MemHub:
1. Converts your query to a vector using a local quantized model
2. Searches the LanceDB index for semantically similar memories
3. Returns ranked results with relevance scores

This means "testing framework preference" finds memories about "Vitest vs Jest decision" — even without exact keyword matches.

---

## Features

- **Semantic Search** — Vector-based similarity search with LanceDB
- **Local Embeddings** — Quantized Transformers.js model, runs on CPU
- **Markdown Storage** — Human-readable `.md` files with YAML front matter
- **Git-Friendly** — Version control, diff, review your memories
- **MCP Protocol** — Works with Claude Code, Cursor, Cline, Windsurf, and more
- **One-Line Setup** — `npx -y @synth-coder/memhub@latest init`

---

## Environment Variables

- `MEMHUB_STORAGE_PATH` (default: `~/.memhub`)
- `MEMHUB_LOG_LEVEL` (default: `info`, options: `debug|info|warn|error`)
- `MEMHUB_VECTOR_SEARCH` (default: `true`, set `false` to disable vector retrieval)
- `MEMHUB_RERANKER_MODE` (default: `auto`, options: `auto|model|lightweight`)
- `MEMHUB_RERANKER_MODEL` (default: `BAAI/bge-reranker-v2-m3`)

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
- [x] CLI init command for quick setup
- [ ] Integration tests
- [ ] Performance improvements
- [x] npm release (`@synth-coder/memhub@0.2.6`)

---

## License

MIT
