# MemHub

一个面向编码代理（Codex / Claude Code / OpenCode 等）的 **Git 友好记忆 MCP Server**。

MemHub 将“用户决策、长期偏好、可复用知识”保存为 **Markdown 文件 + YAML Front Matter**，便于人读、审查、版本管理和协作。

---

## 为什么用 MemHub

- **Git 原生**：所有记忆都是纯文本文件，天然可 diff / 可回滚
- **面向 Agent**：通过 MCP（stdio）暴露工具，便于模型调用
- **人类可读**：元数据在 YAML，正文在 Markdown
- **质量可控**：内置 lint / typecheck / test / coverage 门禁

---

## 核心特性

- Markdown 持久化（`.md`）
- YAML Front Matter 元数据（`id / session_id / entry_type / tags / category / importance / 时间戳`）
- STM-first 双工具接口：`memory_load` + `memory_update`
- 并发 CLI 安全目录：`YYYY-MM-DD/session_uuid/...`
- MCP stdio server，可接入主流 MCP 客户端

---

## 快速开始

### 1）从 npm 安装

```bash
npm i @synth-coder/memhub
```

### 2）本地开发安装依赖

```bash
npm install
```

### 3）构建

```bash
npm run build
```

### 4）执行质量门禁
```bash
npm run quality
```

---

## 作为 MCP Server 使用（stdio）

### 方式 A：npx 直接运行（推荐）

```bash
npx -y @synth-coder/memhub
```

> Windows 下不要在包名后再加 `memhub` 参数。
> 如果出现“弹出源码 .js 文件”的情况，请升级到最新版本（`0.1.2+`）后重试。

在你的 MCP 客户端配置中添加：

```json
{
  "mcpServers": {
    "memhub": {
      "command": "npx",
      "args": ["-y", "@synth-coder/memhub"],
      "env": {
        "MEMHUB_STORAGE_PATH": "/绝对路径/你的记忆目录",
        "MEMHUB_LOG_LEVEL": "info"
      }
    }
  }
}
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

> 调用策略建议见：`docs/tool-calling-policy.md`（首轮 `memory_load`，末轮 `memory_update`）。

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
- [ ] 集成测试
- [ ] 性能优化
- [x] npm 发布（`@synth-coder/memhub@0.1.3`）

---

## License

MIT
