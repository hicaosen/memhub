## Context

MemHub 项目当前维护两套类型定义：
- `src/contracts/types.ts`: 手写的 TypeScript 接口（约 200 行）
- `src/contracts/schemas.ts`: Zod schema 定义（约 300 行）

两套定义存在以下问题：
1. 类型漂移风险：`Memory.updatedAt` 在 types.ts 中不是 readonly，但语义上应该是
2. 新增字段需同时修改两处
3. 约 30+ 个文件从 types.ts 导入类型

## Goals / Non-Goals

**Goals:**
- 统一类型来源，从 Zod schema infer 所有业务类型
- 保持 100% 向后兼容，不破坏现有 import 路径
- 删除重复定义，减少维护成本

**Non-Goals:**
- 不改变任何运行时行为或 API
- 不修改 schema 的验证规则
- 不引入新的依赖

## Decisions

### D1: 类型导出策略

**选择**: 从 `schemas.ts` 导出所有 infer 类型，在 `types.ts` 中重新导出

**理由**:
- 保持 `import type { Memory } from './types.js'` 的现有用法不变
- 符合 Zod 推荐实践
- 最小化改动范围

**备选方案**:
- A) 所有文件改从 `schemas.ts` 导入 → 改动太大，30+ 文件需修改
- B) 合并两个文件 → 违反单一职责，类型定义和验证逻辑应分离

### D2: 保留 types.ts 中的内容

**保留**:
- 工具类型 (`DeepReadonly`, `Nullable`, `RequiredFields`)
- 枚举 (`ErrorCode`)
- 不需要运行时验证的简单类型别名 (`UUID`, `ISO8601Timestamp`, `Slug`)

**删除**:
- 与 schemas.ts 重复的接口 (`Memory`, `CreateMemoryInput`, `SearchResult` 等)

### D3: Schema 的 readonly 处理

**选择**: 在 schema 定义中使用 `.readonly()` 方法确保数组字段为 readonly

**理由**: `z.infer` 会保留 schema 中定义的 readonly 属性

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| 类型签名微妙变化导致编译错误 | 运行 `pnpm run typecheck` 确保无错误 |
| readonly 属性丢失 | 使用 `z.array().readonly()` 保持 readonly 语义 |
| 循环依赖 | types.ts 只从 schemas.ts re-export，不引入其他模块 |

## Migration Plan

1. **Phase 1**: 在 schemas.ts 中添加缺失的类型导出（确保所有类型都有 schema）
2. **Phase 2**: 在 types.ts 中用 `export type X = z.infer<typeof XSchema>` 替换手写接口
3. **Phase 3**: 运行 typecheck 确保所有引用正常工作
4. **Phase 4**: 运行完整测试套件确保无运行时问题
