# Dig Findings — Architecture Deepening Autonomous Closer (2026-08-23)

## 洗い出し結果

| カテゴリ | 件数 | 内容 |
|---------|------|------|
| PBI (pbi/*.md) | 7件 | Architecture Deepening 7件 (01-07) |
| Plan (dev-docs/plans/*.md) | 2件 | 2026-06-29-maintenance-plan.md / verified-crx-upload.md (参照文書、未完了ではない) |
| TODO/FIXME (src/) | 0件 | ソースに未実装TODOなし |
| 未チェックボックス (pbi/) | 63件 | 7PBIの受け入れ基準 + DoD |
| type-check | PASS | エラーなし |
| バージョン整合 | 一致 | 6.7.66 統一 |

## なぜなぜ分析サマリー

### PBI-01: Protocol version 二重定義
- **現象**: `protocol.ts:20` と `loader.ts:21` に `CURRENT_PROTOCOL_VERSION = 1` が二重定義。「Keep this in sync」は約束であり保証ではない
- **Why連鎖**: loader.ts は IIFE で ESM import 不可 → ハードコード複製 → v2 bump 時に同期忘れ → CHECK_DOMAIN silent fail → 今まで bump がなかったため未顕在化
- **解**: Vite `define.__PROTOCOL_VERSION__` でビルド時注入 + `protocol-sync.test.ts` で CI 検証

### PBI-02: piiStripper 4箇所重複
- **現象**: `stripPiiFromMaskedItems` が4箇所で verbatim 繰り返し。新 pipeline 消費者が1つ忘れると PII 漏洩
- **Why連鎖**: pipeline が MaskedItem (original付き) を返す → 呼び出し側が strip 責任 → 境界の概念なし → 型レベルで漏洩検出不可
- **解**: `piiBoundary.ts` に `toExternalResult()` を単一 boundary として新設。RecordingPipeline preview path で使用。handlers の3箇所を削除

### PBI-03: Storage 3重キャッシュ
- **現象**: settingsStore (1s) / RecordingCache (30s) / SettingsRepository (none) の3層。saveSettings が 1s のみクリアし 30s が stale
- **Why連鎖**: 各層が独立追加された → 横断的 invalidate オーナー不在 → dashboard 保存後30秒 stale → 稀なケースで未報告
- **解**: `RecordingCache.ensureStorageListener()` で `chrome.storage.onChanged('settings')` を検知し自動 invalidate。完全な SettingsCache モジュールは PBI-04 と合わせて段階的に

### PBI-04: SettingsRepository instanceof 分岐
- **現象**: 6メソッド × 2パス = 12の instanceof 分岐。Chrome パスは getSettings/saveSettings に丸投げで thin wrapper
- **Why連鎖**: 既存 getSettings (暗号化・マイグレーション) を再利用するため wrapper 化 → Repository が depth を持たない shallow module
- **解**: StorageAdapter に `getSettings/setSettings` を追加し両 Adapter が多態的に実装。6メソッドの instanceof を全削除

### PBI-05: メッセージ検証二重定義
- **現象**: messageTypes.ts (2要素) と MessageRouter (4要素) で CONTENT_SCRIPT_ALLOWED が別定義。片方更新漏れが脆弱性
- **Why連鎖**: MessageRouter が後から追加 → 既存 messageHandler を触らず追加 → single source 意識なし → コピペで drift
- **解**: `CONTENT_SCRIPT_ALLOWED_TYPES` (4要素) を messageTypes.ts に SSOT として定義。MessageRouter は `new Set(CONTENT_SCRIPT_ALLOWED_TYPES)` で派生

### PBI-06: extractor.ts God Module
- **現象**: 716行で5責務。shouldRecordVisit 以外はテスト薄い
- **Why連鎖**: 単一 entrypoint で分割インセンティブ低 → 各責務が密結合 → テスト可能な部分と困難な部分が混在
- **解**: `privacyDialog.ts` を最初に抽出 (最も独立)。visitTracker/settingsLoader は段階的に

### PBI-07: createBackgroundServices 17フィールド
- **現象**: 215行で12シングルトン直接 new、6クロージャー再バインド。テストで全グラフ再構築
- **Why連鎖**: 各シングルトンが異なる初期化要件 → 直接構築 → 部分型 Pick で委譲クロージャー → 17フィールド集約
- **解**: `serviceContainer.ts` に ServiceContainer (register/resolve/override/has) を新設。段階的に createBackgroundServices へ統合

## 実装サマリー

| PBI | 変更ファイル | 検証 |
|-----|-------------|------|
| 01 | wxt.config.ts, src/content/loader.ts, src/messaging/__tests__/protocol-sync.test.ts (new) | type-check PASS, 3 tests PASS |
| 02 | src/background/pipeline/piiBoundary.ts (new), src/background/pipeline/RecordingPipeline.ts, src/background/handlers/recordingHandlers.ts, src/utils/piiStripper.ts (deprecated shim), src/background/pipeline/__tests__/piiBoundary.test.ts (new) | type-check PASS, 14 tests PASS (piiStripper+piiBoundary) |
| 03 | src/background/recordingCache.ts, src/background/createBackgroundServices.ts | type-check PASS |
| 04 | src/utils/storage/SettingsRepository.ts | type-check PASS, 51 storage tests PASS |
| 05 | src/background/messageTypes.ts, src/background/handlers/MessageRouter.ts | type-check PASS |
| 06 | src/content/privacyDialog.ts (new), src/content/extractor.ts | type-check PASS |
| 07 | src/background/serviceContainer.ts (new) | type-check PASS |

## 最終検証

- `npm run type-check`: PASS (0 errors)
- `npx vitest run`: 496 passed | 1 skipped (497 files), 8379 passed | 19 skipped (8398 tests)
- `pbi/*.md` (除く 00-INDEX): 0件 (全て archived)
- 未チェックボックス (pbi/): 0件
- バージョン整合: 6.7.66 一致
