## ADDED Requirements

### Requirement: Types MUST be inferred from Zod schemas

所有业务类型 MUST 从对应的 Zod schema 通过 `z.infer` 推断，确保运行时验证与静态类型一致。

#### Scenario: Memory type is inferred from schema

- **WHEN** 开发者导入 `Memory` 类型
- **THEN** 类型定义 MUST 等价于 `z.infer<typeof MemorySchema>`

#### Scenario: Input types are inferred from schemas

- **WHEN** 开发者导入 `CreateMemoryInput` 或 `UpdateMemoryInput` 类型
- **THEN** 类型定义 MUST 从对应的 schema 推断

### Requirement: Existing import paths MUST remain functional

现有代码的 import 路径 MUST 继续工作，确保向后兼容。

#### Scenario: Import from types.ts still works

- **WHEN** 代码使用 `import type { Memory } from './types.js'`
- **THEN** 编译 MUST 成功且类型正确

#### Scenario: Import from schemas.ts also works

- **WHEN** 代码使用 `import { MemorySchema } from './schemas.js'`
- **THEN** 可以同时获取 schema 和类型

### Requirement: Readonly semantics MUST be preserved

类型的 readonly 语义 MUST 保持不变。

#### Scenario: Array fields remain readonly

- **WHEN** 使用 `Memory.tags` 类型
- **THEN** 类型 MUST 为 `readonly string[]`

#### Scenario: Immutable fields remain readonly

- **WHEN** 使用 `Memory.id` 类型
- **THEN** 属性 MUST 为 `readonly`
