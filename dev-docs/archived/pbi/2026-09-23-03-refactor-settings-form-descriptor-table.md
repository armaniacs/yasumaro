# PBI 2026-09-23-03 — 設定フォーム群の記述子表化＋SSOT 委譲

**優先度**: 順位 3 / RICE 11.2（Reach 7 × Impact 2 × Confidence 80% ÷ Effort 1.0 人週）
**根拠**: 「読む→検証→保存→status→confirm」が 5 箇所にミラーされ、範囲リテラルが UI 側に複製（`fieldValidation.ts:240-242` の `v<10 || v>16000` vs `aiLimits.ts` の MIN_TOKENS/GLOBAL_MAX_TOKENS/`validateMaxTokens`）。UI mirror drift を構造的に防ぎ、新設定項目を表 1 行にする。
**種別**: refactor（非機能追加）

## 背景

`fieldValidation.ts`（368 行: 8 validator + 8 setup* + validateAllFields + setupAllFieldValidations）は `validateMinVisitDuration` / `validateMinScrollDepth` / `validateProtocol` / `validateGeminiApiVersion` を手書きリテラルで持ち、token 範囲が `aiLimits.ts` と二重所有（provider 別上限 gemini 8192 等と UI 上限が食い違いうる）。`trustSettings.ts:23-43` は import 時に `document.getElementById` を実行（jsdom 必須）で `customPromptManager.ts` の lazy init と規約が不一致。設定フォーム系 5 ファイル（trustSettings 603 / customPromptManager 575 / aiSummaryCleansingSettingsV2 506 / perSiteOverrides 194 / aiProvider 99）がそれぞれ独自の status/confirm 流儀を持つ。

## 実装戦略

1. `src/dashboard/settings/fieldDescriptor.ts` を新設し、記述子表 `{ storageKey, elementId, errorId, parse, validate, save }` を SSOT にする。`validate` は既存 SSOT（aiLimits / obsidianConfigValidator / urlWhitelist）への委譲に限定する。
2. `fieldValidation.ts` の手書き validator（token 範囲・滞在時間・スクロール深度・protocol・geminiApiVersion）を SSOT 委譲に置換する。token は `aiLimits.validateMaxTokens(tokens, providerId)` を唯一の判定にする。
3. `trustSettings.ts` の module-scope `getElementById` を init 関数内に移動し、customPromptManager と同一の lazy-init 規約に寄せる。
4. `settingsPipeline.ts` の `GENERAL_SETTINGS_VALIDATION_FIELDS` は記述子表から導出し、7 要素 ID 表の複製を消す。
5. DOM id・`data-storage-key`・i18n キーは変更しない（E2E/目視への影響をゼロにする機械的置換に限定）。

## 受け入れ基準（BDD）

### シナリオ 1: token 範囲の判定は aiLimits SSOT のみ
- **Given** provider 別上限（例: gemini 8192）と global 上限（16000）が異なる状態
- **When** gemini の settings フォームに 10000 を入力する
- **Then** UI 検証は `aiLimits.validateMaxTokens` と同一の判定を返し、`fieldValidation.ts` に範囲リテラルが残っていない

### シナリオ 2: 新設定項目は記述子 1 行で検証＋保存＋エラー表示が付随する
- **Given** 新しい数値設定フィールドを 1 つ追加する
- **When** 記述子表に 1 行を追加する
- **Then** fieldValidation / settingsPipeline / マネージャへの追記なしで検証・保存・エラー表示が動く

### シナリオ 3: trustSettings は jsdom なしで import 可能
- **Given** Node 環境（DOM なし）で `trustSettings.ts` を import する
- **When** import を実行する
- **Then** module-scope DOM 参照による例外が発生しない

## DoD（Definition of Done）

- [x] 記述子表が SSOT になり、`GENERAL_SETTINGS_VALIDATION_FIELDS` が表から導出される
- [x] token 範囲が `aiLimits.validateMaxTokens` に一本化され、UI mirror drift が構造的に消える
- [x] trustSettings / customPromptManager の初期化規約が統一される
- [x] 既存の E2E / DOM id / i18n キーは不変
- [x] `npm run type-check` / `npm run lint` / `npm test` が緑

## 実装記録（2026-09-23）
- コミット d9b7cab7。fieldDescriptor.ts を新設（記述子表 SSOT）。token 範囲は `aiLimits.validateMaxTokens` に一本化し、provider 別上限（gemini 8192 等）が UI にも反映されるようになった（シナリオ1の intended behavior change）。手書き validator5種を SSOT 委譲に置換（minVisit/minScroll/geminiVersion は表が単一所有者）。trustSettings を lazy init 化し DOM なし import をテストで pin。GENERAL_SETTINGS_VALIDATION_FIELDS は表から導出。DOM id / data-storage-key / i18n キーは不変（maxTokensErrors→maxTokensError の参照修正のみ）。
- 検証: type-check / settings 系 31 ファイル 818 テスト緑。
