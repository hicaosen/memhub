# MemHub 契约文档（v0.2.0）

当前对外 MCP 工具采用简化的 2-tool 接口：

1. `memory_load`（首轮）：统一记忆加载接口
2. `memory_update`（末轮）：统一记忆回写接口

目标是形成稳定闭环：**先读 STM，再回写 STM**。

## 核心特性

- **向量语义搜索**: 支持基于 query 的语义相似度搜索
- **元数据过滤**: 支持按 tags、category、date 过滤
- **混合搜索**: 可组合向量搜索和元数据过滤
- **并发安全**: 按 session_uuid 分目录存储，支持多 CLI 并发

---

## 1) memory_load

用于用户输入后第一轮主动加载短期记忆。支持向量语义搜索和元数据过滤。

### 输入

```ts
interface MemoryLoadInput {
  id?: string;                 // 指定单条记忆 ID（优先级最高）
  query?: string;              // 语义搜索查询（启用向量搜索）
  category?: string;           // 分类过滤
  tags?: string[];             // 标签过滤
  limit?: number;              // 返回数量限制，默认 20
}
```

### 行为说明

1. **向量搜索** (当提供 `query` 时):
   - 使用 ONNX 模型将 query 转换为 384 维向量
   - 在 LanceDB 中搜索最相似的向量
   - 返回按相似度排序的结果

2. **元数据过滤** (当提供 `tags`、`category`、`date` 时):
   - 在文件系统中扫描匹配的 Markdown 文件
   - 解析 YAML Front Matter 进行过滤
   - 支持多条件组合

3. **混合模式**:
   - 先进行向量搜索获取候选集
   - 再按元数据条件过滤
   - 结合相似度得分和匹配度排序

4. **降级处理**:
   - 向量搜索失败时自动降级为文本搜索
   - 保证基本功能可用

### 输出

```ts
interface MemoryLoadOutput {
  items: Memory[];
  total: number;
}
```

---

## 2) memory_update

用于本轮结束前主动回写记忆。自动维护 Markdown 文件和向量索引。

### 输入

```ts
type EntryType = 'preference' | 'decision' | 'context' | 'fact';

interface MemoryUpdateInput {
  id?: string;                 // 有则更新；无则创建新记录
  sessionId?: string;          // 无则服务端自动生成并返回
  mode?: 'append' | 'upsert';  // 默认 append
  entryType?: EntryType;       // 记忆类型
  title?: string;              // 标题（Markdown H1）
  content: string;             // 内容（必填，Markdown 格式）
  tags?: string[];             // 标签数组
  category?: string;           // 分类
  importance?: number;         // 重要性 1-5，默认 3
}
```

### 行为说明

1. **Markdown 写入** (同步):
   - 生成或更新 Markdown 文件
   - 路径格式: `YYYY-MM-DD/session_uuid/timestamp-title-slug.md`
   - 写入 YAML Front Matter 和 Markdown 正文

2. **向量索引更新** (异步):
   - 使用 Embedding 服务生成 384 维向量
   - 在 LanceDB 中 upsert 向量记录
   - 包含元数据字段用于过滤

3. **并发安全**:
   - 按 `session_uuid` 分目录，避免多 CLI 冲突
   - 文件名包含时间戳，保证唯一性

4. **容错处理**:
   - 向量索引失败不影响 Markdown 写入
   - 记录错误日志，不中断主流程

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
type EntryType = 'preference' | 'decision' | 'context' | 'fact';

interface Memory {
  id: string;                  // UUID v4
  createdAt: string;           // ISO 8601
  updatedAt: string;           // ISO 8601
  sessionId?: string;          // 会话 UUID
  entryType?: EntryType;       // 记忆类型
  tags: string[];              // 标签数组
  category: string;            // 分类
  importance: number;          // 1-5
  title: string;               // Markdown H1 标题
  content: string;             // Markdown 正文
}
```

### EntryType 说明

- **preference**: 用户偏好和习惯
- **decision**: 技术决策及其理由
- **context**: 项目和环境信息
- **fact**: 客观知识和事实

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

### 向量索引存储

向量数据存储在独立的 LanceDB 目录中：

```text
{storageRoot}/.lancedb/
  ├── versions/
  ├── manifest.json
  └── ...
```

**重要特性**:

- Markdown 文件是唯一数据源
- 向量索引可随时从 Markdown 重建
- 删除 `.lancedb/` 目录不影响数据完整性

---

## 调用策略契约（强建议）

- 用户输入后第一轮：调用 `memory_load`
- 最终输出前最后一轮：调用 `memory_update`

详细策略见：`docs/tool-calling-policy.md`
