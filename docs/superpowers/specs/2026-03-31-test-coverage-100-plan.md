# Implementation Plan: Test Coverage 100%

Based on: `docs/superpowers/specs/2026-03-31-test-coverage-100-design.md`

## Progress Summary

| Metric | Before | Current | Target |
|--------|--------|---------|--------|
| Statements | 67.79% | **80.49%** | 100% |
| Branches | 57.82% | **70.28%** | 100% |
| Functions | 72.13% | **83.85%** | 100% |
| Lines | 68.74% | **81.22%** | 100% |
| Tests | 2,464 | **3,372** | — |

---

## ✅ 完了済み

### Step 0: Test Infrastructure Setup

- [x] ~~Install jest-chrome~~ → **変更:** jest-chrome は Jest 26/27 のみ対応のため不採用。既存モック拡張方針に変更。
- [x] jest.setup.ts に `chrome.alarms`, `chrome.scripting`, `chrome.action`, `chrome.permissions.remove` を追加
- [x] 全テスト PASS 確認 (2,697 tests)

### Step 1: Phase 1 — `utils/` Low Coverage Files

| File | Before | After |
|------|--------|-------|
| `trustDbSchema.ts` | 0% | 100% |
| `trustDb.ts` | 43.23% | 82.50% |
| `contentExtractor.ts` | 52.72% | 78.18% |
| `trustChecker.ts` | 65.59% | 96.77% |
| `storageUrls.ts` | 67.12% | 99.33% |
| `ublockMatcher.ts` | 71.28% | 94.44% |
| `cssUtils.ts` | 66.66% | 66.66% |

### Step 2: Phase 2 — `background/` Low Coverage Files

| File | Before | After |
|------|--------|-------|
| `sessionAlarmsManager.ts` | 57.14% | 95.91% |

### Step 3: Phase 3 — `popup/` Low Coverage Files

| File | Before | After |
|------|--------|-------|
| `popup/ublockImport/index.ts` | 0% | 80% |
| `popup/trustSettings.ts` | 8.24% | 98.28% |
| `popup/domainFilter.ts` | 33.75% | 100% |
| `popup/settings/fieldValidation.ts` | 51.54% | 90% |

### Step 4: Phase 4 — `dashboard/`

| File | Before | After |
|------|--------|-------|
| `dashboard/cspSettings.ts` | 18.04% | 96% |

---

## ⚠️ 部分完了（100%未達成）

| File | Current | 残タスク |
|------|---------|---------|
| `recordingLogic.ts` | 29.89% | `_recordImpl` 系デッドコード (RecordingPipeline に置き換え済み) |
| `popup/main.ts` | 27% | 71.19% |
| `trustDb.ts` | 82.50% | 複雑なリトライ/マイグレーションロジック、競合状態 |
| `contentExtractor.ts` | 78.18% | document.body null チェック、Chrome runtime sendMessage |

---

## ❌ 未着手 — Step 5: All Files 100% Finalization

Priority order by gap size:

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

---

## 発見されたバグ

1. **trustDb.ts**: `isDomainTrusted` が `checkSensitive` の TRUSTED 結果（ホワイトリスト）を無視する（line 471: SENSITIVE のみチェック）
2. **contentExtractor.ts**: `aiSummaryCleanseEnabled` が第2引数に誤って渡される

---

## Rollback Strategy

既存モック拡張方針のため、ロールバック不要。新しいテストファイルは jest.setup.ts のグローバルモックを利用。
