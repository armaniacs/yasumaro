# Architecture Deepening Candidates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the five architecture-deepening candidates in dependency order while preserving SQLite error semantics, Dashboard response safety, Manifest V3 lifecycle behavior, security checks, retry behavior, and queue payload compatibility.

**Architecture:** First stabilize the existing SQLite `CallResult<T>` interface and the Dashboard handler/decode seams. Then move Background construction behind one production composition root with a shared `RecordingPipeline`. Finally remove the remaining step-name coupling from offline policy and recovery bookkeeping. Each phase is independently testable; tests cross the same interface as callers, and no new adapter is introduced unless two concrete adapters require the seam.

**Tech Stack:** TypeScript, Chrome Manifest V3, WXT, Vitest, Chrome storage/offscreen messaging, SQLite result contracts, `RecordingPipeline` metadata.

---

## Current baseline and constraints

- The working tree already contains partial work for all five candidates. Do not reset or overwrite it.
- Existing PBI: `pbi/2026-08-11-01-refactor-architecture-deepening-epic.md`.
- Existing child PBIs: `pbi/2026-08-10-01` through `pbi/2026-08-10-05`.
- `CONTEXT.md` is absent. Use existing domain names such as SQLite result contract, Dashboard SQLite, Background composition, RecordingPipeline, offline job, and migration.
- Preserve ADR decisions for `StorageBackend`, `NoopBackend`, `SQL_EXEC`, AI service unification, and panel lifecycle. Do not convert offscreen `StorageBackend` results mechanically into background `CallResult<T>`.
- Preserve sender trust levels, token gates, allowed update fields, response size limits, PII sanitization, MV3 async messaging, retry counts, queue payload compatibility, and binary backup/restore behavior.
- Run commands from repository root: `/Users/yaar/Playground/obsidian-smart-history`.
- Do not commit unless explicitly requested.

## Dependency order

```text
Phase 0: validate current working tree
    ↓
Phase 1: Candidate 1 — SQLite result contract completion
    ↓
Phase 2: Candidate 4 — Dashboard handler result mapping locality
    ↓
Phase 3: Candidate 3 — Dashboard SQLite response decoding completion
    ↓
Phase 4: Candidate 2 — Background composition root and shared RecordingPipeline
    ↓
Phase 5: Candidate 5 — RecordingPipeline offline policy completion
    ↓
Phase 6: full validation and documentation synchronization
```

Candidate 2 is deliberately not parallelized with Candidate 5 because both change `RecordingPipeline` ownership and lifecycle. Candidate 1 and Candidate 4 are kept sequential because Candidate 4 consumes Candidate 1's result contract.

---

### Task 1: Validate and inventory the existing partial implementation

**Files:**
- Read: `pbi/2026-08-11-01-refactor-architecture-deepening-epic.md`
- Read: `src/background/sqliteClient.ts`
- Read: `src/background/migrationService.ts`
- Read: `src/background/pendingSqliteQueue.ts`
- Read: `src/background/handlers/dashboardSqliteHandlers.ts`
- Read: `src/dashboard/dashboardSqliteService.ts`
- Read: `src/background/service-worker.ts`
- Read: `src/background/createBackgroundServices.ts`
- Read: `src/background/ServiceWorkerContext.ts`
- Read: `src/background/pipeline/RecordingPipeline.ts`
- Read: `src/background/pipeline/types.ts`

- [x] **Step 1: Confirm the working tree is not cleanly reset**

Run:

```bash
git status --short
git diff --check
```

Expected: the existing PBI and partial implementation changes remain present; `git diff --check` produces no whitespace errors.

- [x] **Step 2: Run the baseline checks before further edits**

Run:

```bash
npm run type-check
npm run validate
npm run build
```

Expected: type-check, the Vitest suite, and WXT build pass. If a failure occurs, fix the baseline regression before starting the next phase and record the concrete failing test in the task notes.

- [x] **Step 3: Create a candidate inventory from code, not assumptions**

Run:

