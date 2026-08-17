# PBI: AIClient 委譲ラッパーを削除して AIService を直接使用する

## ユーザーストーリー
開発者として、`AIClient` という `RemoteAIService` の薄い委譲ラッパーを削除し、呼び出し元が直接 `AIService` インターフェースまたは `RemoteAIService` を使うようにしたい。なぜなら、ADR-2026-07-27 で統合済みであり、ラッパーの存在は冗長な抽象と追加のメンテナンスコストを生んでいるから。

## ビジネス価値
- 不要な抽象層を削減し、コードの一貫性を向上させる
- 新しい開発者が AI要約機能を追う際の認知負荷を下げる
- `RemoteAIService` 側の改善（重複排除、factory reuse など）が直接呼び出し元に届く

## BDD受け入れシナリオ

```gherkin
Scenario: 要約生成
  Given 要約対象のコンテンツが存在する
  When 呼び出し元が要約を要求する
  Then `RemoteAIService.generateSummary` が直接呼ばれる
  And `AIClient` インスタンスは生成されない

Scenario: AI 接続テスト
  Given Dashboard またはポップアップで接続テストを実行する
  When テストボタンが押される
  Then `RemoteAIService.testConnection` が直接呼ばれる
  And 進捗コールバックが正しく渡される

Scenario: カスタムプロバイダー登録
  Given 拡張機能がカスタム AI プロバイダーを登録する
  When 登録処理が走る
  Then `RemoteAIService.registerProvider` が直接呼ばれる
  And プロバイダーが戦略リストに追加される
```

## 受け入れ基準
- [ ] `src/background/aiClient.ts` が削除されている
- [ ] コードベース内の `AIClient` インポート・参照がゼロになっている
- [ ] すべての呼び出し元が `AIService` または `RemoteAIService` を直接使用している
- [ ] `ProviderTestResult`、`MultiProviderTestResult` の型は必要な呼び出し元に維持されている
- [ ] 既存の `aiClient.test.ts` は `RemoteAIService.test.ts` への移行または委譲 contract の縮小が完了している
- [ ] AI要約・接続テスト・カスタムプロバイダー登録の動作が変わらない

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- Dashboard / ポップアップからの接続テストシナリオ
- 実際の AI 要約実行シナリオ

### 統合テスト
- `createBackgroundServices` が `AIService` を生成し、呼び出し元に注入される経路
- レビュー要約生成（`reviewSummaryGenerator`）が `AIService` を直接使用する

### 単体テスト
- `AIClient` 不在を確認する grep/コンパイルチェック
- `RemoteAIService.generateSummary` / `testConnection` / `registerProvider` の既存テスト
- カスタムプロバイダー factory の登録テスト

## 実装アプローチ
- **Outside-In**: 呼び出し元を特定し、それぞれを `AIService`/`RemoteAIService` に切り替える
- **Red-Green-Refactor**: 削除前に各呼び出し元のテストを整備し、削除後も green を維持

## 見積もり
3ポイント

## 技術的考慮事項
- 依存関係: `src/background/ai/AIService.ts`、`src/background/ai/RemoteAIService.ts`、`src/background/createBackgroundServices.ts`、`src/background/service-worker.ts`、`src/background/reviewSummary*.ts`
- テスタビリティ: `AIService` インターフェースでモック化し、呼び出し元の単体テストを可能にする
- 副作用: 呼び出し元が多岐にわたるため、コンパイルエラーが最も確実な検知手段

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "AIClient" src/
grep -rn "from.*aiClient" src/
```

### 実装手順
1. `AIClient` を参照しているすべてのファイルを列挙する
2. `generateSummary` 呼び出しを `RemoteAIService.generateSummary(content, { tagSummaryMode, url, traceId })` に置換
3. `testConnection` 呼び出しを `RemoteAIService.testConnection(onProgress, runId)` に置換
4. `registerProvider` 呼び出しを `RemoteAIService.registerProvider(name, factory)` に置換
5. `aiClient.test.ts` を `RemoteAIService` 側の委譲 contract に縮小または削除
6. `src/background/aiClient.ts` を削除

### 落とし穴
- `ProviderTestResult` / `MultiProviderTestResult` は `aiClient.ts` で定義されている。削除前にこれらを `AIService.ts` または別の型ファイルへ移動する
- `PROVIDER_LABELS` の re-export も `aiClient.ts` 経由で使われている可能性がある。利用箇所を直接 `src/utils/aiProviderLabels.js` へ切り替える
- `AIClient` を new している箇所（テスト含む）は `RemoteAIService` の new に置き換える
- `RemoteAIService` のデフォルトコンストラクタ引数が `AIClient` 側で暗黙的に作成されていたfactoryを持つため、呼び出し元で factory を注入する必要がないか確認する

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `AIClient` のコードベース全体の参照がゼロ
- [ ] 既存テストがすべてパスする
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（ADR-2026-07-27 に実施済みとして追記）
