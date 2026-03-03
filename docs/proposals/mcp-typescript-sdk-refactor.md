# 提案：使用 @modelcontextprotocol/sdk 重构 MCP 实现

> 状态：草案  
> 创建日期：2026-03-03  
> 作者：iFlow CLI  

## 1. 执行摘要

本提案旨在使用官方 `@modelcontextprotocol/sdk` 重构 memhub 的 MCP 服务器实现，以消除重复造轮子，降低维护成本，并获得官方 SDK 提供的协议兼容性、错误处理和生命周期管理等功能。

## 2. 当前问题与重复实现清单

### 2.1 当前架构分析

memhub 目前自行实现了完整的 MCP 协议栈，包括：

| 组件 | 当前实现 | SDK 提供 | 重复程度 |
|------|----------|----------|----------|
| JSON-RPC 协议处理 | `src/server/mcp-server.ts` 中手动解析/序列化 | ✅ 内置 | 完全重复 |
| 请求/响应类型定义 | `src/contracts/mcp.ts` 中自定义 | ✅ 内置 | 完全重复 |
| 错误码定义 | `ERROR_CODES` 常量 | ✅ 内置 | 完全重复 |
| 生命周期管理 | 手动处理 `initialize`/`shutdown`/`exit` | ✅ 内置 | 完全重复 |
| 工具注册与分发 | 手动实现 `TOOLS_LIST`/`TOOLS_CALL` | ✅ `server.registerTool()` | 完全重复 |
| stdio 传输层 | 手动读写 `process.stdin`/`stdout` | ✅ `StdioServerTransport` | 完全重复 |
| 消息缓冲处理 | 手动按行分割处理 | ✅ 内置 | 完全重复 |
| 通知处理 | 手动处理 `notifications/initialized` | ✅ 内置 | 完全重复 |

### 2.2 重复实现代码清单

#### 2.2.1 JSON-RPC 协议层（约 150 行）

**文件**: `src/server/mcp-server.ts:85-180`

```typescript
// 当前自行实现的 JSON-RPC 处理
private async handleMessage(message: string): Promise<void> {
  let request: JsonRpcRequest | null = null;
  try {
    request = JSON.parse(message) as JsonRpcRequest;
  } catch {
    this.sendError(null, ERROR_CODES.PARSE_ERROR, 'Parse error: Invalid JSON');
    return;
  }
  // 验证、路由、响应... 全部手动实现
}
```

**SDK 替代方案**:
```typescript
// SDK 自动处理
const transport = new StdioServerTransport();
await server.connect(transport); // 自动处理所有 JSON-RPC 协议细节
```

#### 2.2.2 类型定义（约 200 行）

**文件**: `src/contracts/mcp.ts`

当前自定义的类型：
- `JsonRpcRequest` / `JsonRpcResponse` / `JsonRpcError`
- `InitializeParams` / `InitializeResult`
- `Tool` / `ToolInputSchema` / `ToolCallRequest` / `ToolCallResult`
- `TextContent` / `ImageContent`
- `ERROR_CODES` 常量

**SDK 提供**: `@modelcontextprotocol/sdk` 已导出所有这些类型。

#### 2.2.3 工具注册系统（约 80 行）

**文件**: `src/server/mcp-server.ts:180-250`

当前手动实现工具路由：
```typescript
private async handleToolCall(request: ToolCallRequest): Promise<ToolCallResult> {
  const { name, arguments: args } = request;
  switch (name) {
    case 'memory_load': /* ... */
    case 'memory_update': /* ... */
    default: throw new ServiceError(`Unknown tool: ${name}`, ErrorCode.METHOD_NOT_FOUND);
  }
}
```

**SDK 替代方案**:
```typescript
server.registerTool(
  "memory_load",
  { description: "...", inputSchema: { /* zod schema */ } },
  async (args) => { /* handler */ }
);
```

#### 2.2.4 stdio 传输层（约 60 行）

**文件**: `src/server/mcp-server.ts:55-85`

