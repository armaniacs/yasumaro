# Save alreadyProcessed PII Bypass Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `alreadyProcessed: true` from the `save` source policy so SAVE_RECORD masks PII before cloud AI summarization.

**Architecture:** One-line policy deletion in the source-policy table plus a pipeline-level regression test. The `alreadyProcessed` mechanism itself is preserved (pinned by existing tests as a legitimate direct input).

**Tech Stack:** TypeScript (nodeNext, `.js` import extensions), Vitest (`npx vitest run <file>`), `npm run validate` gate.

---

## File Structure

- Modify: `src/background/recordRequestBuilder.ts:73` — delete `alreadyProcessed: true` from the `save` row (1 line).
- Modify: `src/background/__tests__/recordRequestBuilder.test.ts:17-20` — update the `save` expectation (remove `alreadyProcessed: true`).
- Modify: `src/background/__tests__/privacyPipeline.test.ts` — append one regression test (save-equivalent path masks before cloud AI). No other production or test changes.

## PBI

`dev-docs/archived/pbi/2026-10-10-14-fix-save-alreadyprocessed-pii-bypass.md`

---

### Task 1: Update the save policy expectation (red)

**Files:**
- Modify: `src/background/__tests__/recordRequestBuilder.test.ts:17-20`
- Test: `src/background/__tests__/recordRequestBuilder.test.ts`

- [ ] **Step 1: Change the save expectation to the post-fix policy**

Replace lines 17-20:

```ts
    expect(buildRecordRequest('save', base)).toEqual({
      title: 'T', url: 'https://example.com', content: 'c',
      skipDuplicateCheck: true, recordType: 'manual',
    });
```

(Remove only `alreadyProcessed: true`. All other rows are untouched.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/background/__tests__/recordRequestBuilder.test.ts`
Expected: FAIL on `applies the per-source policy table` — received object contains `alreadyProcessed: true`, expected object does not.

- [ ] **Step 3: Commit the red test**

```bash
git add src/background/__tests__/recordRequestBuilder.test.ts
git commit -m "test: pin save policy without alreadyProcessed (red)"
```

### Task 2: Delete the flag from the save policy (green)

**Files:**
- Modify: `src/background/recordRequestBuilder.ts:73`

- [ ] **Step 1: Remove the flag**

Replace line 73:

```ts
  'save': { skipDuplicateCheck: true, recordType: 'manual' },
```

(Delete only `alreadyProcessed: true,` — the comma and spacing must leave valid syntax. Do NOT touch `_buildSanitizedSettings`, `privacyPipeline.ts`, or any other policy row.)

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run src/background/__tests__/recordRequestBuilder.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 3: Commit**

```bash
git add src/background/recordRequestBuilder.ts src/background/__tests__/recordRequestBuilder.test.ts
git commit -m "fix: drop alreadyProcessed from save policy so SAVE_RECORD masks PII"
```

### Task 3: Add the pipeline-level regression test (red)

**Files:**
- Modify: `src/background/__tests__/privacyPipeline.test.ts` (append inside `describe('process', ...)`)

The existing pin test `actually calls cloud AI ... even when alreadyProcessed=true` (`:515-537`) stays untouched — it covers the mechanism as a direct input. The new test covers the save-equivalent path (no flag) end to end through `buildRecordRequest`.

- [ ] **Step 1: Append the failing test**

Add the import at the top with the other imports:

```ts
import { buildRecordRequest } from '../recordRequestBuilder.js';
```

Append this test after the `alreadyProcessed=true` test (after line 537, inside the same describe block):

```ts
    it('masks PII before cloud AI on the save-equivalent path (no alreadyProcessed flag)', async () => {
      const maskedCloudSettings = { [StorageKeys.PRIVACY_MODE]: 'masked_cloud' };
      const mockCloudService = {
        getSupportedModes: vi.fn().mockReturnValue(['full_pipeline']),
        generateSummary: vi.fn().mockResolvedValue({ summary: 'Cloud summary' }),
      } as any;
      const sanitizers = { sanitizeRegex: vi.fn().mockReturnValue({ text: 'MASKED TEXT', maskedItems: [{ type: 'email', original: 'user@example.com' }] }) };
      const pipeline = new PrivacyPipeline(maskedCloudSettings, asAIService(mockCloudService), sanitizers);

      const promptSanitizerModule = await import('../../utils/promptSanitizer.js');
      vi.mocked(promptSanitizerModule.sanitizePromptContent).mockReturnValue({
        sanitized: 'Cloud summary', warnings: [], dangerLevel: 'low'
      });

      const request = buildRecordRequest('save', {
        title: 'T', url: 'https://example.com', content: 'contact user@example.com',
      });
      expect('alreadyProcessed' in request).toBe(false);

      const result = await pipeline.process(request.content, { alreadyProcessed: request.alreadyProcessed ?? false });

      expect(sanitizers.sanitizeRegex).toHaveBeenCalledWith('contact user@example.com');
      expect(mockCloudService.generateSummary).toHaveBeenCalledWith('MASKED TEXT', expect.anything());
      expect(result.maskedCount).toBe(1);
    });
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `npx vitest run src/background/__tests__/privacyPipeline.test.ts -t "save-equivalent path"`
Expected: FAIL — `sanitizeRegex` is never called and `generateSummary` receives the raw content (pre-fix behavior), or the `alreadyProcessed in request` assertion fails.

- [ ] **Step 3: Commit the red test**

```bash
git add src/background/__tests__/privacyPipeline.test.ts
git commit -m "test: pin save-equivalent masking before cloud AI (red)"
```

### Task 4: Verify green (no production change needed)

The Task 2 fix already makes Task 3 pass (flag absent → `useMasking` true in `masked_cloud`).

- [ ] **Step 1: Run both test files**

Run: `npx vitest run src/background/__tests__/privacyPipeline.test.ts src/background/__tests__/recordRequestBuilder.test.ts`
Expected: PASS, all green including the two untouched pin tests (`alreadyProcessed=true` direct-input tests).

- [ ] **Step 2: Commit**

```bash
git add src/background/__tests__/privacyPipeline.test.ts
git commit -m "test: save-equivalent path masks PII before cloud AI (green)"
```

### Task 5: Full validation gate

- [ ] **Step 1: Run type check and the wider background suite**

Run: `npm run type-check`
Expected: exit 0.

Run: `npm run validate`
Expected: exit 0.

- [ ] **Step 2: Record results in the PBI checkboxes** (`Definition of Done` in `dev-docs/archived/pbi/2026-10-10-14-fix-save-alreadyprocessed-pii-bypass.md`), commit:

```bash
git add dev-docs/archived/pbi/2026-10-10-14-fix-save-alreadyprocessed-pii-bypass.md
git commit -m "docs: record PBI-14 validation results"
```
