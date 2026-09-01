# PBI: ProviderCatalog のデータソースを PROVIDER_REGISTRY 1 箇所に統合（06b）

## ユーザーストーリー
開発者として、AI provider のメタデータ（label / CSP ドメイン / content chars key）を 1 箇所で宣言したい。なぜなら `ProviderCatalog` を先行実装した後も、Catalog モジュール内だけで `PROVIDER_REGISTRY` の 1 行に加えて `CSP_DOMAINS` / `LABELS` / `CONTENT_CHARS_KEYS` の 3 つの独立した `Record<ProviderId>` 表を維持する必要があり、さらに provider label は `aiProviderLabels.PROVIDER_LABELS`（実表示名）としても別途重複していたから。

## 背景
PBI 2026-08-31-06（feat-provider-catalog）で `ProviderCatalog` を先行実装したが、2026-09-01 の効果確認（`pbi/2026-08-31-00-backlog.md`「PBI 06 効果確認済み」参照）で「provider 追加 = 1 箇所」が未達と判明。cloud provider 1 つの追加に約 20 ファイルを触る状態だった。本 PBI（06b）は、そのうち **データソースの分散**を解消する低リスク・挙動変更なしのリファクタ。UI 層は 06c で扱う。

### 着手前の分散
- Catalog モジュール内で 4 箇所（registry 1 行 + `CSP_DOMAINS` / `LABELS` / `CONTENT_CHARS_KEYS`）
- provider label が 4 コピー（Catalog placeholder / `aiProviderLabels.PROVIDER_LABELS` / ダッシュボード UI 3 配列 / i18n キー）
- `urlWhitelist.ts` の 3× コピペ `if` ブロック（`cspValidator` は既に catalog loop 化済み）
- `DiagnosticsCollector.settingsKeys` / `diagnosticsPanel.KNOWN_DETAIL_PROVIDERS` のハードコード列挙
- half-wired provider を検出する conformance test が無い

## 受け入れ基準
- [x] `ProviderRegistryEntry` に `label` / `cspDomain?` / `contentCharsKey?` を追加し、全 7 provider 行に値を埋める。`providerCatalog.ts` の `CSP_DOMAINS` / `LABELS` / `CONTENT_CHARS_KEYS` を削除し、`PROVIDER_CATALOG` は `PROVIDER_REGISTRY` の identity（`buildCatalog` 廃止）
- [x] `UnknownProviderError` / `resolveCatalogEntry` / `tryResolveCatalogEntry` / `ProviderCatalog` facade は不変。既存 consumer（`cspValidator` / `cspSettings` / `DiagnosticsCollector`）は無変更で動く
- [x] `src/utils/aiProviderLabels.ts` を削除。importer 3 箇所（`popup/errorUtils.ts` / `dashboard/aiTestResultView.ts` / `diagnosticsPanel.ts`）を `tryResolveCatalogEntry(id)?.label ?? id` に移行
- [x] `urlWhitelist.ts` の 3× コピペを `addProviderBaseUrls` の catalog loop に集約。挙動パリティ厳守（`isLocal` provider は対象外、gemini の固定 add は残す）
- [x] `DiagnosticsCollector.settingsKeys` / `diagnosticsPanel.KNOWN_DETAIL_PROVIDERS` を catalog 由来に。後者は `built-in-ai` を除外する `modelKey || baseUrlKey || apiKeyKey` フィルタで現行 6 id セットを再現
- [x] 新規 `src/background/ai/__tests__/providerCatalog.test.ts` — conformance test（全 ProviderId が resolve / キー集合が union と一致 / 参照 storage key が実在 / label 非空 / cspDomain が well-formed / requiresApiKey・isLocal が boolean）

## テスト戦略
- conformance test を先に書く（RED）→ データ移動（GREEN）
- 影響テスト: `aiProviderLabels.test.ts`（削除）/ `aiTestResultView.test.ts`（mock 張替）/ `DiagnosticsCollector.test.ts`（実 label に更新）/ `storageUrls.test.ts`（warn 文字列を catalog label ベースに更新）/ `diagnosticsPanel.*.test.ts`

## 見積もり
5 pt — 挙動変更なし・低リスクだが約 10 src + 6 test ファイルに触れる

## Definition of Done
- [x] provider メタデータのソースが `PROVIDER_REGISTRY` 1 箇所
- [x] `aiProviderLabels.ts` 削除
- [x] conformance test 新設
- [x] `npm run validate` green（type-check / lint / test / build）

## 実装メモ
- `DiagnosticsCollector.settingsKeys` は `as const` + `Pick` が load-bearing だったため `readonly StorageKey[]` 型注釈 + `as StorageKey[]` cast で吸収
- `urlWhitelist` の warn 文字列がテストで完全一致 assert されていたため、`${entry.label} Base URL ...` 形式への変更に合わせて 4 箇所の assertion を更新（挙動ではなくメッセージ文言の変更）
- popup バンドルへの影響: `errorUtils.ts` → `providerCatalog.js`（+ `providerRegistry.js` + `storage/types`）。全て @layer 1、chrome/AIClient 依存なし
- PR: #96（`feat/pbi-06b-catalog-consolidation`、commit `8075cffb`）
