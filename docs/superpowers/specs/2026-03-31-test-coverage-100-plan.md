# Implementation Plan: Test Coverage 100%

Based on: `docs/superpowers/specs/2026-03-31-test-coverage-100-design.md`

## Step 0: Test Infrastructure Setup

**Goal:** Install jest-chrome and rewrite jest.setup.ts

### Tasks

1. **Install jest-chrome**
   - `npm install --save-dev jest-chrome`
   - Verify TypeScript types are available

2. **Create helper files**
   - `src/__tests__/helpers/i18nMessages.ts` — Extract message dictionary from jest.setup.ts lines 221-392
   - `src/__tests__/helpers/chromeSetup.ts` — jest-chrome initialization + custom i18n setup
   - `src/__tests__/helpers/storageHelper.ts` — Storage state helpers (getStorageState, clearAllStorage)

3. **Rewrite jest.setup.ts**
   - Import `jest-chrome` and helpers
   - Replace lines 50-407 with jest-chrome setup
   - Keep polyfills (TextEncoder, TextDecoder, Web Crypto)
   - Replace manual storage cleanup with `chrome.flush()` in beforeEach
   - Keep global alert/confirm mocks

4. **Verify existing tests pass**
   - Run `npm test` — all 2464 tests must pass
   - Run `npm run type-check` — must pass
   - Fix any jest-chrome compatibility issues

**Verification:** `npm test` returns 0, `npm run type-check` returns 0

---

## Step 1: Phase 1 — `utils/` Low Coverage Files

**Target:** 7 files below 80% coverage → 100%

### 1.1 `trustDbSchema.ts` (0% → 100%)

- Create `src/utils/trustDb/trustDbSchema.test.ts`
- Test all exported schema validation functions
- Cover: valid inputs, invalid inputs, edge cases, boundary values

### 1.2 `trustDb.ts` (43.23% → 100%)

- Expand `src/utils/trustDb/trustDb.test.ts` (if exists) or create
- Test: init, add, remove, query, clear, export, import
- Cover: BloomFilter integration, migration paths, error handling
- Mock: chrome.storage.local, IndexedDB if used

### 1.3 `contentExtractor.ts` (52.72% → 100%)

- Expand `src/utils/contentExtractor.test.ts` (if exists) or create
- Test: extractMetadata, extractContent, extractText
- Cover: various DOM structures, CSP restricted pages, missing elements
- Use jsdom to create test DOM structures

### 1.4 `trustChecker.ts` (65.59% → 100%)

- Expand or create `src/utils/trustDb/trustChecker.test.ts`
- Test: 3-step trust verification, domain matching, bloom filter fallback
- Cover: trusted domains, untrusted domains, edge cases

### 1.5 `storageUrls.ts` (67.12% → 100%)

- Expand `src/utils/storageUrls.test.ts`
- Test: getAllUrls, addUrl, removeUrl, validateUrl, exportUrls
- Cover: empty storage, corrupted data, concurrent access

### 1.6 `ublockMatcher.ts` (71.28% → 100%)

- Expand or create `src/utils/ublockMatcher.test.ts`
- Test: matchUrl against rules, exception handling, wildcard matching
- Cover: various filter formats, edge cases

### 1.7 `cssUtils.ts` (66.66% → 100%)

- Create `src/utils/cssUtils.test.ts`
- Test all exported CSS utility functions
- Cover: normal CSS, edge cases, invalid input

**Verification:** `npm test -- --coverage` shows utils/ files at/near 100%

---

## Step 2: Phase 2 — `background/` Low Coverage Files

**Target:** 2 files below 80% → 100%

### 2.1 `recordingLogic.ts` (19.57% → 100%)

- Create `src/background/recordingLogic.test.ts`
- Test: full recording pipeline, permission checks, duplicate detection, AI summary flow
- Mock: chrome APIs, fetch, ObsidianClient, AIClient
- Cover: success paths, error paths, timeout scenarios

### 2.2 `sessionAlarmsManager.ts` (57.14% → 100%)

