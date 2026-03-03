# Proposal: Close Remaining Quality Gates (Phase 2)

## Context
Current implementation already has broad functionality and passing test suites, but quality gates are still blocked by:

1. ESLint configuration/type-aware parsing issues on test files
2. TypeScript typecheck errors in server and storage/service imports
3. Coverage gate failure on function coverage (<80%)
4. Project path inconsistency (`workspace/workspace/memhub`)

## Root Causes
- ESLint `parserOptions.project` only pointed to `tsconfig.json`, while test files are not included there.
- Some implementation details introduced strict-mode lint/type mismatches (`any` usage, fallthrough, readonly/no-unused issues).
- Existing server tests focus on constants/contracts but not internal execution paths, leaving many functions uncovered.
- Project was scaffolded under a nested directory.

## Plan of Record

### Step 1 — Fix static quality gates
- Update ESLint type-aware project references to include test TS config.
- Update `tsconfig.test.json` include set.
- Fix strict lint/type issues in server/service/storage/utils modules.

### Step 2 — Raise function coverage to >=80%
- Add focused tests for MCP server runtime paths:
  - JSON parsing failure path
  - invalid request path
  - method dispatch (`initialize`, `tools/list`, `tools/call`, unknown method)
  - error handling (`ServiceError`, validation-like error, generic error)
  - response/error serialization
  - log filtering behavior
- Preserve existing passing behavior and avoid over-mocking core service logic.

### Step 3 — Validate full gate
Run and require pass for:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run test:coverage` (global lines/functions/branches/statements >= 80)

### Step 4 — Normalize repository location
- Move project to `C:\Users\cloud_user\.openclaw\workspace\memhub` (if missing).
- Verify scripts still run from new root.

## Acceptance Criteria
- No lint errors
- No typecheck errors
- All tests pass
- Coverage thresholds all >= 80%
- Repository available at normalized path

## Risks and Mitigations
- **Risk:** Private method tests become brittle.
  - **Mitigation:** Test externally visible behavior and error contracts where possible; keep internals tests focused and minimal.
- **Risk:** Path migration may break references.
  - **Mitigation:** Move whole directory atomically and rerun full gate.
- **Risk:** Coverage improvements skew test value.
  - **Mitigation:** Prefer behavior-driven tests over shallow line-hitting.
