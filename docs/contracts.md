# MemHub 契约文档（vNext）

当前对外 MCP 工具仅保留两项：

1. `memory_load`（首轮）
2. `memory_update`（末轮）

目标是形成稳定闭环：**先读 STM，再回写 STM**。

---

## 1) memory_load

用于用户输入后第一轮主动加载短期记忆。

### 输入

```ts
interface MemoryLoadInput {
  id?: string;                 // 指定单条记忆
  sessionId?: string;          // 会话 UUID
  date?: string;               // YYYY-MM-DD
  query?: string;              // 文本检索
  category?: string;
  tags?: string[];
  limit?: number;              // 默认 20
  scope?: 'stm' | 'all';       // 默认 stm
}
```

### 输出

```ts
interface MemoryLoadOutput {
  items: Memory[];
  total: number;
}
```

---

## 2) memory_update

用于本轮结束前主动回写记忆。

### 输入

```ts
type EntryType = 'decision' | 'preference' | 'knowledge' | 'todo' | 'state_change';

interface MemoryUpdateInput {
  id?: string;                 // 有 id 则更新；无 id 则追加
  sessionId?: string;          // 无则服务端自动生成并返回
  mode?: 'append' | 'upsert';  // 默认 append
  entryType?: EntryType;
  title?: string;
  content: string;             // 必填
  tags?: string[];
  category?: string;
  importance?: number;         // 1-5
}
```

### 输出

```ts
interface MemoryUpdateOutput {
  id: string;
  sessionId: string;
  filePath: string;
  created: boolean;
  updated: boolean;
  memory: Memory;
}
```

---

## Memory 数据模型

```ts
interface Memory {
  id: string;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  entryType?: EntryType;
  tags: string[];
  category: string;
  importance: number;
  title: string;
  content: string;
}
```

---

## 存储路径契约（并发安全）

为避免多个 CLI 同日写入冲突，采用分层目录：

```text
{storageRoot}/YYYY-MM-DD/{session_uuid}/{timestamp}-{slug}.md
```

例如：

```text
memories/2026-03-03/550e8400-e29b-41d4-a716-446655440111/2026-03-03T16-40-12-123Z-task-summary.md
```

---

## 调用策略契约（强建议）

- 用户输入后第一轮：调用 `memory_load`
- 最终输出前最后一轮：调用 `memory_update`

详细策略见：`docs/tool-calling-policy.md`
