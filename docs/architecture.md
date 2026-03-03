# MemHub 架构设计文档

## 概述

MemHub 是一个基于 Git 友好的记忆存储系统，使用 Markdown 格式存储记忆条目，通过 YAML Front Matter 存储元数据。它实现了 MCP (Model Context Protocol) Server，通过 stdio 进行通信。

## 设计原则

1. **Git 友好**: 所有数据以纯文本 Markdown 文件存储，天然支持版本控制
2. **人类可读**: 记忆条目可以直接用文本编辑器打开阅读
3. **简单优先**: 不使用数据库，避免复杂的迁移和锁定问题
4. **契约先行**: 接口和类型定义先于实现
5. **测试驱动**: 严格遵循 TDD (红-绿-重构)

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
│  │ - list_tools │  │ - create     │  │ - read memory    │  │
│  │ - call_tool  │  │ - read       │  │ - write memory   │  │
│  │              │  │ - update     │  │ - search index   │  │
│  │              │  │ - delete     │  │ - list memories  │  │
│  │              │  │ - search     │  │                  │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Markdown Storage                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  YYYY-MM-DD-title-slug.md                           │   │
│  │  ─────────────────────────                          │   │
│  │  ---                                                │   │
│  │  id: uuid-v4                                        │   │
│  │  created_at: ISO8601                                │   │
│  │  updated_at: ISO8601                                │   │
│  │  tags: [tag1, tag2]                                 │   │
│  │  category: string                                   │   │
│  │  importance: 1-5                                    │   │
│  │  ---                                                │   │
│  │                                                     │   │
│  │  # Title                                            │   │
│  │                                                     │   │
│  │  Markdown content body...                           │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. MCP Server (src/server/mcp-server.ts)

- 入口点，处理 stdio 通信
- 实现 MCP 协议的生命周期管理
- 路由工具调用到对应的服务

### 2. Services (src/services/)

业务逻辑层，包含：

- **MemoryService**: 记忆 CRUD 操作
- **SearchService**: 搜索和过滤
- **IndexService**: 索引管理（可选，用于性能）

### 3. Storage Layer (src/storage/)

数据持久化层：

- **MarkdownStorage**: Markdown 文件读写
- **FrontMatterParser**: YAML Front Matter 解析
- **FileSystem**: 文件系统抽象（便于测试）

### 4. Contracts (src/contracts/)

类型定义和 Zod 契约：

- **types.ts**: TypeScript 类型
- **schemas.ts**: Zod 验证模式
- **mcp.ts**: MCP 协议相关类型

## 数据模型

### Memory Entry (记忆条目)

```typescript
interface Memory {
  // Identity
  id: string; // UUID v4

  // Metadata (YAML Front Matter)
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  tags: string[]; // 标签数组
  category: string; // 分类
  importance: number; // 1-5 重要性等级

  // Content (Markdown Body)
  title: string; // Markdown H1 标题
  content: string; // Markdown 正文
}
```

### File Naming Convention

```
{YYYY-MM-DD}-{title-slug}.md

Examples:
- 2024-03-15-project-kickoff.md
- 2024-03-20-meeting-notes.md
```

### Markdown Format

```markdown
---
id: '550e8400-e29b-41d4-a716-446655440000'
created_at: '2024-03-15T10:30:00Z'
updated_at: '2024-03-15T14:20:00Z'
tags:
  - project
  - planning
category: 'work'
importance: 4
---

# Project Kickoff

Today we started the new project...

## Key Decisions

- Decision 1
- Decision 2
```

## MCP Tools

### 1. `memory_create`

创建新记忆条目。

**Input:**

- title: string (required)
- content: string (required)
- tags?: string[]
- category?: string
- importance?: number (1-5, default: 3)

**Output:**

- id: string
- filePath: string

### 2. `memory_read`

读取记忆条目。

**Input:**

- id: string (required)

**Output:**

- Memory object

### 3. `memory_update`

更新记忆条目。

**Input:**

- id: string (required)
- title?: string
- content?: string
- tags?: string[]
- category?: string
- importance?: number

**Output:**

- updated Memory object

### 4. `memory_delete`

删除记忆条目。

**Input:**

- id: string (required)

**Output:**

- success: boolean

### 5. `memory_list`

列出记忆条目（支持过滤和分页）。

**Input:**

- category?: string
- tags?: string[]
- fromDate?: string (ISO 8601)
- toDate?: string (ISO 8601)
- limit?: number (default: 20, max: 100)
- offset?: number (default: 0)

**Output:**

- memories: Memory[]
- total: number
- hasMore: boolean

### 6. `memory_search`

全文搜索记忆。

**Input:**

- query: string (required)
- limit?: number (default: 10)

**Output:**

- results: SearchResult[]
  - memory: Memory
  - score: number
  - matches: string[]

### 7. `memory_get_categories`

获取所有分类。

**Output:**

- categories: string[]

### 8. `memory_get_tags`

获取所有标签。

**Output:**

- tags: string[]

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
```

## 技术栈

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.3+
- **Protocol**: MCP (Model Context Protocol)
- **Transport**: stdio
- **Validation**: Zod
- **Testing**: Vitest (覆盖率 >= 80%)
- **Linting**: ESLint + Prettier

## 目录结构

```
memhub/
├── docs/
│   ├── architecture.md       # 本文档
│   └── contracts.md          # 契约文档
├── src/
│   ├── contracts/            # 类型和契约
│   │   ├── types.ts
│   │   ├── schemas.ts
│   │   └── mcp.ts
│   ├── server/               # MCP Server
│   │   └── mcp-server.ts
│   ├── services/             # 业务逻辑
│   │   ├── memory-service.ts
│   │   └── search-service.ts
│   ├── storage/              # 存储层
│   │   ├── markdown-storage.ts
│   │   └── frontmatter-parser.ts
│   └── utils/                # 工具函数
│       └── file-system.ts
├── test/                     # 测试
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── .github/
│   └── workflows/
│       └── ci.yml            # CI 配置
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