当前手动处理：
```typescript
process.stdin.setEncoding('utf-8');
let buffer = '';
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (line.trim()) void this.handleMessage(line.trim());
  }
});
```

**SDK 替代方案**:
```typescript
const transport = new StdioServerTransport();
await server.connect(transport);
```

### 2.3 维护风险

1. **协议兼容性风险**: MCP 协议版本更新时，需手动同步所有类型定义和逻辑
2. **错误处理不完整**: 当前实现可能遗漏边缘情况的错误处理
3. **缺少高级特性**: 如进度通知、取消请求、分页等 MCP 高级特性需自行实现
4. **测试负担**: 需自行测试协议合规性，而非依赖 SDK 的测试覆盖

## 3. 基于 @modelcontextprotocol/sdk 的目标架构

### 3.1 SDK 核心 API 概览

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// 1. 创建服务器实例
const server = new Server({
  name: "memhub",
  version: "1.0.0"
}, {
  capabilities: {
    tools: { listChanged: false },
    logging: {}
  }
});

// 2. 注册工具
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // 工具调用处理
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  // 返回工具列表
});

// 3. 连接传输层
const transport = new StdioServerTransport();
await server.connect(transport);
```

### 3.2 目标架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      MCP Client                             │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ stdio (JSON-RPC)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              @modelcontextprotocol/sdk                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Server    │  │   Stdio     │  │  Request Handlers   │  │
│  │   Class     │◄─┤ Transport   │◄─┤  (tools/resources)  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    memhub 业务层                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Memory    │  │   Memory    │  │   Tool Handlers     │  │
│  │   Service   │  │   Storage   │  │   (load/update)     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 保留的自定义实现

以下组件将继续保留，因为它们属于业务逻辑而非协议层：

| 组件 | 保留原因 |
|------|----------|
| `MemoryService` | 业务逻辑层，处理内存的加载/更新 |
| `MarkdownStorage` | 存储层，处理 Markdown 文件读写 |
| `FrontmatterParser` | 数据解析层，处理 YAML Front Matter |
| Zod Schemas | 输入验证，与 SDK 的 Zod 依赖兼容 |
| `types.ts` 中的业务类型 | `Memory`, `MemoryEntryType` 等 |

## 4. 分阶段迁移步骤

### 阶段 1：准备与依赖（第 1 周）

**目标**: 添加 SDK 依赖，保持现有代码不变

**任务清单**:
- [ ] 安装 `@modelcontextprotocol/sdk` 依赖
- [ ] 验证 Zod 版本兼容性（SDK 需要 Zod v3.25+）
- [ ] 创建新的 `src/server/mcp-server-new.ts` 作为重构目标
- [ ] 编写 SDK 版本的 Server 初始化代码

**代码变更**:
```bash
npm install @modelcontextprotocol/sdk
```

```typescript
// src/server/mcp-server-new.ts (新建)
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
```

### 阶段 2：工具迁移（第 2 周）

**目标**: 将工具注册迁移到 SDK API

**任务清单**:
- [ ] 实现 `ListToolsRequestSchema` 处理器
- [ ] 实现 `CallToolRequestSchema` 处理器
- [ ] 将 `memory_load` 工具逻辑封装为 handler
- [ ] 将 `memory_update` 工具逻辑封装为 handler
- [ ] 复用现有的 Zod schema 进行输入验证

**代码对比**:

**当前方式**:
```typescript
// src/server/mcp-server.ts
private async handleToolCall(request: ToolCallRequest): Promise<ToolCallResult> {
  const { name, arguments: args } = request;
  switch (name) {
    case 'memory_load': {
      const input = MemoryLoadInputSchema.parse(args ?? {});
      result = await this.memoryService.memoryLoad(input);
      break;
    }
    // ...
  }
}
```

**SDK 方式**:
```typescript
// src/server/mcp-server-new.ts
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  switch (name) {
    case 'memory_load': {
      const input = MemoryLoadInputSchema.parse(args ?? {});
      const result = await memoryService.memoryLoad(input);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
    // ...
  }
});
```

### 阶段 3：测试与验证（第 3 周）

**目标**: 确保功能一致性

**任务清单**:
- [ ] 更新单元测试以支持新的 server 实例化方式
- [ ] 运行集成测试验证工具调用流程
- [ ] 验证错误处理行为一致
- [ ] 验证日志输出格式
- [ ] 性能对比测试（如有必要）

**测试策略**:
```typescript
// test/server/mcp-server-sdk.test.ts (新建)
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"; // 如有提供

