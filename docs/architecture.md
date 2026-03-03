# MemHub 架构设计文档

## 概述

MemHub 是一个基于 Git 友好的记忆存储系统，使用 Markdown 格式存储记忆条目，通过 YAML Front Matter 存储元数据。它实现了 MCP (Model Context Protocol) Server，通过 stdio 进行通信，并集成了向量语义搜索功能以提供更智能的记忆检索。

## 设计原则

1. **Git 友好**: 所有数据以纯文本 Markdown 文件存储，天然支持版本控制
2. **人类可读**: 记忆条目可以直接用文本编辑器打开阅读
3. **简单优先**: Markdown 作为唯一数据源，向量索引仅为搜索缓存
4. **契约先行**: 接口和类型定义先于实现
5. **测试驱动**: 严格遵循 TDD (红-绿-重构)
6. **混合搜索**: 支持基于元数据的过滤和基于向量的语义搜索
7. **懒加载**: 向量模型和索引按需加载，降低启动成本

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      MCP Client                             │
│                   (Claude Desktop, etc.)                    │
└──────────────────────┬──────────────────────────────────────┘
                       │ stdio
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    MemHub MCP Server                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  MCP Router  │  │   Services   │  │   Storage Layer  │  │
│  │              │  │              │  │                  │  │
│  │ - list_tools │  │ - memoryLoad │  │ - MarkdownStorage│  │
│  │ - call_tool  │  │ - memoryUpdate│ │ - FrontMatter    │  │
│  │              │  │              │  │ - VectorIndex    │  │
│  │              │  │              │  │ - EmbeddingSvc   │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Storage Layer                            │
│  ┌────────────────────┐        ┌────────────────────────┐  │
│  │  Markdown Storage  │        │   Vector Search Cache  │  │
│  │  (Source of Truth) │        │   (LanceDB)           │  │
│  │                    │        │                        │  │
│  │  YYYY-MM-DD/       │        │  .lancedb/            │  │
│  │  session_uuid/     │◄──────►│  - 384-dim vectors    │  │
│  │  title-slug.md     │        │  - Cosine distance    │  │
│  │                    │        │  - Rebuildable        │  │
│  └────────────────────┘        └────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Embedding Service                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ONNX Model (all-MiniLM-L6-v2)                      │   │
│  │  - 384-dimension output                             │   │
│  │  - Cached at ~/.cache/huggingface                   │   │
│  │  - Lazy initialization                              │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. MCP Server (src/server/mcp-server.ts)

- 入口点，处理 stdio 通信
- 实现 MCP 协议的生命周期管理
- 路由工具调用到 MemoryService
- 支持 `MEMHUB_STORAGE_PATH` 和 `MEMHUB_VECTOR_SEARCH` 环境变量

### 2. Services (src/services/)

业务逻辑层，包含：

- **MemoryService**: 统一的记忆管理服务
  - `memoryLoad()`: 加载记忆（支持向量搜索和元数据过滤）
  - `memoryUpdate()`: 创建或更新记忆（自动维护向量索引）
- **EmbeddingService**: 文本嵌入服务（单例模式）
  - 基于 `@xenova/transformers` 的 ONNX 模型
  - 输出 384 维归一化向量
  - 首次使用时下载并缓存到 `~/.cache/huggingface`

### 3. Storage Layer (src/storage/)

数据持久化层：

- **MarkdownStorage**: Markdown 文件读写（唯一数据源）
- **FrontMatterParser**: YAML Front Matter 解析和序列化
- **VectorIndex**: LanceDB 向量索引（搜索缓存，可重建）

### 4. Contracts (src/contracts/)

类型定义和 Zod 契约：

- **types.ts**: TypeScript 类型定义
- **schemas.ts**: Zod 验证模式
- **mcp.ts**: MCP 工具定义和描述

## 数据模型

### Memory Entry (记忆条目)

```typescript
interface Memory {
  // Identity
  id: string;              // UUID v4

  // Metadata (YAML Front Matter)
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
  sessionId?: string;      // 会话 UUID（并发隔离）
  entryType?: EntryType;   // 记忆类型
  tags: string[];          // 标签数组
  category: string;        // 分类
  importance: number;      // 1-5 重要性等级

  // Content (Markdown Body)
  title: string;           // Markdown H1 标题
  content: string;         // Markdown 正文
}

type EntryType = 'preference' | 'decision' | 'context' | 'fact';
```