```bash
rg -n "insertBatch\\(|insertBatchResult|insertAuditLog\\(|insertAuditLogResult|exportDb\\(|exportDbResult" src/background
rg -n "Number\\([^)]*\\|\\||Boolean\\(response|String\\(response" src/dashboard/dashboardSqliteService.ts
rg -n "createBackgroundServices|new SqliteClient|getSharedSqliteClient|createRecordingPipeline\\(|buildRecordingPipelineDeps\\(|recordingPipeline" src/background
rg -n "step\\.name ===|e\\.step ===|find\\(s => s\\.name|offlineRetry|previewBreakpoint" src/background/pipeline
```

Expected: the output is attached to the implementation notes and is used to define only the remaining edits. Do not change offscreen `StorageBackend` merely because it has an `insertBatch` method.

---

### Task 2: Complete Candidate 1 — SQLite result contract

**Files:**
- Modify: `src/background/sqliteClient.ts`
- Modify: `src/background/migrationService.ts`
- Modify: `src/background/pendingSqliteQueue.ts`
- Modify: `src/utils/auditLog.ts`
- Modify: `src/dashboard/encryptedBackupService.ts` only if it still calls a removed nullable background wrapper
- Test: `src/background/__tests__/sqliteClient-unit.test.ts`
- Test: `src/background/__tests__/sqliteClient-auditLog.test.ts`
- Test: `src/background/__tests__/migrationService-extra.test.ts`
- Test: `src/background/__tests__/migrationService-opfs.test.ts`
- Test: `src/background/__tests__/pendingSqliteQueue.test.ts`
- Test: `src/utils/__tests__/auditLog.test.ts`

- [x] **Step 1: Write or update contract tests for all remaining background callers**

Use the existing `CallResult<T>` shape:

```ts
const success = { success: true as const, data: { count: 2 } };
const failure = {
  success: false as const,
  error: { kind: 'sqlite_error', message: 'insert failed', retriable: false },
};
```

Tests must assert:

- `insertBatchResult` distinguishes partial success from failure.
- migration does not advance progress on failure.
- pending queue retains failed chunks.
- audit logging reports the failure message without throwing.
- export failure is not converted to an empty binary result.

- [x] **Step 2: Run the focused tests and confirm any old-interface failure**

Run:

```bash
npm test -- src/background/__tests__/sqliteClient-unit.test.ts src/background/__tests__/sqliteClient-auditLog.test.ts src/background/__tests__/migrationService-extra.test.ts src/background/__tests__/migrationService-opfs.test.ts src/background/__tests__/pendingSqliteQueue.test.ts src/utils/__tests__/auditLog.test.ts
```

Expected: tests fail only where a caller or test fixture still expects the removed nullable wrapper.

- [x] **Step 3: Remove remaining background nullable wrappers**

Use the existing pattern:

```ts
async insertBatchResult(records: BrowsingLogRecord[]): Promise<CallResult<{ count: number }>> {
  return this.call<{ count: number }, OffscreenCountResponse>(
    'SQLITE_INSERT_BATCH',
    { records: records as unknown as Record<string, unknown>[] },
    (response) => ({ count: response.count }),
  );
}
```

Apply the same contract to audit log insertion and export where those methods still use nullable results. Keep `getStatus()` outside `CallResult` because it intentionally returns diagnostics on failure.

- [x] **Step 4: Migrate every background caller and fixture**

Replace nullable handling with an explicit discriminant:

```ts
const result = await sqliteClient.insertBatchResult(batch);
if (!result.success) {
  // retain the batch or preserve migration progress
  return;
}
const inserted = result.data.count;
```

Do not use `result.data` before checking `result.success`. Do not map failure to `0`, an empty array, or an empty `Uint8Array`.

- [x] **Step 5: Run focused tests and type-check**

Run:

```bash
npm test -- src/background/__tests__/sqliteClient-unit.test.ts src/background/__tests__/sqliteClient-auditLog.test.ts src/background/__tests__/migrationService-extra.test.ts src/background/__tests__/migrationService-opfs.test.ts src/background/__tests__/pendingSqliteQueue.test.ts src/utils/__tests__/auditLog.test.ts
npm run type-check
```

