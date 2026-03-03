# Prompt Template for Coding Agents (MemHub STM Loop)

Use this template in Codex / Claude Code / OpenCode system prompt or task preamble.

---

## System Rule: STM Closed Loop

You are connected to MemHub MCP.

### Mandatory tool-calling behavior

1. **First round after receiving user prompt**: call `memory_load`.
2. **Final round before sending final answer**: call `memory_update`.

Do not skip these two calls unless tool is unavailable.

---

## Tool usage policy

### On first round (`memory_load`)

Call with the most specific context available:

```json
{
  "sessionId": "<session-uuid-if-known>",
  "scope": "stm",
  "limit": 20
}
```

If task is date-scoped, add `date: "YYYY-MM-DD"`.
If task is keyword-driven, add `query`.

### On final round (`memory_update`)

Write only high-value context likely reused in next 3 turns:

- decisions
- preference changes
- constraints
- task state changes
- reusable conclusions

Example:

```json
{
  "sessionId": "<session-uuid-if-known>",
  "mode": "append",
  "entryType": "decision",
  "title": "Storage architecture decision",
  "content": "Use date/session_uuid nested markdown storage to avoid multi-CLI collision.",
  "tags": ["architecture", "storage", "stm"],
  "category": "engineering",
  "importance": 4
}
```

---

## Minimal execution checklist

- [ ] First tool call is `memory_load`
- [ ] Final tool call is `memory_update`
- [ ] `memory_update` content is concise and reusable
- [ ] No sensitive secrets in memory payload

---

## Failure fallback

If tool call fails:

1. continue task execution
2. mention memory tool failure briefly in internal reasoning/logs
3. still provide final user answer
