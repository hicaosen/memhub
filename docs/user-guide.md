# MemHub User Guide

MemHub is a Git-friendly memory system for AI coding agents. It helps your AI remember preferences, decisions, and project context across conversations.

## Installation

### Quick Setup (Recommended)

Configure MemHub for your AI agent with one command:

```bash
npx -y @synth-coder/memhub init
```

This will:
1. Add MCP server config to your agent's configuration file
2. Add MemHub usage instructions to your agent's rules file

### Supported Agents

| Agent | Global Config | Local Config |
|-------|---------------|--------------|
| Claude Code | `~/.claude/settings.json` | `.mcp.json` |
| Cursor | `~/.cursor/mcp.json` | `.cursor/mcp.json` |
| Cline | `~/.cline/mcp.json` | `.cline/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `.codeium/windsurf/mcp_config.json` |
| Factory Droid | `~/.factory/mcp.json` | `.factory/mcp.json` |
| Gemini CLI | `~/.gemini/settings.json` | `.gemini/settings.json` |
| Codex | `~/.codex/config.toml` | `.codex/config.toml` |

### CLI Options

```bash
# Interactive selection (global - default)
npx -y @synth-coder/memhub init

# Specify agent
npx -y @synth-coder/memhub init -a claude-code

# Configure for current project only (local)
npx -y @synth-coder/memhub init -a cursor -l

# Update existing configuration
npx -y @synth-coder/memhub init -a claude-code --force
```

| Option | Description |
|--------|-------------|
| `-a, --agent <name>` | Agent type (skip interactive) |
| `-l, --local` | Configure for current project (default: global) |
| `-f, --force` | Update existing configuration |

---

## How It Works

### Memory Tools

MemHub provides two MCP tools for your AI agent:

#### `memory_load` - Recall Context

Your AI calls this when it needs to remember something:

- User mentions "before", "remember", "last time"
- Uncertain about user preferences
- Need historical context for a decision

#### `memory_update` - Store Knowledge

Your AI calls this when it learns something worth remembering:

- User expresses a preference ("I prefer functional components")
- Made a significant decision with reasoning
- Discovered important project context
- User corrected an assumption

### Memory Types

| Type | Purpose | Example |
|------|---------|---------|
| `preference` | User preferences | "Prefers TypeScript over JavaScript" |
| `decision` | Technical decisions | "Using PostgreSQL for scalability" |
| `context` | Project context | "Team uses conventional commits" |
| `fact` | Learned facts | "API rate limit is 1000 req/min" |

---

## Storage

### Where Memories Are Stored

By default, memories are stored in `~/.memhub/` (global) or `./memories/` (local).

```bash
# Custom storage location
MEMHUB_STORAGE_PATH=/path/to/memories npx -y @synth-coder/memhub
```

### File Format

Memories are plain Markdown files with YAML front matter:

```markdown
---
id: "550e8400-e29b-41d4-a716-446655440000"
created_at: "2026-03-04T10:00:00.000Z"
tags:
  - architecture
  - tdd
category: "engineering"
importance: 4
---

# Use Contract-First Design

Define tool contracts and schemas before implementation.
```

### Git Integration

Since memories are plain text files, you can:

- Commit them to your repository
- Review changes in pull requests
- Revert if needed
- Share with your team

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMHUB_STORAGE_PATH` | `~/.memhub` | Memory storage directory |
| `MEMHUB_LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |

---

## Tips

### What to Remember

**Good candidates:**
- User preferences (coding style, frameworks)
- Technical decisions and their reasoning
- Project constraints and conventions
- Lessons learned from mistakes

**Avoid storing:**
- Temporary information
- One-time tasks
- Sensitive data (API keys, passwords)

### Memory Principles

1. **Natural trigger** - Memory calls should be context-driven, not scheduled
2. **Value first** - Only store what future conversations will benefit from
3. **Preferences matter** - User preferences are the most valuable memories

---

## Troubleshooting

### Configuration not working?

1. Restart your AI agent after running `init`
2. Check the config file exists and contains `memhub` server
3. Try with `--force` to update existing configuration

### Memories not loading?

1. Check `MEMHUB_STORAGE_PATH` is correct
2. Verify the directory contains `.md` files
3. Check file permissions

### Need help?

- GitHub Issues: https://github.com/synth-coder/memhub/issues
