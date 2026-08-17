# PBI: 二つのエラー分類システムを統一する

## ユーザーストーリー
開発者として、`src/utils/errorMessages.ts` と `src/popup/errorUtils.ts` の二つの並列エラー分類システムを統一したい。なぜなら、互換性のない `ErrorType` enum と重複したメッセージフォーマットロジックが保守コストを増大させ、片方の修正がもう片方に反映されないリスクがあるから。

## ビジネス価値
- エラー分類の修正が1箇所で完結し、修正漏れによるUI表示バグを防止
- ポップアップとサービスワーカーが同じ分類体系を共有し、ユーザー体験が一貫する
- 438行の重複コードを削除し保守性を向上

## BDD受け入れシナリオ

```gherkin
Scenario: ネットワークエラーの分類が統一される
  Given ユーザーがオフライン状態でAI要約をリクエストする
  When ネットワークエラーが発生する
  Then ポップアップのエラーメッセージとサービスワーカーのログが同じエラータイプで分類される
  And 両方のレイヤーで同じユーザー向けメッセージが表示される

Scenario: 新しいエラータイプの追加
  Given 開発者が新しい外部API統合を追加する
  When 新しいエラーコードを分類する必要がある
  Then 共有エラー分類モジュールに1箇所追加するだけで
  And ポップアップとサービスワーカーの両方で利用可能になる

Scenario: 既存エラータイプの互換性
  Given 既存のコードが `ErrorType.NETWORK` を使用している
  When 統一エラー分類に移行する
  Then 既存のエラータイプがすべて新しい分類にマッピングされる
  And 後方互換性が維持される
```

## 受け入れ基準
- [ ] 共有エラー分類モジュールが `src/utils/errorClassification.ts` に作成される
- [ ] `ErrorType` enum が1つに統一される
- [ ] `classifyError`, `formatUserMessage`, `getUserMessage` が共有モジュールに集約される
- [ ] `src/popup/errorUtils.ts` が共有モジュールをimportする形に変更される
- [ ] `src/utils/errorMessages.ts` が共有モジュールをimportする形に変更される
- [ ] 既存のテストがすべてパスする
- [ ] 新しい統合テストが追加される

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- ネットワークエラー発生時にポップアップにエラーメッセージが表示されることを確認

### 統合テスト
- 共有エラー分類モジュールのエクスポートインターフェース検証
- 既存のエラータイプがすべて新しい分類にマッピングされることの確認

### 単体テスト
- 各エラータイプの分類ロジック
- メッセージフォーマットの正確性
- 互換性マッピングの網羅性

## 実装アプローチ
- **Outside-In**: E2Eテストから開始し、失敗を確認してから実装
- **Red-Green-Refactor**: TDDサイクルを各レイヤーで適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり
5pt （要チームでの見積もり）

## 技術的考慮事項
- 依存関係: `chrome.i18n.getMessage` のモックが必要
- テスタビリティ: 共有モジュールは純粋関数としてテスト可能
- 非機能要件: 既存のエラーハンドリング性能を維持

## 実装者向け注記

### 現状コードの確認
```bash
# 既存のエラー分類システムを検索
grep -rn "ErrorType" src/utils/errorMessages.ts src/popup/errorUtils.ts
grep -rn "classifyError\|getErrorType" src/
```

### 実装手順
1. `src/utils/errorClassification.ts` を新規作成
2. 既存の `ErrorType` enum を統合
3. `classifyError`, `formatUserMessage` を共有モジュールに移動
4. `src/popup/errorUtils.ts` を共有モジュールをimportする形に変更
5. `src/utils/errorMessages.ts` を共有モジュールをimportする形に変更
6. 既存テストを更新
7. 新しい統合テストを追加

### 落とし穴
- `chrome.i18n.getMessage` のモックが不完全だとテストが失敗する
- 既存のエラータイプの互換性を維持するためにマッピングテーブルが必要

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み