Expected: focused tests pass and TypeScript reports no errors.

- [x] **Step 6: Remove only dead compatibility code**

After tests are green, remove old nullable method names and stale test descriptions. Do not remove `StorageBackend.insertBatch`; that is the offscreen adapter contract protected by the existing ADR.

- [x] **Step 7: Re-run the focused suite**

Expected: same tests pass after dead-code cleanup.

---

### Task 3: Complete Candidate 4 — Dashboard handler result mapping

**Files:**
- Modify: `src/background/handlers/dashboardSqliteHandlers.ts`
- Test: `src/background/handlers/__tests__/dashboardSqliteHandlers-wiring.test.ts`
- Test: `src/background/handlers/__tests__/dashboardSqliteHandlers.test.ts` if present

- [x] **Step 1: Add failure-mapping tests at the handler interface**

For every generic SQLite-backed operation, assert the handler preserves both fields:

```ts
expect(await handler({ subtype: 'get_count' })).toEqual({
  success: false,
  error: 'quota exceeded',
  retriable: true,
});
```

Include one case-specific test proving token mismatch still returns its dedicated error and one import test proving allowed fields and row limits remain enforced.

- [x] **Step 2: Run the handler tests to establish the failure**

Run:

```bash
npm test -- src/background/handlers/__tests__/dashboardSqliteHandlers-wiring.test.ts src/background/handlers/__tests__/dashboardSqliteHandlers.test.ts
```

Expected: new tests fail if any case drops `retriable` or formats errors differently.

- [x] **Step 3: Introduce one internal failure mapper**

Use a private helper with a narrow interface:

```ts
function toFailure<T>(result: DepsResult<T>): { success: false; error: string; retriable: boolean } {
  if (result.success) {
    throw new Error('Expected a failed SQLite result');
  }
  return {
    success: false,
    error: result.error.message,
    retriable: result.error.retriable,
  };
}
```

Only use it for generic `CallResult<T>` failures. Keep token validation, import partial success, binary response handling, and operation-specific response fields local to their cases.

- [x] **Step 4: Replace duplicate generic mappings**

For each generic failure branch, use:

```ts
if (!result.success) {
  return toFailure(result);
}
```

Do not collapse successful response shapes or alter security checks.

- [x] **Step 5: Run handler tests and type-check**

Expected: all handler tests pass and `npm run type-check` succeeds.

---

### Task 4: Complete Candidate 3 — Dashboard SQLite strict response decoding

**Files:**
- Modify: `src/dashboard/dashboardSqliteService.ts`
- Test: `src/dashboard/__tests__/dashboardSqliteService.test.ts`
- Test: `src/dashboard/__tests__/dashboardSqliteService-extra.test.ts`
- Test: `src/dashboard/__tests__/pbi18-selective-obsidian-append.test.ts`

- [x] **Step 1: Enumerate each response field and its contract**

Create a table in the test file or task notes before editing:

```text
count/read/inserted/updated/total/purged/appended/totalBytes: finite non-negative number
is_starred/skipped: boolean or the existing documented numeric flag, never implicit Boolean conversion
rows/removed/compileOptions: array when required, optional only where the existing status contract says so
data: validated binary payload for backup/restore
```

Do not apply this numeric decoder to status diagnostics or binary payloads.

- [x] **Step 2: Add boundary tests first**

For each required numeric field, cover:

```ts
undefined
null
'3'
Number.NaN
-1
0
3
```

Assert invalid values return `{ error: ... }` and valid zero remains successful. Add a test for malformed backup data that does not pass through numeric decoding.

- [x] **Step 3: Run the Dashboard tests**

Run:

```bash
npm test -- src/dashboard/__tests__/dashboardSqliteService.test.ts src/dashboard/__tests__/dashboardSqliteService-extra.test.ts src/dashboard/__tests__/pbi18-selective-obsidian-append.test.ts
```

