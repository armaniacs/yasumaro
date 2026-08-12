# errorMessage() Retain-As-Is Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document why `errorMessage()` is retained as-is (no behavioural change) so future reviewers don't re-propose its removal.

**Architecture:** No code change to behaviour. A comment is added to `errorMessage` recording the deletion-test rationale. This PBI exists to prevent re-litigation, not to refactor.

**Tech Stack:** TypeScript (ESM), Vitest (verification only).

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/utils/errorUtils.ts` | **Modify** — add deletion-test rationale comment to `errorMessage` |
| `pbi/2026-08-12-07-refactor-errorMessage-retain-as-is.md` | (existing) records the decision |

---

### Task 1: Add rationale comment to errorMessage

**Files:**
- Modify: `src/utils/errorUtils.ts` (lines 1-7)

- [ ] **Step 1: Read current file**

```typescript
// src/utils/errorUtils.ts (current)
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 2: Add the rationale comment**

Replace the file content with:

```typescript
/**
 * Extract a string message from any error value.
 * Replaces the `error instanceof Error ? error.message : String(error)` pattern.
 *
 * Retained as-is (PBI-2026-08-12-07): the deletion test confirms value.
 * Removing this function would scatter `error instanceof Error ? error.message
 * : String(error)` across its ~58 call sites — the complexity re-appears, so the
 * function earns its keep (concentrates, does not just move). It is a pure
 * function with no state and no variation, so there is no interface to deepen.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (comment-only change)

- [ ] **Step 4: Commit**

```bash
git add src/utils/errorUtils.ts
git commit -m "docs(logger): record errorMessage retention rationale (PBI-07)"
```

---

### Task 2: Verify no behavioural change

**Files:** none new

- [ ] **Step 1: Run errorUtils-dependent tests**

Run: `npx vitest run src --grep errorMessage 2>/dev/null || npx vitest run src/utils`
Expected: PASS (behaviour unchanged, comment-only edit)

- [ ] **Step 2: Grep call-site count for reference**

Run: `grep -rn "errorMessage(" src --include=*.ts | wc -l`
Expected: ~58 (unchanged from pre-PBI baseline)

- [ ] **Step 3: No commit needed**

Verification only; Task 1 already committed.

---

## Self-Review

**Spec coverage:**
- errorMessage retained, comment added → Task 1 ✅
- no behavioural change → Task 2 ✅
- deletion-test rationale documented → Task 1 ✅

**Placeholder scan:** No TBD. Comment is complete.

**Type consistency:** `errorMessage` signature unchanged.

**Scope check:** Documentation-only change. No decomposition.
