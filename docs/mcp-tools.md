# MCP Tools Reference

MemHub exposes two MCP tools for AI agents to manage persistent memory.

---

## memory_load

Load relevant memories to get context for the current task.

### Parameters

| Parameter   | Type     | Required | Description                                                 |
| ----------- | -------- | -------- | ----------------------------------------------------------- |
| `query`     | string   | No       | Search query to filter memories                             |
| `rewrittenQueries` | string[] | Yes | Exactly 3 rewritten queries for retrieval expansion        |
| `limit`     | number   | No       | Max memories to return (default: 10)                        |
| `entryType` | string   | No       | Filter by type: `preference`, `decision`, `context`, `fact` |

### Returns

```json
{
  "memories": [
    {
      "id": "uuid",
      "title": "Memory title",
      "content": "Memory content...",
      "importance": 4,
      "createdAt": "2026-03-04T10:00:00.000Z",
      "updatedAt": "2026-03-04T10:00:00.000Z"
    }
  ],
  "count": 1
}
```

### When to Call

- Starting a new conversation or task
- User mentions "before", "remember", "last time"
- Uncertain about user preferences or constraints
- Need project context (tech stack, conventions)

### Example

```json
{
  "query": "testing framework",
  "rewrittenQueries": ["testing framework", "preferred testing tool", "test stack preference"],
  "limit": 5
}
```

---

## memory_update

Store new memories or update existing ones.

### Parameters

| Parameter        | Type     | Required | Description                                          |
| ---------------- | -------- | -------- | ---------------------------------------------------- |
| `title`          | string   | Yes      | Short, descriptive title                             |
| `content`        | string   | Yes      | Detailed memory content                              |
| `ttl`            | string   | Yes      | TTL policy: `permanent`/`long`/`medium`/`short`/`session` |
| `idempotencyKey` | string   | No       | Client-generated retry key to avoid duplicate writes |
| `entryType`      | string   | No       | Memory type (default: `fact`)                        |
| `importance`     | number   | No       | Importance 1-5 (default: 3)                          |
| `id`             | string   | No       | Existing memory ID to update                         |

### Entry Types

| Type         | Purpose                                            |
| ------------ | -------------------------------------------------- |
| `preference` | User preferences (coding style, framework choices) |
| `decision`   | Architecture decisions, technology choices         |
| `context`    | Project context (team, processes, constraints)     |
| `fact`       | Learned facts, important notes                     |

### Returns

```json
{
  "id": "uuid",
  "sessionId": "uuid",
  "filePath": "/abs/path/to/memory.md",
  "created": true,
  "updated": false,
  "idempotentReplay": false,
  "memory": {
    "title": "Memory title",
    "content": "Memory content..."
  }
}
```

### When to Call

- User explicitly expresses a preference
- Made a significant decision with reasoning
- Discovered important project context
- User corrected an assumption

### Example

```json
{
  "title": "Use Vitest for Testing",
  "content": "User prefers Vitest over Jest for all new projects. Reason: faster test execution and better ESM support.",
  "ttl": "permanent",
  "entryType": "preference",
  "importance": 4
}
```

---

## Best Practices

### What to Store

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

1. **Natural trigger** - Memory calls should be context-driven
2. **Value first** - Only store what future conversations benefit from
3. **Preferences matter** - User preferences are the most valuable memories
