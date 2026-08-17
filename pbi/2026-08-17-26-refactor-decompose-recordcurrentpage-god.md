# PBI: recordCurrentPage ゴッド関数を分解する

## ユーザーストーリー
開発者として、`src/popup/recordCurrentPage.ts` の583行ゴッド関数をサブフローに分解したい。なぜなら、15のimport、モジュールレベルの可変状態、DOM操作とビジネスロジックとChrome API呼び出しが混在しており、テストが困難で保守性が損なわれているから。

## ビジネス価値
- 各サブフローが独立してテスト可能になる
- モジュールレベルの可変状態が排除され、bug発見が容易になる
- 保守性が向上し、新しい機能の追加が容易になる

## BDD受け入れシナリオ

```gherkin
Scenario: ページの記録
  Given ユーザーがブラウジングページを表示している
  When 記録ボタンをクリックする
  Then ページ内容が取得され、Obsidianに保存される

Scenario: プレビューフロー
  Given ユーザーがページを記録する
  When プレビューボタンをクリックする
  Then プレビューモーダルが表示される
  And ユーザーが内容を確認して保存できる

Scenario: 強制記録
  Given ページが記録条件を満たさない
  When 強制記録ボタンをクリックする
  Then 確認ダイアログが表示される
  And 確認後にページが記録される
```

## 受け入れ基準
- [ ] `TabContentFetcher` クラスが新規作成される
- [ ] `PreviewFlow` クラスが新規作成される
- [ ] `ForceRecordFlow` クラスが新規作成される
- [ ] `SpinnerManager` クラスが新規作成される
- [ ] `ErrorPresenter` クラスが新規作成される
- [ ] `RecordOrchestrator` が薄いステートマシンになる
- [ ] モジュールレベルの可変状態が排除される
- [ ] 既存のテストがすべてパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- ポップアップでページ記録フローが正常に動作することを確認

### 統合テスト
- 各サブフローのインターフェース検証
- RecordOrchestrator との連携テスト

### 単体テスト
- 各サブフローのロジック
- ステートマシンの遷移
- エラーハンドリング

## 実装アプローチ
- **Outside-In**: E2Eテストから開始し、失敗を確認してから実装
- **Red-Green-Refactor**: TDDサイクルを各レイヤーで適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり
8pt （要チームでの見積もり）

## 技術的考慮事項
- 依存関係: Chrome API（tabs, scripting, permissions）
- テスタビリティ: インスタンス化によりテストが容易になる
- 非機能要件: UIの応答性を維持

## 実装者向け注記

### 現状コードの確認
```bash
# モジュールレベル変数を検索
grep -rn "isAwaitingForceConfirm\|isShowingResultState\|_recordCurrentPageFn" src/popup/recordCurrentPage.ts
# import数を確認
grep -rn "^import" src/popup/recordCurrentPage.ts | wc -l
```

### 実装手順
1. 各サブフロークラスを新規作成
2. モジュールレベル変数をクラスプロパティに移動
3. RecordOrchestrator を薄いステートマシンに変換
4. 既存テストを更新
5. 新しいユニットテストを追加

### 落とし穴
- Chrome API のモックが不完全だとテストが失敗する
- 既存のテストがDOM構造に依存しているため、テストの更新が必要

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み
