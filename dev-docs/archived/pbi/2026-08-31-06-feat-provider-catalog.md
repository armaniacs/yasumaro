# PBI: ProviderCatalog 導入 — AI Provider 定義の集約（Speculative）

## ユーザーストーリー
開発者として、AI Provider の定義（registry + StorageKeys 3つ組 + CSP domain + Diagnostics 表示）を一箇所に集約したい。なぜなら現在 provider 追加が 6 ファイル（`providerRegistry` / `StorageKeys` / `defaults` / `_locales` / `DiagnosticsCollector switch` / `cspSettings`）に跨り、`getMaxContentChars` が `settings as Record<string,unknown>['providers']` を迂回して読む漏れがあるが、追加頻度が低いため現状は分散が許容されているから。

## 優先度
- 順位: 06 / 06
- RICEスコア: **75**（Reach=150 / Impact=1 / Confidence=0.5 / Effort=1）
  - Reach 150: AI provider 追加を行う開発者のみ。頻度低
  - Impact 1: 中。集約で追加が 1 ファイルで完結するが、現行 6 ファイル変更のコストが頻発しない限り体感 Leverage は小
  - Confidence 0.5: 低。Catalog が `StorageKeys` 型と密結合し、型生成の複雑さが増すリスクが読めない
  - Effort 1: 1 人週（Catalog 型と 6 箇所集約）。ただし型パズルの工数が膨らむ可能性
- 根拠: RICE 最下位。ProviderStrategy 自体は既に深く（checkPreFlight/sanitize/retry を 4 providers で共有）、残る浅さは `providerRegistry` の data 列挙のみ。YAGNI の観点で Speculative。2 つ目の provider 追加が発生した時点で再評価する。
- 依存: なし。独立。01 Settings 後に Catalog が Settings 型を参照するため、01 後の方が型整合が取りやすい。

## 背景 / なぜなぜ分析
- 表層: provider 追加で 6 ファイルを触る
- なぜ1: `providerRegistry` が `{ baseUrlKey, apiKeyKey, modelKey, defaultBaseUrl, isLocal }` の data 列挙で、StorageKeys / defaults / locales / CSP / Diagnostics が別管理
- なぜ2: `DiagnosticsCollector` が 6 branch の switch で provider 別表示を分岐
- なぜ3: `cspSettings.ts` が provider 別に `connect-src` を条件分岐
- なぜ4: `ProviderStrategy.getMaxContentChars` が `settings['providers']` bag を `as unknown` で読む — Settings 型の index signature がなく迂回
- なぜ5: 追加頻度が年 1 回程度で、6 ファイル変更のコストが問題化していない → 深める Leverage が今は小さい
- 解: `ProviderCatalog` 深い Module を仮説として設計。`resolve(name) → { baseUrlKey, apiKeyKey, modelKey, defaultBaseUrl, cspDomain, label }` 一つで 6 情報を返す。ただし今は Speculative として見送り、次回追加時に再評価。

## BDD受け入れシナリオ

Scenario: Catalog 1 要素追加で provider が使える（将来の理想形）
  Given `ProviderCatalog` に `{ name: 'my-provider', baseUrlKey: StorageKeys.MY_BASE_URL, cspDomain: 'https://api.my.com' }` を追加する
  When  ダッシュボードで provider を選択し `testConnection` を呼ぶ
  Then  Storage への保存、CSP の `connect-src` 許可、Diagnostics 表示がすべて Catalog 経由で動作する
  And   `_locales` / `defaults` / `cspSettings` の個別変更は不要

Scenario: 既存 provider が Catalog 経由でも従来通り動作する
  Given `gemini` / `openai` / `openai2` / `lm-studio` / `ollama` / `openai-compatible` の 6 provider
  When  各 provider で `generateSummary` を呼ぶ
  Then  `ProviderStrategy.checkPreFlight` / `sanitizeContent` / `shouldRetry` が従来通り適用され、結果が変わらない

Scenario: 境界 — 未知の provider 名で Catalog がエラーを返す
  Given `ProviderCatalog.resolve('unknown-provider')`
  When  解決を試みる
  Then  `UnknownProviderError` が throw され、caller はフォールバックせず明示的に失敗する

Scenario: Speculative 判断 — 今は着手しない
  Given 本 PBI が Speculative として backlog にある
  When  次の provider 追加要求が発生した
  Then  本 PBI を再評価し、RICE を再計算して 01-05 との順位を比較する
  And   追加がなければ本 PBI は着手しない（YAGNI）

## 受け入れ基準
- [x] `ProviderCatalog` が `resolve(name)` / `tryResolve(name)` で provider 情報（baseUrlKey/apiKeyKey/modelKey/isLocal/defaultModel/cspDomain/label/contentCharsKey）を返す
- [x] `providerRegistry.ts` を Catalog が内部 data として委譲（`buildCatalog` が `PROVIDER_REGISTRY` を走査し cspDomain/label/contentCharsKey を augment）
- [x] `DiagnosticsCollector` の per-provider switch が Catalog 駆動に置換
- [x] `cspValidator` / `cspSettings.ts` の条件分岐が Catalog の `baseUrlKey` / `cspDomain` から導出
- [x] `getMaxContentChars` が typed に `settings.providers` bag と `StorageKey` を読む（`as Record` 迂回を解消）
- [x] 本 PBI が Speculative である旨と再評価トリガーを backlog（`2026-08-31-00-backlog.md`）に明記

## テスト戦略
- E2E: 新 provider 追加後の `testConnection` と `generateSummary` が成功（実装する場合）
- 統合: Catalog の 6 provider 解決、CSP 生成、Diagnostics 表示の同一性、未知 provider のエラー
- 単体: `ProviderCatalog.resolve` の型推論、`getMaxContentChars` の typed access、switch 置換の分岐網羅

## 見積もり
2 pt（要チームでの見積もり）— Catalog 型と 6 箇所集約 1pt + Diagnostics/CSP 置換 1pt。ただし型パズルで 3pt に膨らむ可能性。Speculative のため今は見積のみ。

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了（ai / dashboard / csp の影響確認 — 2026-09-01）
- [x] ドキュメント更新済み（DESIGN_SPECIFICATIONS.md §11.3 Cloud AI Provider Catalog を新設）
- [x] `npm run validate` が green

## 再評価トリガー
次に AI provider を追加するとき、Catalog 駆動化で「追加が 1 箇所で済むか」を確認する。詳細は `pbi/2026-08-31-00-backlog.md` の「PBI 06 — Speculative の扱い」節。

## 実装メモ（任意）
- 本 PBI は Speculative。01-05 の完了後に provider 追加が発生するまで着手しないことを推奨。着手する場合は `ProviderStrategy` の深さを壊さないように Catalog は data 層のみを集約し、checkPreFlight/sanitize 等の振る舞いは Strategy に残す
- `StorageKeys` の 3つ組（BASE_URL/MODEL/API_KEY）を Catalog が所有すると、StorageKeys 型の自動生成が必要になる。`satisfies` と mapped type で型安全を確保する
- `_locales` の label は Catalog から生成せず、既存の i18n キーを参照する Adapter に留める（i18n と catalog の結合は避ける）
