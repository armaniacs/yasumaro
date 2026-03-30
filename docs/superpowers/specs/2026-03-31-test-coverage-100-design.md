# Test Coverage 100% Design

## Overview

100%テストカバレッジ達成のための段階的計画。現在のカバレッジ（Statements 67.79%、Lines 68.74%）を全ファイル100%に引き上げる。`jest-chrome` ライブラリ導入によりテストインフラを刷新し、依存関係順のディレクトリ単位で段階的に実施する。

## Current State

| Metric | Value |
|--------|-------|
| Statements | 67.79% |
| Branches | 57.82% |
| Functions | 72.13% |
| Lines | 68.74% |
| Source files | 107 |
| Test files | 145 |
| Files at 100% | 26 (24%) |
| Files 90-99% | 28 (26%) |
| Files < 90% | 53 (50%) |

## Approach

**jest-chrome ベース + ディレクトリ順PR分割**

- `jest-chrome` を導入し、既存の手書きChrome APIモック（jest.setup.ts 432行）を置き換え
- 依存関係順でディレクトリ単位に分割: `utils/` → `background/` → `popup/` → `dashboard/` → 全体100%化
- 全107ファイルを対象（除外なし）

## Phase Structure

### Phase 1: `utils/` (依存関係最下層)

現在カバレッジ: 81.24%

**低カバレッジ優先ファイル（< 80%）:**

| File | Current | Target | Test Focus |
|------|---------|--------|------------|
| `trustDbSchema.ts` | 0% | 100% | Schema validation |
| `trustDb.ts` | 43.23% | 100% | DB CRUD, BloomFilter integration, migration |
| `contentExtractor.ts` | 52.72% | 100% | DOM parsing, metadata extraction, CSP handling |
| `trustChecker.ts` | 65.59% | 100% | Trust domain verification, 3-step check |
| `storageUrls.ts` | 67.12% | 100% | URL save/get/validate |
| `ublockMatcher.ts` | 71.28% | 100% | Filter matching |
| `cssUtils.ts` | 66.66% | 100% | CSS utility operations |

80%+ files deferred to Phase 5.

### Phase 2: `background/` (Business Logic Layer)

現在カバレッジ: 61.46%

| File | Current | Target | Test Focus |
|------|---------|--------|------------|
| `recordingLogic.ts` | 19.57% | 100% | Recording pipeline, condition evaluation, error handling |
| `sessionAlarmsManager.ts` | 57.14% | 100% | Alarm create/update/delete, timeout management |

### Phase 3: `popup/` (UI Layer)

現在カバレッジ: 42.8%

| File | Current | Target | Test Focus |
|------|---------|--------|------------|
| `ublockImport/index.ts` | 0% | 100% | Import flow integration |
| `trustSettings.ts` | 8.24% | 100% | Trust settings UI operations |
| `main.ts` | 20.61% | 100% | Popup core logic |
| `domainFilter.ts` | 33.75% | 100% | Domain filter operations |
| `fieldValidation.ts` | 51.54% | 100% | Input validation |

### Phase 4: `dashboard/`

現在カバレッジ: 18.04%

| File | Current | Target | Test Focus |
|------|---------|--------|------------|
| `cspSettings.ts` | 18.04% | 100% | CSP settings UI, provider selection |

### Phase 5: 全ファイル100%化

90%以上の残ファイル（28ファイル）を100%に。主にブランチカバレッジの穴埋め。

## Test Infrastructure Changes

### jest-chrome Integration

1. `npm install --save-dev jest-chrome`
2. Rewrite `jest.setup.ts`:
   - Replace hand-written `chrome` global object (lines 154-407) with `jest-chrome`
   - Keep `chrome.i18n.getMessage` project-specific message dictionary as helper
   - Keep Web Crypto polyfill, TextEncoder/TextDecoder polyfill
   - Replace manual storage cleanup in `beforeEach` with `chrome.flush()`

### Helper Structure

```
src/__tests__/
  helpers/
    i18nMessages.ts     # chrome.i18n.getMessage message dictionary
    chromeSetup.ts      # jest-chrome initialization + custom config
    storageHelper.ts    # Storage state manipulation helpers
  types.ts              # Existing type definitions (keep)
```

### jest.config.cjs

No major changes. Add helper path to `moduleNameMapper` if needed.

## Testing Patterns

### File Naming

- Test files: `<source>.test.ts` (existing convention)
- Tests co-located with source files (current structure)
- Helpers in `src/__tests__/helpers/`

### Test Structure

```typescript
import { chrome } from 'jest-chrome';
import { functionUnderTest } from '../targetModule.js';

describe('ModuleName', () => {
  describe('functionName', () => {
    it('should handle normal case', () => { ... });
    it('should handle edge case', () => { ... });
    it('should handle error case', () => { ... });
  });
});
```

### Mock Strategy

| Target | Method |
|--------|--------|
| `chrome.*` API | `jest-chrome` (automatic) |
| `fetch` | `jest.fn()` global override |
| `chrome.i18n` | Helper-based (project-specific messages) |
| DOM operations | jsdom (`testEnvironment: 'jsdom'`) |
| Timers | `jest.useFakeTimers()` |

### Coverage Verification

- Run `npm test -- --coverage` after each phase
- Verify target directory coverage meets goal
- CI coverage gate is out of scope (separate issue)

## Success Criteria

1. All 107 source files reach 100% statement coverage
2. All test suites pass (`npm test` returns 0)
3. TypeScript type check passes (`npm run type-check` returns 0)
4. No existing tests broken by infrastructure changes

## Out of Scope

- CI/CD coverage gate integration
- E2E test coverage (separate from unit test coverage)
- Performance testing
- Snapshot testing