### File Naming Convention

```
memories/YYYY-MM-DD/session_uuid/timestamp-title-slug.md

Examples:
- memories/2026-03-03/550e8400-e29b-41d4-a716-446655440111/2026-03-03T16-40-12-123Z-task-summary.md
- memories/2026-03-04/a1b2c3d4-e5f6-7890-abcd-ef1234567890/2026-03-04T10-15-30-456Z-architecture-decision.md
```

**并发安全设计：**

- 同一天按 `session_uuid` 分桶，避免多 CLI 写入冲突
- 每条记录独立文件，支持并发读写
- 文件路径包含时间戳，保证唯一性

### Markdown Format

```markdown
---
id: '550e8400-e29b-41d4-a716-446655440000'
created_at: '2026-03-03T08:00:00.000Z'
updated_at: '2026-03-03T08:00:00.000Z'
session_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
entry_type: 'decision'
tags:
  - architecture
  - vector-search
category: 'engineering'
importance: 4
---

# Integrate Vector Semantic Search

Add LanceDB-based vector search with local ONNX embedding model.

## Key Decisions

- Use all-MiniLM-L6-v2 model (384-dim output)
- Store vectors in `.lancedb/` alongside markdown files
- Vector index is rebuildable from markdown source
```

## MCP Tools

MemHub 使用简化的 2-tool 接口，形成「先加载 STM，再回写 STM」的闭环。

### 1. `memory_load`

统一记忆加载接口，用于用户输入后第一轮主动加载短期记忆。

**Input:**

```typescript
interface MemoryLoadInput {
  id?: string;              // 指定单条记忆 ID
  sessionId?: string;       // 会话 UUID（用于隔离并发 CLI）
  date?: string;            // YYYY-MM-DD 日期过滤
  query?: string;           // 语义搜索查询（启用向量搜索）
  category?: string;        // 分类过滤
  tags?: string[];          // 标签过滤
  limit?: number;           // 返回数量限制（默认 20）
  scope?: 'stm' | 'all';    // 搜索范围（默认 stm）
}
```

**Output:**

```typescript
interface MemoryLoadOutput {
  items: Memory[];          // 记忆条目数组
  total: number;            // 总数
}
```

**行为特性：**

- 当提供 `query` 时，使用向量语义搜索（需要 `MEMHUB_VECTOR_SEARCH=true`）
- 当提供 `tags`、`category`、`date` 时，使用元数据过滤
- 支持组合条件（先向量搜索再过滤）
- 向量搜索失败时自动降级为文本搜索

### 2. `memory_update`

统一记忆回写接口，用于本轮结束前主动回写记忆。

**Input:**

```typescript
type EntryType = 'decision' | 'preference' | 'knowledge' | 'todo' | 'state_change';

interface MemoryUpdateInput {
  id?: string;              // 有则更新，无则创建
  sessionId?: string;       // 无则服务端自动生成并返回
  mode?: 'append' | 'upsert'; // 默认 append
  entryType?: EntryType;    // 记忆类型
  title?: string;           // 标题（Markdown H1）
  content: string;          // 内容（必填，Markdown）
  tags?: string[];          // 标签
  category?: string;        // 分类
  importance?: number;      // 重要性 1-5（默认 3）
}
```

**Output:**

```typescript
interface MemoryUpdateOutput {
  id: string;               // 记忆 ID
  sessionId: string;        // 会话 ID
  filePath: string;         // 存储路径
  created: boolean;         // 是否新建
  updated: boolean;         // 是否更新
  memory: Memory;           // 完整记忆对象
}
```

**行为特性：**

- 自动生成 UUID 和时间戳
- 自动维护向量索引（后台异步）
- 支持并发安全：按 `YYYY-MM-DD/session_uuid/` 分目录存储
- 向量索引失败不影响 Markdown 写入

## 错误处理

所有错误使用标准 MCP 错误格式：

```typescript
interface McpError {
  code: number; // MCP error code
  message: string; // Human readable message
  data?: unknown; // Additional context
}
```

