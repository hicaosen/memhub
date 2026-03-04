# MemHub

一个面向编码代理（Codex / Claude Code / OpenCode 等）的 **Git 友好记忆 MCP Server**。

MemHub 将“用户决策、长期偏好、可复用知识”保存为 **Markdown 文件 + YAML Front Matter**，便于人读、审查、版本管理和协作。

---

## 为什么用 MemHub

大多数 AI 记忆工具依赖外部 API 或简单的关键词匹配。MemHub 不同：

### 本地 AI 语义搜索

- **向量数据库**：基于 LanceDB 实现快速相似度搜索
- **本地嵌入模型**：量化版 Transformers.js 模型，完全在本地运行
- **零 API 成本**：无需外部服务、无需 API 密钥、无速率限制
- **隐私优先**：你的记忆永远不会离开你的电脑

### Git 原生存储

- **纯文本格式**：所有记忆都是带 YAML front matter 的 Markdown 文件
- **版本控制**：像代码一样提交、分支、审查、回滚
- **人类可读**：用任何文本编辑器浏览和编辑记忆
- **团队友好**：通过 git 仓库共享记忆

### 工作原理

```
用户查询 → 本地嵌入模型 → 向量搜索 → 排序结果
              ↑                    ↓
        运行在 CPU           LanceDB 索引
       (无需 GPU)           (嵌入式数据库)
```

当你调用 `memory_load` 时，MemHub：
1. 使用本地量化模型将查询转换为向量
2. 在 LanceDB 索引中搜索语义相似的记忆
3. 返回带有相关性分数的排序结果

这意味着"测试框架偏好"可以找到关于"Vitest vs Jest 决策"的记忆——即使没有精确的关键词匹配。

---

## 核心特性

- **语义搜索** — 基于 LanceDB 的向量相似度搜索
- **本地嵌入** — 量化版 Transformers.js 模型，CPU 运行
- **Markdown 存储** — 人类可读的 `.md` 文件，带 YAML front matter
- **Git 友好** — 版本控制、diff、审查你的记忆
- **MCP 协议** — 支持 Claude Code、Cursor、Cline、Windsurf 等
- **一键配置** — `npx -y @synth-coder/memhub@latest init`

---

## 快速开始

### 一键配置

使用一条命令为你的 AI 代理配置 MemHub：

```bash
npx -y @synth-coder/memhub@latest init
```

这将启动交互式提示选择你的代理。MemHub 会：
1. 将 MCP 服务器配置添加到代理的配置文件
2. 将 MemHub 使用说明添加到代理的规则文件

**支持的代理：**

| 代理 | 配置文件 | 指令文件 |
|------|----------|----------|
| Claude Code | `~/.claude/settings.json` | `~/.claude/CLAUDE.md` |
| Cursor | `~/.cursor/mcp.json` | `~/.cursorrules` |
| Cline | `~/.cline/mcp.json` | `~/.clinerules` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `~/.windsurfrules` |
| Factory Droid | `~/.factory/mcp.json` | `~/.factory/AGENTS.md` |
| Gemini CLI | `~/.gemini/settings.json` | `~/.gemini/GEMINI.md` |
| Codex | `~/.codex/config.toml` | `~/.codex/AGENTS.md` |

### CLI 选项

```bash
# 交互式选择（全局 - 默认）
npx -y @synth-coder/memhub@latest init

# 跳过交互式提示
npx -y @synth-coder/memhub@latest init -a claude-code

# 仅配置当前项目（本地）
npx -y @synth-coder/memhub@latest init -a cursor -l

# 更新现有配置
npx -y @synth-coder/memhub@latest init -a claude-code --force
```

| 选项 | 说明 |
|------|------|
| `-a, --agent <名称>` | 代理类型（跳过交互式选择） |
| `-l, --local` | 配置当前项目（默认：全局） |
| `-f, --force` | 更新现有配置 |

---

## 作为 MCP Server 使用（stdio）

### 方式 A：npx 直接运行（推荐）

```bash
npx -y @synth-coder/memhub@latest
```

> Windows 下不要在包名后再加 `memhub` 参数。
> 如果出现“弹出源码 .js 文件”的情况，请升级到最新版本（`0.1.2+`）后重试。

在你的 MCP 客户端配置中添加：

```json
{
  "mcpServers": {
    "memhub": {
      "command": "npx",
      "args": ["-y", "@synth-coder/memhub@latest"],
      "env": {
        "MEMHUB_STORAGE_PATH": "/绝对路径/你的记忆目录",
        "MEMHUB_LOG_LEVEL": "info"
      }
    }
  }
}
```

如果是 Codex（`~/.codex/config.toml`），请使用 TOML 键 `mcp_servers`：

```toml
[mcp_servers.memhub]
command = "npx"
args = ["-y", "@synth-coder/memhub@latest"]
```

### 方式 B：本地仓库运行

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

## 环境变量

- `MEMHUB_STORAGE_PATH`：记忆存储目录（默认：`./memories`）
- `MEMHUB_LOG_LEVEL`：日志级别（默认：`info`，可选：`debug|info|warn|error`）
- `MEMHUB_VECTOR_SEARCH`：是否启用向量检索（默认：`true`，设为 `false` 可关闭）
- `MEMHUB_RERANKER_MODE`：重排序模式（默认：`auto`，可选：`auto|model|lightweight`）
- `MEMHUB_RERANKER_MODEL`：重排序模型 ID（默认：`BAAI/bge-reranker-v2-m3`）

---

## 记忆文件格式

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

# Contract-first MCP 设计

先定义工具契约与 schema，再进入实现。
```

文件名格式：

```text
YYYY-MM-DD-title-slug.md
```

---

## MCP 工具列表

> 详见 [docs/mcp-tools.md](docs/mcp-tools.md) 获取 API 参考。

- `memory_load`：首轮加载短期记忆（STM）上下文
- `memory_update`：末轮回写决策/偏好/知识/状态变化

---

## 开发说明

### 常用脚本

```bash
npm run build
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run quality
```

### 工程流程（默认）

- 契约优先（先类型与 schema）
- 严格 TDD（`红 -> 绿 -> 重构`）
- 合并前必须通过质量门禁
- 覆盖率阈值：**>= 80%**

---

## 项目结构

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

## 路线图

- [x] 架构与契约设计
- [x] 核心实现（storage/service/server）
- [x] 质量门禁（lint/typecheck/test/coverage）
- [x] CLI init 命令快速配置
- [ ] 集成测试
- [ ] 性能优化
- [x] npm 发布（`@synth-coder/memhub@0.2.6`）

---

## License

MIT
