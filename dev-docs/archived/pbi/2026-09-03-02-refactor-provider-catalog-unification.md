# PBI: ProviderCatalog 統合 — Registry / Catalog alias と RemoteAIService switch の deep 化

## ユーザーストーリー
AIプロバイダーを追加・保守する開発者として、ProviderRegistry と ProviderCatalog の alias indirection と RemoteAIService の `if (id)` switch を単一の deep module に統合したい、なぜなら現在は 197l + 45l の2つの Map が同一データを二重に露出し、csp / urlWhitelist / dashboard UI / factory の4箇所が別 import で同期漏れし、新 provider 追加が `PROVIDER_REGISTRY` 1行では完結しないから

## 優先度
- 順位: 02 / 07
- RICEスコア: **213**（Reach=40 / Impact=2 / Confidence=0.8 / Effort=0.3）
- 根拠: provider 追加は直近で `openai-compatible` / `built-in-ai` が追加された頻発タスク。今後も lm-studio / ollama 拡張や新 LLM 追加が予想され、1行追加で完結しない現状は毎回 3〜4 ファイルの同期漏れリスクを生む。PBI 01 に依存しないため 01 と並行着手も可能だが、01 完了後の方が storage 層の安定により安全。Effort 0.3人週は alias 削除＋factory 委譲＋UI builder の fields 駆動化で小さい。

## 背景 / なぜなぜ分析サマリ
| 疑問 | 原因 → 示唆 → 解 |
|------|------------------|
| なぜ alias が shallow か？ | `ProviderCatalog = PROVIDER_REGISTRY` + `resolve()` の45lは型も振る舞いも持たず（`ProviderCatalogEntry = ProviderRegistryEntry`）、consumer が `providerRegistry` と `providerCatalog` の両方から import する二重 seam を生む → 1つの Map に統合し `ProviderCatalog` を唯一の seam に |
| なぜ switch が漏れる？ | `RemoteAIService.registerDefaultProviders()` が registry を loop しながら `if (gemini) GeminiProvider / if (built-in-ai) BuiltInAiProvider / else Generic` と分岐 → 新 provider 追加時に factory と registry の2箇所を触る必要 → `createStrategy(id, settings)` を catalog が own し factory は委譲のみ |
| なぜ UI が同期漏れ？ | `aiProviderCatalogView.ts` の `KEY_TO_INPUT_ID` が `StorageKeys.*` の手動ミラーで、さらに `if (providerId==='gemini')` で gemini だけ extra field（`geminiApiVersion`）を追加 → catalog が `fields[]` を持てば view は generic に |
| なぜ SSRF が遠い？ | `isAllowedProviderBaseUrl` が registry に置かれ fetch site から遠い → catalog の `isAllowedBaseUrl` として fetch 前の guard に近づける |

## BDD受け入れシナリオ

### Scenario: 新 provider 追加が 1 行で完結する
  Given `PROVIDER_REGISTRY`（統合後の `ProviderCatalog`）に1行（`providerId` + `ProviderRegistryEntry`）を追加する
  When 追加後に `ProviderCatalog.createStrategy(newId, settings)` を呼ぶ
  Then `RemoteAIService` / `cspDomains` / `urlWhitelist` / `aiProviderCatalogView` / `DiagnosticsCollector` のいずれも追加の `if` や手動マップ更新なしに対応する provider の Strategy / CSP / storage key / UI field を解決できる

### Scenario: RemoteAIService が switch を持たない
  Given `PROVIDER_REGISTRY` に 7 provider が登録されている
  When `RemoteAIService.registerDefaultProviders()` が catalog の `createStrategy` に委譲する実装に置換される
  Then `src/background/ai/RemoteAIService.ts` に `if (id === 'gemini')` / `if (id === 'built-in-ai')` の分岐が存在しない

