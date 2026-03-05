## 1. Preparation

- [x] 1.1 Audit all types in types.ts and identify which have corresponding schemas
- [x] 1.2 Identify types without schemas that need new schema definitions
- [x] 1.3 Ensure all schemas have proper `.readonly()` for readonly array fields

## 2. Schema Updates

- [x] 3.1 Add missing schemas for types that only exist in types.ts ( if any)
- [x] 2.2 Add type exports to schemas.ts using `export type X = z.infer<typeof XSchema>`
- [x] 2.3 Verify readonly semantics are preserved in inferred types

## 3. Types Refactoring

- [x] 3.1 Remove duplicate interface definitions from types.ts (Memory, SearchResult, ListResult, etc.)
- [x] 3.2 Add re-exports from schemas.ts in types.ts: `export type { Memory, ... } from './schemas.js'`
- [x] 3.3 Keep utility types (DeepReadonly, Nullable, RequiredFields) in types.ts
- [x] 3.4 Keep ErrorCode enum in types.ts
- [x] 3.5 Keep simple type aliases (UUID, ISO8601Timestamp, Slug) in types.ts

## 4. Verification

- [x] 4.1 Run `pnpm run typecheck` to verify all imports resolve correctly
- [x] 4.2 Run `pnpm run test` to ensure no runtime regressions
- [x] 4.3 Run `pnpm run quality` for full quality gate

## 5. Cleanup

- [x] 5.1 Remove any unused type definitions
- [x] 5.2 Add JSDoc comments explaining the type inference pattern
- [x] 5.3 Update CLAUDE.md/AGENTS.md if coding conventions change
