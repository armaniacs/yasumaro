# Implementation Plan: Test Coverage 100%

Based on: `docs/superpowers/specs/2026-03-31-test-coverage-100-design.md`

## Progress Summary

| Metric | Before | Current | Target |
|--------|--------|---------|--------|
| Statements | 67.79% | **72.30%** | 100% |
| Branches | 57.82% | **63.58%** | 100% |
| Functions | 72.13% | **76.12%** | 100% |
| Lines | 68.74% | **73.00%** | 100% |
| Tests | 2,464 | **2,697** | — |

---

## Step 0: Test Infrastructure Setup ✅

**Status:** DONE

- [x] ~~Install jest-chrome~~ → **変更:** jest-chrome は Jest 26/27 のみ対応のため不採用。既存モック拡張方針に変更。
- [x] jest.setup.ts に `chrome.alarms`, `chrome.scripting`, `chrome.action`, `chrome.permissions.remove` を追加
- [x] 全テスト PASS 確認 (2,697 tests)

---

## Step 1: Phase 1 — `utils/` Low Coverage Files

### 1.1 `trustDbSchema.ts` ✅

| Status | Before | After |
|--------|--------|-------|
| DONE | 0% | 100% (型定義ファイル、enum値検証済み) |

- [x] `src/utils/trustDb/__tests__/trustDbSchema.test.ts` 作成

### 1.2 `trustDb.ts` ✅

| Status | Before | After |
|--------|--------|-------|
| DONE | 43.23% | **82.50%** |

- [x] `src/utils/trustDb/__tests__/trustDb.test.ts` 作成 (72テスト)
- [x] TLD CRUD、Sensitive domain管理、ホワイトリスト、Tranco追跡、3-Step検証、エラーパス
- [ ] 残り未カバー: 複雑なリトライ/マイグレーションロジック、競合状態

### 1.3 `contentExtractor.ts` ✅

| Status | Before | After |
|--------|--------|-------|
| DONE | 52.72% | **78.18%** |

- [x] テスト拡張 (+21テスト)
- [ ] 残り未カバー: document.body null チェック、Chrome runtime sendMessage

### 1.4 `trustChecker.ts` ✅

| Status | Before | After |
|--------|--------|-------|
| DONE | 65.59% | **96.77%** |

- [x] テスト拡張 (+21テスト)

### 1.5 `storageUrls.ts` ✅

| Status | Before | After |
|--------|--------|-------|
| DONE | 67.12% | **99.33%** |

- [x] テスト拡張 (+73テスト)

### 1.6 `ublockMatcher.ts` ✅

| Status | Before | After |
|--------|--------|-------|
| DONE | 71.28% | **94.44%** |

- [x] テスト拡張 (+16テスト)

### 1.7 `cssUtils.ts` ✅

| Status | Before | After |
|--------|--------|-------|
| DONE | 66.66% | 66.66% (Istanbul計装アーティファクト) |

- [x] `src/utils/__tests__/cssUtils.test.ts` 作成 (9テスト)

---

## Step 2: Phase 2 — `background/` Low Coverage Files

### 2.1 `recordingLogic.ts` ❌

| Status | Before | Target |
|--------|--------|--------|
| NOT STARTED | 19.57% | 100% |

- [ ] `src/background/__tests__/recordingLogic.test.ts` 作成

### 2.2 `sessionAlarmsManager.ts` ✅

| Status | Before | After |
|--------|--------|-------|
| DONE | 57.14% | **95.91%** |

- [x] テスト拡張 (+8テスト)

---

## Step 3: Phase 3 — `popup/` Low Coverage Files ❌

| File | Status | Before | Target |
|------|--------|--------|--------|
| `popup/ublockImport/index.ts` | NOT STARTED | 0% | 100% |
| `popup/trustSettings.ts` | NOT STARTED | 8.24% | 100% |
| `popup/main.ts` | NOT STARTED | 20.61% | 100% |
| `popup/domainFilter.ts` | NOT STARTED | 33.75% | 100% |
| `popup/settings/fieldValidation.ts` | NOT STARTED | 51.54% | 100% |

---

## Step 4: Phase 4 — `dashboard/` ❌

| File | Status | Before | Target |
|------|--------|--------|--------|
| `dashboard/cspSettings.ts` | NOT STARTED | 18.04% | 100% |

---

## Step 5: Phase 5 — All Files 100% Finalization ❌

**NOT STARTED** — 28 files (90%+) → 100%

Priority order by gap size:

| File | Status | Current | Gap |
|------|--------|---------|-----|
| `sanitizePreview.ts` | ❌ | 73.71% | 26.29 |
| `i18n.ts` | ❌ | 77.46% | 22.54 |
| `pendingStorage.ts` | ❌ | 77.50% | 22.50 |
| `headerDetector.ts` | ❌ | 77.33% | 22.67 |
| `cache.ts` | ❌ | 77.77% | 22.23 |
| `contentCleaner.ts` | ❌ | 77.77% | 22.23 |
| `migration.ts` | ❌ | 78.68% | 21.32 |
| `storage.ts` | ❌ | 79.74% | 20.26 |
| `ProviderStrategy.ts` | ❌ | 80.00% | 20.00 |
| ... | ❌ | ... | ... |

---

## 発見されたバグ

1. **trustDb.ts**: `isDomainTrusted` が `checkSensitive` の TRUSTED 結果（ホワイトリスト）を無視する（line 471: SENSITIVE のみチェック）
2. **contentExtractor.ts**: `aiSummaryCleanseEnabled` が第2引数に誤って渡される

---

## Rollback Strategy

既存モック拡張方針のため、ロールバック不要。新しいテストファイルは jest.setup.ts のグローバルモックを利用。
