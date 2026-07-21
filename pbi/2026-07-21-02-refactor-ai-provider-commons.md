# PBI: AIプロバイダ関連の型・ラベル・ロジックの共通化

## ユーザーストーリー
開発者として、AIプロバイダの型定義や表示ラベル、優先度フォールバックロジックが1箇所にまとまっていることを望む。なぜなら、新しいプロバイダを追加する際に複数ファイルを修正する手間と、更新漏れによる不整合を防ぎたいためである。

## ビジネス価値
- **保守性向上**: プロバイダ追加・変更時の修正箇所を削減。
- **品質向上**: 型定義の重複削除により、型の食い違いによるランタイムエラーのリスクを低減。
- **技術的負債の削減**: デッドコード・未使用パラメータを削除し、コードの意図を明確にする。

## BDD受け入れシナリオ

```gherkin
Scenario: 新しいAIプロバイダを追加しても1箇所の修正で診断パネルと初期設定画面の両方が更新される
  Given 開発者が1箇所の共通プロバイダ設定マップに新しいプロバイダ "custom-provider" を追加した
  When 診断パネルと初期設定画面のAIテスト結果を表示した
  Then 両方の画面で "custom-provider" に対応したラベルと接続テスト結果が表示される

Scenario: 型定義の重複が解消され、一貫した型でAI接続テスト結果を扱える
  Given 開発者が ProviderTestResult や MultiProviderTestResult を参照している
  When 型定義を変更した場合
  Then aiClient.ts と dashboard.ts の両方で同じ型定義が使われており、片方の変更漏れがない
```

## 受け入れ基準
- [ ] `providerLabels` マップが `src/background/aiClient.ts` または新設の共通モジュールに1箇所に集約され、両方の diagnosticsPanel と dashboard.ts がそこから import している
- [ ] `ProviderTestResult` / `MultiProviderTestResult` が `aiClient.ts` のみで定義され、`dashboard.ts` はそこから import している
- [ ] `ConnectionTestResult` インターフェースが削除され、どこからも参照されていない
- [ ] `createConnectionStatusElement` の未使用色パラメータが削除または整理され、呼び出し元も簡潔になっている
- [ ] 優先度リストのフォールバックロジック（空なら legacy AI_PROVIDER）が1箇所の関数に集約されている
- [ ] 既存のテストが全てパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- [ ] 初期設定画面のAIテストボタンを押下し、新しい MultiProviderTestResult 型のレスポンスが正しく表示されること
- [ ] 診断パネルで各プロバイダのラベルが共通マップから解決されていること

### 統合テスト
- [ ] `AIClient.testConnection()` の戻り値が `MultiProviderTestResult` 型として正しく扱われること
- [ ] `dashboard.ts` の `testAiConnection()` が `aiClient.ts` から型を import して使用していること

### 単体テスト
- [ ] 共通 `providerLabels` マップに全プロバイダのラベルが登録されていること
- [ ] `createConnectionStatusElement` のシグネチャ変更後、呼び出し元が正しく動作すること
- [ ] `ConnectionTestResult` インターフェースが削除され、既存コードで参照されていないこと
- [ ] 優先度リストフォールバックロジックが共通関数経由で動作すること

## 実装アプローチ
- **Outside-In**: まず重複箇所を洗い出し、テストで各所からの参照が正しく動作することを確認する
- **Red-Green-Refactor**: 1つの重複を解消するたびにテストを実行し、壊れていないことを確認する
- **漸進的移行**: 全ファイルを一度に書き換えるのではなく、1つの定義を移動・統合してから次へ進む

## 見積もり
3pt（型移動と呼び出し元修正が中心で、リスクは低いが影響範囲の確認が必要）

## 技術的考慮事項
- `providerLabels` は `src/background/aiClient.ts` または `src/utils/aiProviders.ts` などの新設ファイルに配置する
- 共通フォールバック関数は `aiClient.ts` の静的メソッドとして公開し、`dashboard` 側でも利用可能にする
- `createConnectionStatusElement` の引数を減らすと、既存の呼び出し元すべてを修正する必要がある

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "providerLabels" src/dashboard/panels/diagnostic/diagnosticsPanel.ts src/dashboard/diagnosticsPanel.ts src/dashboard/dashboard.ts
grep -rn "ProviderTestResult\|MultiProviderTestResult\|ConnectionTestResult" src/
grep -rn "createConnectionStatusElement" src/dashboard/
```

### 実装手順
1. `ProviderTestResult` / `MultiProviderTestResult` を `aiClient.ts` のみに残し、`dashboard.ts` は import する
2. `ConnectionTestResult` を削除し、削除後の参照を確認する
3. 共通 `providerLabels` マップを作成し、3ファイルの定義を置き換える
4. `createConnectionStatusElement` の引数を整理し、呼び出し元を修正する
5. 優先度リストのフォールバックロジックを `aiClient.ts` のヘルパー関数に集約する

### 落とし穴
- 型定義を移動すると、`as` キャストを使っている箇所で型エラーが出る可能性がある。明示的な import に置き換える必要がある。
- `createConnectionStatusElement` の引数を変更すると、`dashboard.test.ts` などの既存テストも同時に修正が必要。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `providerLabels` / 型定義 / フォールバックロジックの重複が解消されている
- [ ] デッドコード・未使用パラメータが削除されている
- [ ] 既存の全テストがパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