Expected: newly added strictness tests fail before implementation.

- [x] **Step 4: Use explicit decoding helpers**

Keep helpers small and local to `dashboardSqliteService.ts`:

```ts
function requiredFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid SQLite response: ${field}`);
  }
  return value;
}

function requiredNonNegativeNumber(value: unknown, field: string): number {
  const number = requiredFiniteNumber(value, field);
  if (number < 0) throw new Error(`Invalid SQLite response: ${field}`);
  return number;
}
```

Use a dedicated boolean decoder for required booleans. Preserve intentional array fallbacks and status diagnostics.

- [x] **Step 5: Remove dangerous coercions**

Replace patterns such as:

```ts
Number(response.count || 0)
Number(response.total || 0)
Boolean(response.skipped)
```

with operation-specific validation. Preserve `0` as valid. Do not replace `appendToLogs` with an input-length fallback unless the response contract explicitly marks `appended` optional; the target contract is to reject missing required values.

- [x] **Step 6: Run Dashboard tests and type-check**

Expected: all Dashboard tests pass and `npm run type-check` succeeds.

---

### Task 5: Candidate 2 preparation — Add a production composition contract test

**Files:**
- Create or modify: `src/background/__tests__/backgroundComposition.test.ts`
- Read/modify: `src/background/createBackgroundServices.ts`
- Read/modify: `src/background/service-worker.ts`
- Read: `src/background/ServiceWorkerContext.ts`
- Read/modify: `src/background/handlers/messageHandlers.ts`
- Read/modify: `src/background/recordingLogic.ts`

- [x] **Step 1: Define the test seam without changing production wiring**

The test must observe a composition result containing the shared dependencies, not inspect private implementation details. The required assertions are:

```ts
expect(composition.sqliteClient).toBe(composition.dashboardSqliteClient);
expect(composition.recordingPipeline).toBe(composition.manualRecordDeps.recordingPipeline);
expect(composition.recordingPipeline).toBe(composition.saveRecordDeps.recordingPipeline);
```

If the current `BackgroundServices` interface cannot express these relationships, add the smallest internal composition type needed for the test. Do not expose it to popup or Dashboard code.

- [x] **Step 2: Run the new test and confirm it fails against duplicate construction**

Run:

```bash
npm test -- src/background/__tests__/backgroundComposition.test.ts
```

Expected: the test fails because production currently has inline construction and does not inject the shared pipeline into manual/save dependencies.

- [x] **Step 3: Replace direct SQLite construction in the composition module**

Use the existing shared accessor:

```ts
const sqliteClient = getSharedSqliteClient();
```

Do not use `new SqliteClient()` in the production composition module. Preserve session store, tab cache, rate limiter, AI service, and manual fetcher lifecycle.

- [x] **Step 4: Add a shared RecordingPipeline to the composition result**

Construct it once with the existing dependency builder:

```ts
const recordingPipeline = createRecordingPipeline(buildRecordingPipelineDeps({
  getPrivacyInfoWithCache: (url) => RecordingCache.getPrivacyInfoWithCache(url),
  obsidian,
  aiService,
  sqliteClient,
}));
```

Keep the `RecordingPipeline` interface small; the composition module owns construction details.

- [x] **Step 5: Inject the shared pipeline into manual and save handler dependencies**

Set both dependency objects to the same reference:

```ts
recordingPipeline,
```

Then remove handler-side fallback construction only after the composition test observes the injected reference.

- [x] **Step 6: Make Service Worker use the composition result**

Replace only the duplicated construction statements in `service-worker.ts`. Preserve all registry message types and trust levels. Do not move unrelated startup side effects into the composition module.

- [x] **Step 7: Resolve the third composition source**

Inspect `ServiceWorkerContext.ts`. If it is production code, make it consume the same composition factory. If it is test-only, move its construction helper into the test fixture rather than maintaining a second production composition. Delete only after all references and tests are migrated.

- [x] **Step 8: Remove fallback and dead factory code**

Remove:

- unused `createSharedRecordingPipeline` if the composition factory makes it unnecessary;
- handler-side `createRecordingPipeline(buildRecordingPipelineDeps(...))` fallback;
- any unused direct `new SqliteClient()` construction;
- unused dependency literals.

Run:

```bash
rg -n "new SqliteClient|createRecordingPipeline\\(|buildRecordingPipelineDeps\\(" src/background
```

Expected: one production composition construction path remains, plus explicit test fixtures where required.

- [x] **Step 9: Run composition and Service Worker tests**

Run:

```bash
npm test -- src/background/__tests__/backgroundComposition.test.ts src/background/__tests__/createBackgroundServices.test.ts src/background/__tests__/service-worker.test.ts src/background/__tests__/recordingLogic-coverage.test.ts
npm run type-check
npm run build
```

Expected: all tests, type-check, and build pass.

---

### Task 6: Candidate 5 — Complete RecordingPipeline offline policy locality

**Files:**
- Modify: `src/background/pipeline/types.ts`
- Modify: `src/background/pipeline/RecordingPipeline.ts`
- Modify: `src/background/recordingLogic.ts` only if retry payload handling requires it
- Test: `src/background/pipeline/__tests__/RecordingPipeline-offline-policy.test.ts`
- Test: `src/background/pipeline/__tests__/RecordingPipeline.test.ts`
- Test: `src/background/__tests__/recordingLogic-coverage.test.ts`

- [x] **Step 1: Add metadata-driven recovery tests**

Tests must verify:

- preview behavior is controlled by `previewBreakpoint`, not a step name;
- offline queue behavior is controlled by `offlineRetry.jobKind`;
- changing a step display name does not change the job kind;
- a non-offline step is never queued;
- an Obsidian failure still creates the expected pending recovery record without comparing `e.step` to `'saveObsidian'`.

- [x] **Step 2: Run the focused tests and confirm the remaining string dependency**

Run:

```bash
npm test -- src/background/pipeline/__tests__/RecordingPipeline-offline-policy.test.ts src/background/pipeline/__tests__/RecordingPipeline.test.ts src/background/__tests__/recordingLogic-coverage.test.ts
```

Expected: the recovery test fails until the `saveObsidian` string comparison is removed.

- [x] **Step 3: Carry recovery metadata with PipelineError**

Extend the internal `PipelineError` data with an optional recovery kind derived from the step metadata:

```ts
export interface PipelineError {
  step: string;
  error: Error;
  strategy: ErrorStrategy;
  timestamp: number;
  recoveryKind?: 'obsidian_sync' | 'ai_summary';
  context: {
    url: string;
    tabId?: number;
  };
}
```

When recording a non-fatal error, set:

```ts
recoveryKind: step.offlineRetry?.jobKind,
```

Then use `errors.find((error) => error.recoveryKind === 'obsidian_sync')` in `buildResult()`.

- [x] **Step 4: Remove unused error and step-name policy dependencies**

Pass the `PipelineStep` directly to offline enqueue, as already started. Remove unused parameters and avoid new lookups by step name. Keep step names for human-readable logs only.

- [x] **Step 5: Preserve or explicitly validate retry payload semantics**

Before adding fields, inspect `retryObsidianWriteOnly` and `offlineQueueProcessor.ts`. If the existing retry path intentionally regenerates Markdown from summary/tags, retain that contract and add a test. If generated Markdown is required for data fidelity, add it to the queue payload and update both the producer and consumer together, preserving backward compatibility for old queued jobs.

- [x] **Step 6: Run the focused policy tests**

Expected: policy tests pass, including renamed-step behavior and recovery behavior.

---

### Task 7: Full integration verification and cleanup

**Files:**
- Modify: only files identified by failing tests or stale PBI references
- Update: `pbi/2026-08-11-01-refactor-architecture-deepening-epic.md`
- Update: `pbi/00-INDEX.md` only if status conventions require it

- [x] **Step 1: Run the complete validation suite**

Run:

```bash
npm run validate
npm run build
git diff --check
```

Expected:

- `npm run validate` passes all non-skipped tests;
- `npm run build` creates `dist/chromium-mv3` successfully;
- `git diff --check` reports no errors.

- [x] **Step 2: Search for prohibited remnants**

Run:

```bash
rg -n "Number\\([^)]*\\|\\| 0|e\\.step === 'saveObsidian'|step\\.name === 'privacyPipeline'|new SqliteClient\\(\)" src/background src/dashboard
```

Expected: no prohibited result coercion or step-policy string comparison remains. Any remaining `new SqliteClient()` must be a deliberate test fixture or documented exception.

- [x] **Step 3: Verify security and MV3 invariants**

Review the diff for:

- token mismatch handling;
- sender trust levels;
- allowed update fields;
- PII stripping before responses;
- offscreen-only DOM/Web API usage;
- `return true` for async message channels;
- no new Service Worker persistent state;
- no secret or API key changes.

- [x] **Step 4: Update the Epic checklist**

Mark only criteria proven by tests or source inspection. In particular:

- SQLite failure/zero/empty distinction;
- strict Dashboard decode;
- one production composition root;
- metadata-based offline policy;
- all validation commands.

Do not mark production composition complete if `service-worker.ts` still constructs its own clients or handlers still construct pipelines per message.

- [x] **Step 5: Leave the working tree ready for review**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

Do not commit, push, or create a pull request unless separately requested.

---

## Failure protocol

If an implementation or test failure occurs, first classify it as one of:

1. stale test fixture using the old interface;
2. real behavior regression;
3. invalid assumption about an existing ADR or lifecycle;
4. environment/tool invocation error.

For categories 1–3, perform at least 15 why rounds before selecting a fix. Record the root cause and chosen correction next to the task in the implementation session, then continue from the failed step. For category 4, correct the command or environment without changing production behavior.

## Completion criteria

The plan is complete only when:

- all five candidates have either been implemented or explicitly proven already complete;
- no caller interprets SQLite failure as zero, empty, or success;
- Dashboard response decoding rejects malformed required fields;
- one production composition root owns shared clients and the RecordingPipeline;
- offline policy and recovery bookkeeping are metadata-driven rather than step-name-driven;
- `npm run type-check`, `npm run validate`, `npm run build`, and `git diff --check` pass;
- the Epic checklist reflects verified reality.

## Verification results

Recorded on 2026-08-11 against the working tree.

| Check | Result |
|---|---|
| `npm run type-check` | pass (`tsc --noEmit`, no diagnostics) |
| `npm run validate` | pass — 427 test files, 7778 tests passed, 18 skipped |
| `npm run build` | pass — `dist/chromium-mv3`, 6.79 MB total |
| `src/background` focused suite | pass — 119 files, 1681 tests, 8 skipped |

Invariants confirmed by grep over `src/` and `entrypoints/`:

- `createRecordingPipeline` is called from exactly one production site, `createBackgroundServices.ts:83`.
- `new RecordingLogic(` appears once in production (`createBackgroundServices.ts:90`) and once in the test helper.
- `ServiceWorkerContext` has no remaining references.

## Remaining scope

Candidates 1–5 are complete. The following were deliberately left out of this plan.

**Composition root.** Dependency construction is unified in `createBackgroundServices`, but handler registration is not: the 26 `registry.register(TYPE, handler, trustLevel)` calls still live in `service-worker.ts`. Moving them would give the composition module responsibility for MV3 startup ordering, which top-level synchronous listener registration constrains. The prerequisite for any such move is a test that covers the trust level of all 26 registrations — trust level errors are caught by neither the type checker nor the current representative-case tests. Do the coverage first, then reconsider the move.

**Offline retry payload.** Behavior was fixed by contract test, not changed. `obsidian_sync` retries regenerate Markdown from `summary`/`tags`; `maskedCount` is carried in the payload but unused, and the SQLite/metadata steps do not re-run on that path.

**Dashboard decoding.** The `opfsMigrationV2*` status fields pass through without dedicated decoders. The required status fields are strictly decoded.