错误码定义：

- `INVALID_PARAMS`: 参数验证失败
- `NOT_FOUND`: 记忆条目不存在
- `STORAGE_ERROR`: 存储操作失败
- `INTERNAL_ERROR`: 内部错误

## 配置

通过环境变量配置：

```bash
MEMHUB_STORAGE_PATH=/path/to/memories  # 存储目录，默认: ./memories
MEMHUB_LOG_LEVEL=info                   # 日志级别: debug, info, warn, error
MEMHUB_VECTOR_SEARCH=true               # 启用向量搜索，默认: true
```

## 向量搜索架构

### 设计原则

1. **Markdown 为准**: Markdown 文件是唯一数据源，向量索引仅为搜索缓存
2. **可重建性**: 向量索引可随时从 Markdown 文件重建
3. **懒加载**: ONNX 模型和 LanceDB 按需加载，降低启动成本
4. **降级友好**: 向量搜索失败不影响基本功能

### Embedding 服务

- **模型**: Xenova/all-MiniLM-L6-v2 (~23MB)
- **输出维度**: 384
- **缓存位置**: `~/.cache/huggingface/`
- **单例模式**: 全局共享一个模型实例

### Vector Index

- **存储**: LanceDB (`.lancedb/` 目录)
- **距离度量**: Cosine distance
- **索引字段**:
  - `id`: 记忆 UUID
  - `vector`: 384 维浮点向量
  - `title`, `category`, `tags`, `importance`: 元数据过滤

### 搜索流程

1. **Query Embedding**: 将查询文本转换为 384 维向量
2. **Vector Search**: 在 LanceDB 中查找最相似的向量
3. **Metadata Filter**: 可选地按 tags/category/date 过滤
4. **Ranking**: 按距离排序（距离越小越相似）
5. **Result Loading**: 从 Markdown 文件加载完整记忆内容

## 技术栈

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.9+
- **Protocol**: MCP (Model Context Protocol) via @modelcontextprotocol/sdk
- **Transport**: stdio
- **Storage**:
  - **Markdown**: 纯文本存储（唯一数据源）
  - **Vector DB**: LanceDB (基于 Apache Arrow)
- **AI/ML**:
  - **Embedding**: @xenova/transformers (all-MiniLM-L6-v2 ONNX 模型)
  - **Vector Dimension**: 384
- **Validation**: Zod 3.25+
- **Testing**: Vitest (覆盖率 >= 80%)
- **Linting**: ESLint + Prettier

## 目录结构

```
memhub/
├── docs/
│   ├── architecture.md           # 本文档
│   ├── architecture-diagrams.md  # 架构图（Mermaid）
│   ├── contracts.md              # 契约文档
│   ├── tool-calling-policy.md    # 工具调用策略
│   └── prompt-template.md        # Agent Prompt 模板
├── src/
│   ├── contracts/                # 类型和契约
│   │   ├── types.ts
│   │   ├── schemas.ts
│   │   └── mcp.ts
│   ├── server/                   # MCP Server
│   │   └── mcp-server.ts
│   ├── services/                 # 业务逻辑
│   │   ├── memory-service.ts
│   │   └── embedding-service.ts
│   ├── storage/                  # 存储层
│   │   ├── markdown-storage.ts
│   │   ├── frontmatter-parser.ts
│   │   └── vector-index.ts
│   └── utils/                    # 工具函数
│       └── slugify.ts
├── test/                         # 测试
│   ├── unit/
│   └── integration/
├── .github/
│   └── workflows/
│       └── ci.yml                # CI 配置
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .eslintrc.cjs
├── .prettierrc
└── README.md
```

## 开发流程

1. **设计**: 先写架构文档和契约
2. **契约**: 定义 TypeScript 类型和 Zod Schema
3. **测试**: 编写红色测试（先失败）
4. **实现**: 编写最小实现使测试通过（绿色）
5. **重构**: 优化代码结构
6. **重复**: 循环 3-5 步

## 质量门禁

- ✅ ESLint 无错误
- ✅ Prettier 格式化检查通过
- ✅ TypeScript 严格类型检查通过
- ✅ 单元测试全部通过
- ✅ 代码覆盖率 >= 80%
