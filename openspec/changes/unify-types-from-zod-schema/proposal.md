# Proposal: Unify Types from Zod Schema

## Why

`types.ts` 和 `schemas.ts` 中存在重复的类型定义，手写的 TypeScript 接口与 Zod schema 推断的类型需要并行维护，容易出现不一致（如 `Memory.updatedAt` 在 `types.ts` 中不是 `readonly`）。Zod 推荐直接从 schema infer 类型，确保运行时验证与静态类型始终一致。

## What Changes

- 删除 `types.ts` 中与 `schemas.ts` 重复的手写接口定义
- 将所有类型从 Zod schema 导出 (`z.infer<typeof XxxSchema>`)
- 保持向后兼容：从 `schemas.ts` 重新导出类型，现有 import 路径继续工作
- 更新所有引用这些类型的文件
- 保留 `types.ts` 中的工具类型（如 `DeepReadonly`, `Nullable`）和枚举（如 `ErrorCode`）

## Capabilities

### New Capabilities

- `zod-type-inference`: 统一类型定义，从 Zod schema 推断所有业务类型

### Modified Capabilities

无（此重构不影响外部 API 行为，仅改变内部类型定义方式）

## Impact

- **Affected Files**: `src/contracts/types.ts`, `src/contracts/schemas.ts`, 以及所有导入这两个文件的模块
- **API Compatibility**: 保持完全兼容，类型名称不变
- **Dependencies**: 无新增依赖
- **Breaking Changes**: 无（内部重构）
