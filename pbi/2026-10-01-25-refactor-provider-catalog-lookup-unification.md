# PBI: providerCatalog の同一 lookup 2 名の統合

優先度: 18 / RICE 6.0
backlog: [2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md)（holistic-code-review テーマ「死んだシーム群」/ 同一実装の 2 名）
依存: なし（他 PBI とファイル重複なし）

## ユーザーストーリー

AI プロバイダの解決を拡張する開発者として、同一のカタログ lookup が 2 つの名前で公開されている状態を解消してほしい、なぜなら片方に検証やフォールバックが追加されたときに片方が放置され、2 つの呼び出し箇所で挙動が静かに割れるから。モジュールには既に throw する `resolveCatalogEntry` があり、同じ Map 読みが 3 経路で公開されている。

## 背景（現状）

- `src/background/ai/providerCatalog.ts:221-223` `getRegistryEntry` と `:231-233` `tryResolveCatalogEntry` の本体は完全に同一: `return PROVIDER_CATALOG.get(providerId as ProviderId);`
- 呼び出し側は両方に分かれている
  - `getRegistryEntry`: `src/dashboard/aiProviderB/priorityListView.ts:22`、`src/background/ai/aiModelKey.ts:26`、`src/background/ai/providers/OpenAIProvider.ts:62`
  - `tryResolveCatalogEntry`: `src/dashboard/cspSettings.ts:240`、`src/dashboard/panels/diagnostic/DiagnosticsCollector.ts:204,214`
- 同一モジュールには throw する `resolveCatalogEntry` も存在する

## BDD シナリオ

```gherkin
Scenario: カタログ lookup の公開点が 1 つになる
  Given 同一の PROVIDER_CATALOG lookup を行う 2 つの公開関数がある
  When 呼び出し側を 1 つの関数へ寄せる
  Then 戻り値の型と未知 provider の扱いが現状と不変である
```

## 実装宣言

- 挙動維持: 戻り値（`ProviderRegistryEntry | undefined`）と未知 provider の扱いは不変
- 2 名のうち 1 名へ統合し、削除側は次のリリースで消す（re-export ではなく削除を基本とする）
- `resolveCatalogEntry`（throw 版）との差は「throw するかしないか」だけに維持する

## 受け入れ基準

- [x] 同一 lookup の公開名が 1 つになる
- [x] 全呼び出し側が統一された関数を通る
- [x] 戻り値と未知 provider の扱いが不変
- [x] 既存テストが green

## 実装記録（2026-10-02）

変更した内容:

- `providerCatalog.ts` — 削除対象は `tryResolveCatalogEntry`（統合先は既存の `getRegistryEntry`）。同一実装の公開名 2 つを 1 名にするため、`tryResolveCatalogEntry` を削除し、`ProviderCatalog` オブジェクトのエイリアス `tryResolve` も `getRegistryEntry` に置き換えた。re-export ではなく削除
- `getRegistryEntry` に「throw しない lookup の唯一の公開形態であり、entry が必ず欲しい呼び出し元は throw する `resolveCatalogEntry` を使う」という WHY の doc を追加
- 呼び出し側の移行（削除したエイリアスの消費者）:
  - `src/dashboard/cspSettings.ts` — `ProviderCatalog.tryResolve(provider)` を `getRegistryEntry(provider)` に。モジュール import も `ProviderCatalog` から `getRegistryEntry` の直接 import に変更（panel のバンドルから background 名前空間オブジェクトへの参照を外す）
  - `src/dashboard/panels/diagnostic/DiagnosticsCollector.ts` — 2 箇所の `ProviderCatalog.tryResolve(slot.provider)` を `getRegistryEntry(slot.provider)` に。`ProviderCatalog` は他用途で使われているため import は残置
- `src/background/ai/__tests__/providerCatalog.test.ts` — `ProviderCatalog.tryResolve('bogus-provider')` を `ProviderCatalog.getRegistryEntry('bogus-provider')` に更新
- `src/utils/storage/__tests__/providerLabelSso.test.ts` — ヘッダ WHY コメントが削除済みの `tryResolveCatalogEntry(provider)?.label` を参照していたため、生存している `getRegistryEntry(provider)?.label` に更新（コメントのみ）

`cspSettings.ts` と `DiagnosticsCollector.ts` は、削除したエイリアスの呼び出し側移行であるため NN25 のコミットに含める（別 PBI のファイルではない）。

追加したテスト: なし。統合後の「lookup 1 件あたりの挙動」は `providerCatalog.test.ts` の既存の conformance テスト（`throws UnknownProviderError for an unknown provider` が throw 版と非 throw 版の差を 1 テストで固定）が担う。既存テストの変更は上記エイリアス名の 1 行のみ。

逸脱なし。検証: `rg tryResolveCatalogEntry src/ entrypoints/` → 0 件。`npx vitest run <11 batch-A テストファイル> --repeats=20` → 155 passed / 11 files passed、`npm run validate` green。

## テスト戦略

- 既存テストが変更なしで green（呼び出し側の機械的置換のみ）
- 統合後、lookup 1 件あたりの挙動を固定するテストが 1 つ存在する
- 検証: `npm run type-check` と `src/background/ai/` 配下の vitest

## 実装内容

1. 統合先の関数名を選択する
2. 全呼び出し側を置換する
3. 使われなくなった関数を削除する

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test が通る
- [x] コードレビュー完了（統合担当が実装内容と diff を照合して確認）