### Scenario: dashboard UI が fields 駆動で generic に描画される
  Given `ProviderCatalog` の各 entry が `fields: Array<{ storageKey, inputId, type, placeholderI18nKey }>` を持つ
  When `renderProviderSettings(container, providerId)` が呼ばれる
  Then `KEY_TO_INPUT_ID` の手動マップも `if (providerId==='gemini')` の extra field 分岐もなく、全 provider の settings block が `fields` から生成され、`geminiApiVersion` も entry の fields として表現される

### Scenario: providerCatalog と providerRegistry の import が1箇所に収束する
  Given 統合前は `src/utils/cspDomains.ts` が registry を、`src/dashboard/aiProviderCatalogView.ts` が catalog を import していた
  When 統合後
  Then 全 consumer が `src/background/ai/providerCatalog.ts`（または統合後の単一ファイル）からのみ import し、`providerRegistry.ts` への直接 import が 0 件になる（または registry が catalog に rename される）

### Scenario: SSRF guard が fetch 前に catalog 経由で検証される
  Given `isAllowedProviderBaseUrl(url, isLocal)` が catalog に属する
  When `RemoteAIService` が provider の baseUrl で fetch する前に catalog の guard を呼ぶ
  Then private IP / metadata サービス / 非 local の http が拒否され、既存の SSRF テストが catalog seam 経由で pass する

## 受け入れ基準
- [x] `src/background/ai/providerCatalog.ts` が唯一の seam となり、`src/background/ai/providerRegistry.ts` は削除されるか catalog に rename され、2つの Map の alias 関係が解消している
- [x] `ProviderCatalogEntry` が `fields[]`（または同等の宣言的 UI 記述）を持ち、`aiProviderCatalogView.ts` の `KEY_TO_INPUT_ID` と `if (providerId==='gemini')` 分岐が削除されている
- [x] `RemoteAIService.registerDefaultProviders()` の `if (id === ...)` switch が削除され、`ProviderCatalog.createStrategy(id, settings)` への委譲に置換されている
- [x] `isAllowedProviderBaseUrl` が catalog の seam として提供され、RemoteAIService の fetch 前 guard として使われる
- [x] 既存の `PROVIDER_REGISTRY` 1行追加で全 wiring（storage keys / CSP / factory / UI / diagnostics / urlWhitelist）が追従することを示すテスト（half-wired 検出）が存在し green
- [x] `grep -r "from.*providerRegistry" src/` が 0 件（または catalog のみにリダイレクト）、`npm run validate` green

## テスト戦略
- 単体: `ProviderCatalog.createStrategy` が各 providerId で正しい Strategy 型（Gemini / BuiltIn / Generic）を返すことを InMemory settings で検証
- 単体: `fields[]` 駆動の `renderProviderSettings` が全 provider で正しい input 要素（`data-storage-key` / `placeholder`）を生成することを jsdom で検証
- 単体: `isAllowedProviderBaseUrl` の SSRF ケース（private IP / metadata / localhost / http/https 制御）を catalog seam 経由で検証
- 統合: 既存の `providerCatalog.test.ts`（half-wired 検出）を拡張し、新 provider 追加時の wiring 漏れを検出
- 回帰: `RemoteAIService` / `cspDomains` / `urlWhitelist` / `diagnostics` の既存テストが新 seam 経由で pass

## 見積もり
2 pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `providerRegistry.ts` と `providerCatalog.ts` の二重 import が解消し、`grep` で alias パスが 0 件
- [x] コードレビュー完了
- [x] ドキュメント更新済み（`dev-docs/DESIGN_SPECIFICATIONS.md` §11.3 ProviderCatalog 節を新 seam に更新）
- [x] `npm run validate` green

## 実装メモ（任意）
- ファイル配置は `providerCatalog.ts` を残して `providerRegistry.ts` の内容を吸収する形を推奨（import 書き換えが最小）。Entry 型は `ProviderRegistryEntry` を `ProviderCatalogEntry` に rename。
- `geminiApiVersion` の extra field は `fields` に含めるか、entry に `extraFields` として持たせる。いずれも view の `if (gemini)` を消すことが目的。