describe('McpServer with SDK', () => {
  it('should handle initialize request', async () => {
    // 测试初始化流程
  });
  
  it('should list tools', async () => {
    // 测试工具列表
  });
  
  it('should call memory_load tool', async () => {
    // 测试工具调用
  });
});
```

### 阶段 4：切换与清理（第 4 周）

**目标**: 正式切换到 SDK 实现，清理旧代码

**任务清单**:
- [ ] 将 `mcp-server-new.ts` 重命名为 `mcp-server.ts`
- [ ] 删除 `src/contracts/mcp.ts` 中的协议类型（保留业务类型）
- [ ] 更新入口文件 `src/server/index.ts`
- [ ] 更新 `src/index.ts` 导出
- [ ] 删除旧的测试文件或更新为新的测试方式
- [ ] 运行完整质量门禁

**文件变更清单**:
```
修改:
- src/server/mcp-server.ts (完全重写)
- src/server/index.ts (更新导出)
- src/contracts/mcp.ts (删除协议类型，保留工具定义)
- package.json (添加依赖)

删除:
- (可选) src/contracts/mcp.ts 中的部分类型定义
```

## 5. 风险与回滚策略

### 5.1 风险识别

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| SDK API 与现有实现行为不一致 | 中 | 高 | 阶段 3 全面测试，保留旧代码分支 |
| Zod 版本冲突 | 低 | 中 | 验证 Zod v3.25+ 兼容性 |
| 性能退化 | 低 | 中 | 阶段 3 性能基准测试 |
| SDK 依赖增加包体积 | 低 | 低 | 评估 tree-shaking 效果 |
| 协议版本不匹配 | 低 | 高 | 验证 SDK 支持的协议版本 |

### 5.2 回滚策略

**预发布验证**:
1. 在 `beta` 分支完成所有迁移工作
2. 发布 `v0.2.0-beta.1` 版本进行内部测试
3. 验证通过后再合并到 `main`

**紧急回滚**:
```bash
# 如发现问题，立即回滚到上一版本
git revert <migration-commit>
npm run quality  # 验证回滚后状态
npm version patch
npm publish
```

**代码保留**:
- 阶段 1-3 期间保留旧的 `mcp-server.ts` 为 `mcp-server-legacy.ts`
- 仅在阶段 4 确认稳定后才删除旧代码

## 6. 测试与验收标准

### 6.1 功能测试矩阵

| 测试场景 | 测试方法 | 验收标准 |
|----------|----------|----------|
| 服务器初始化 | 单元测试 | 正确响应 `initialize` 请求 |
| 工具列表 | 单元测试 | 返回 `memory_load` 和 `memory_update` |
| memory_load 调用 | 集成测试 | 正确加载内存数据 |
| memory_update 调用 | 集成测试 | 正确创建/更新内存 |
| 错误处理 | 单元测试 | 返回标准 JSON-RPC 错误格式 |
| 无效工具名 | 单元测试 | 返回 `METHOD_NOT_FOUND` |
| 参数验证失败 | 单元测试 | 返回 `INVALID_PARAMS` |
| 服务器关闭 | 单元测试 | 正确处理 `shutdown`/`exit` |
| 通知消息 | 单元测试 | 正确处理 `notifications/initialized` |

### 6.2 兼容性测试

- [ ] 与 Claude Desktop 集成测试
- [ ] 与 Cursor 集成测试
- [ ] 与其他 MCP 客户端集成测试

### 6.3 质量门禁

所有以下检查必须通过：

```bash
npm run lint        # ESLint 无错误
npm run typecheck   # TypeScript 类型检查通过
npm run test        # 所有测试通过
npm run test:coverage  # 覆盖率 >= 80%
```

### 6.4 验收检查清单

- [ ] 所有现有测试用例通过（无需修改测试断言）
- [ ] 新的测试覆盖 SDK 集成点
- [ ] 代码覆盖率不低于重构前
- [ ] 手动验证与 Claude Desktop 的集成
- [ ] README 文档更新（如需要）

## 7. 预计受影响文件列表

### 7.1 核心文件变更

| 文件路径 | 变更类型 | 变更说明 |
|----------|----------|----------|
| `package.json` | 修改 | 添加 `@modelcontextprotocol/sdk` 依赖 |
| `package-lock.json` | 修改 | 依赖锁定文件更新 |
| `src/server/mcp-server.ts` | 重写 | 使用 SDK 的 Server 类重写 |
| `src/server/index.ts` | 修改 | 更新导出（如有必要） |
| `src/contracts/mcp.ts` | 修改 | 删除协议相关类型定义，保留工具定义 |

### 7.2 测试文件变更

| 文件路径 | 变更类型 | 变更说明 |
|----------|----------|----------|
| `test/server/mcp-server.test.ts` | 修改 | 适配新的 Server 类结构 |
| `test/server/mcp-server-internals.test.ts` | 删除/重写 | SDK 封装了内部方法，需重写测试 |

### 7.3 不受影响文件（业务逻辑层）

以下文件完全不受影响：

- `src/services/memory-service.ts`
- `src/storage/markdown-storage.ts`
- `src/storage/frontmatter-parser.ts`
- `src/contracts/schemas.ts`
- `src/contracts/types.ts`
- `src/utils/slugify.ts`
- `test/services/*.test.ts`
- `test/storage/*.test.ts`

## 8. 附录

### 8.1 SDK 参考资源

- **NPM 包**: `@modelcontextprotocol/sdk`
- **GitHub**: https://github.com/modelcontextprotocol/typescript-sdk
- **文档**: https://modelcontextprotocol.io/docs/develop/build-server
- **v1.x 分支**: https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x

### 8.2 SDK 关键 API 示例

#### 8.2.1 完整的 SDK 服务器示例

```typescript
#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// 创建服务器
const server = new Server(
  {
    name: "memhub",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 工具定义
const TOOLS = [
  {
    name: "memory_load",
    description: "STM first step. Call at the first turn...",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        sessionId: { type: "string" },
        // ...
      },
    },
  },
  {
    name: "memory_update",
    description: "STM write-back step...",
    inputSchema: {
      type: "object" as const,
      properties: {
        content: { type: "string" },
        // ...
      },
      required: ["content"],
    },
  },
];

// 注册处理器
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  switch (name) {
    case "memory_load": {
      // 调用 MemoryService
      const result = await memoryService.memoryLoad(args as MemoryLoadInput);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
    case "memory_update": {
      // 调用 MemoryService
      const result = await memoryService.memoryUpdate(args as MemoryUpdateInput);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MemHub MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

### 8.3 变更估算

| 指标 | 估算 |
|------|------|
| 预计删除代码行数 | ~350 行（协议层实现） |
| 预计新增代码行数 | ~150 行（SDK 集成） |
| 净减少代码行数 | ~200 行 |
| 预计开发时间 | 4 周（按阶段） |
| 测试覆盖率要求 | >= 80% |

---

## 9. 结论

使用 `@modelcontextprotocol/sdk` 重构 memhub 的 MCP 实现将带来以下收益：

1. **减少维护负担**: 消除 ~350 行协议层代码，由官方 SDK 维护
2. **提高可靠性**: 利用 SDK 的测试覆盖和协议合规性
3. **易于扩展**: SDK 提供的高级特性（进度通知、取消等）可直接使用
4. **未来兼容**: SDK 会跟随 MCP 协议更新，无需手动同步

建议按阶段执行此重构，确保每个阶段的质量门禁通过后再进入下一阶段。
