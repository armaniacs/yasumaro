# PBI: ダッシュボード provider UI 層を ProviderCatalog 駆動に（06c）

## ユーザーストーリー
開発者として、AI provider を追加するとき `PROVIDER_REGISTRY` の 1 行と i18n キーだけで済ませたい。なぜなら 06b でデータソースを統合した後も、ダッシュボード UI 層には `index.html` の `<option>` グループ ×4 select と 7 個の per-provider `<div id="*Settings">`、`settings/aiProvider.ts` の if/else 連鎖、`aiProviderB` の 2 配列、`aiProviderLayoutManager` の map、custom-prompt select のハードコード label が分散しており、UI だけで 6+ 箇所の変更を要求されたから。

## 背景
PBI 2026-09-01-03（06b）でデータソースを `PROVIDER_REGISTRY` に統合した。本 PBI（06c）は残る **UI 層の分散**を catalog 駆動に置き換える。A/B 両レイアウトが本番稼働（`AI_PROVIDER_LAYOUT`、既存ユーザー 'a' / 新規 'b'、ヘッダのトグルで切替）しているため両方を対象にする。

## 受け入れ基準
- [x] `ProviderRegistryEntry` に UI メタデータを追加: `labelI18nKey` / `fieldPlaceholders?` / `supportsCustomPrompt` / `settingsBlockKind`（`'generic' | 'models-dev' | 'built-in-ai'`）。Catalog は局所化文字列を持たず i18n キー名のみ。registry の Map 挿入順を dropdown 順（gemini, openai, openai2, lm-studio, ollama, openai-compatible, built-in-ai）に
- [x] 新規 `src/dashboard/aiProviderCatalogView.ts`:
  - `providerIdsInOrder()` = `[...PROVIDER_CATALOG.keys()]`
  - `renderProviderOptions(sel, { includeNone?, customPrompt? })` — 現在値を保持しつつ `<option>` を再生成。`customPrompt` は `supportsCustomPrompt` のみ + `<option value="all">`
  - `renderProviderSettings(container, providerId)` — `settingsBlockKind` で分岐して DOM を構築。element id / `data-storage-key` / `data-i18n-input-placeholder` は旧静的マークアップと完全一致（`KEY_TO_INPUT_ID` map）。末尾で `applyI18n(container)` を呼ぶ（生成ノードへの i18n 適用）
- [x] B レイアウト: `priorityListView.ts` の `PROVIDER_OPTIONS` / `providerAccordionView.ts` の `PROVIDER_DETAILS` を削除し builder に接続。static div の reparent を廃止し自前 DOM 構築に
- [x] `settings/aiProvider.ts`: `AIProviderElements` を `{ select; settings: Record<string, HTMLElement | undefined> }` に一般化。`updateAIProviderVisibility{,Multi}` を `providerIdsInOrder()` loop に。`PROVIDER_URLS` を `providerPermissionUrl(id)`（`entry.cspDomain` / `entry.defaultBaseUrl` 由来）に置換
- [x] `aiProviderLayoutManager.ts`: `PROVIDER_SETTINGS_MAP` を `settingsDivId(id)` + catalog loop に置換
- [x] A レイアウト: `generalSettingsPanel.mount()` で `renderProviderOptions` / `renderProviderSettings` により構築（`loadSettingsToInputs` の前）。`index.html` の provider `<option>` グループと 7 個の `<div id="*Settings">` を削除し `<select>` シェル + `<div id="providerSettingsMount">` のみ残す
- [x] custom-prompt: `renderProviderOptions(sel, { customPrompt: true })` で生成。`getProviderLabel` を catalog lookup に。`CustomPrompt.provider` 型に `'lm-studio'` / `'ollama'` を追加（`OpenAIProvider` はランタイムで既に文字列一致で custom prompt を適用するため、型と UI form だけが不完全だった = バグ修正）
- [x] conformance test 拡張（`providerCatalog.test.ts`）: labelI18nKey が getMessage で resolve / fieldPlaceholders が resolve / supportsCustomPrompt が gemini/openai/openai2/lm-studio/ollama の 5 / dropdown 順 / settingsBlockKind 設定 / 各 detail key が `GENERAL_SETTINGS_SCHEMA` に正しい type でバインド

## テスト戦略
- Outside-In、タスクごとに TDD
- 単体: `aiProviderCatalogView.test.ts`（jsdom、renderProviderOptions / renderProviderSettings の各 variant）、`aiProvider.test.ts` / `aiProvider-priority.test.ts`（新 `AIProviderElements` shape）、`providerAccordionView.test.ts`（catalog 順・自前 DOM）
- e2e: `dashboard-built-in-ai.spec.ts` の `@interaction`（拡張機能コンテキスト）で built-in-ai 選択時の show/hide を検証。`@ui`（`file://` 静的）は provider 実体を JS 構築するようになったため mount 点の存在確認に変更
- `npm run test:e2e` 全 spec pass（185 passed / 8 skipped）

## 見積もり
9 pt（基本 8 + custom-prompt 型拡張 & 保存パス検証 +1）— 10 src + `index.html` + 約 10 test、A/B 両レイアウト、live e2e

## Definition of Done
- [x] provider 追加 = `PROVIDER_REGISTRY` 1 行 + i18n キー
- [x] `index.html` の静的 provider マークアップを削除
- [x] conformance test が未接続分岐を検出
- [x] `npm run validate` green + `npm run test:e2e` green

## 実装メモ
- PR を 3 分割: #97（`feat/pbi-06c-catalog-view`、registry フィールド + builder、commit `c573e362`）/ #98（`feat/pbi-06c-consumers`、B レイアウト + settings/aiProvider + layoutManager、commit `97f29ce9`）/ #99（`feat/pbi-06c-a-layout`、A レイアウト + static HTML 削除 + custom-prompt 型、commit `8f967bcb`）
- `exactOptionalPropertyTypes: true` のため builder の `placeholderKey?` は `string | undefined` を明示
- `index.html` の gemini model input の `value="gemini-3.1-flash-lite"` fallback は削除。`DEFAULT_SETTINGS[GEMINI_MODEL]` が同値を持つため挙動は不変
- 残債は `pbi/2026-08-31-00-backlog.md` の「06d 候補」に記録（cspDomains manifest / cspValidator.PROVIDER_TO_DOMAIN / aiLimits.PROVIDER_MAX_TOKENS / RemoteAIService factory / StorageKeys 自動生成）