- Expand or create `src/background/sessionAlarmsManager.test.ts`
- Test: createAlarm, updateAlarm, clearAlarm, alarm event handling
- Mock: chrome.alarms API

**Verification:** `npm test -- --coverage` shows background/ files at/near 100%

---

## Step 3: Phase 3 — `popup/` Low Coverage Files

**Target:** 5 files below 80% → 100%

### 3.1 `popup/ublockImport/index.ts` (0% → 100%)

- Create `src/popup/ublockImport/index.test.ts`
- Test: import flow orchestration, file/URL source handling
- Mock: DOM elements, file reader, fetch

### 3.2 `popup/trustSettings.ts` (8.24% → 100%)

- Create `src/popup/trustSettings.test.ts`
- Test: load/save trust settings, UI state management
- Mock: chrome.storage, DOM elements

### 3.3 `popup/main.ts` (20.61% → 100%)

- Expand or create `src/popup/main.test.ts`
- Test: popup initialization, event handlers, message passing
- Mock: chrome APIs, DOM, message listeners

### 3.4 `popup/domainFilter.ts` (33.75% → 100%)

- Create `src/popup/domainFilter.test.ts`
- Test: add/remove domain, filter mode switching, validation
- Mock: chrome.storage, DOM elements

### 3.5 `popup/settings/fieldValidation.ts` (51.54% → 100%)

- Expand `src/popup/settings/fieldValidation.test.ts`
- Test: all validation rules, error messages, edge cases
- Cover: valid/invalid inputs, boundary values

**Verification:** `npm test -- --coverage` shows popup/ files at/near 100%

---

## Step 4: Phase 4 — `dashboard/` Low Coverage Files

**Target:** 1 file below 80% → 100%

### 4.1 `dashboard/cspSettings.ts` (18.04% → 100%)

- Create `src/dashboard/cspSettings.test.ts`
- Test: CSP configuration UI, provider selection, settings persistence
- Mock: chrome APIs, DOM elements

**Verification:** `npm test -- --coverage` shows dashboard/ files at/near 100%

---

## Step 5: Phase 5 — All Files 100% Finalization

**Target:** Remaining 28 files (90%+) → 100%

Go through each file below 100% and add targeted tests for uncovered branches/lines.

Priority order by gap size (largest gap first):

| File | Current | Gap |
|------|---------|-----|
| `sanitizePreview.ts` | 73.71% | 26.29 |
| `i18n.ts` | 77.46% | 22.54 |
| `pendingStorage.ts` | 77.50% | 22.50 |
| `headerDetector.ts` | 77.33% | 22.67 |
| `cache.ts` | 77.77% | 22.23 |
| `contentCleaner.ts` | 77.77% | 22.23 |
| `migration.ts` | 78.68% | 21.32 |
| `storage.ts` | 79.74% | 20.26 |
| `ProviderStrategy.ts` | 80.00% | 20.00 |
| ... | ... | ... |

For each file:
1. Run `npm test -- --coverage --collectCoverageFrom='src/path/to/file.ts'`
2. Identify uncovered lines/branches
3. Add targeted tests
4. Verify 100%

**Final Verification:**
- `npm test -- --coverage` — All files at 100%
- `npm test` — All tests pass
- `npm run type-check` — No type errors

---

## Rollback Strategy

If jest-chrome causes widespread test failures:
1. Revert `jest.setup.ts` to hand-written mock
2. Keep new test files (they only need chrome mock adjustments)
3. Consider Approach 2 (extend existing mock) as fallback

## Estimated Scope

| Step | Files | Est. Tests Added |
|------|-------|-----------------|
| 0: Infrastructure | 3 helpers + jest.setup rewrite | 0 |
| 1: utils/ | 7 files | ~150-200 |
| 2: background/ | 2 files | ~80-120 |
| 3: popup/ | 5 files | ~100-150 |
| 4: dashboard/ | 1 file | ~30-50 |
| 5: Finalization | 28 files | ~100-200 |
| **Total** | **43 files + infra** | **~460-720** |
