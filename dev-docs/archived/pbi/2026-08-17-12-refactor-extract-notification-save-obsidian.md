# PBI: saveToObsidianStep から通知を抽出する

## ユーザーストーリー
開発者として、`saveToObsidianStep` が成功時に `NotificationHelper.notifySuccess` を呼び出している状態を解消したい。なぜなら、ステップに通知の side effect があると、ステップの単体テストで chrome API をモックする必要が生じ、テストが複雑になるから。

## ビジネス価値
- saveToObsidianStep が pure なステップになり、テストが簡単になる
- 通知ロジックがハンドラ層に集中し、変更時の影響範囲が局所化される
- テスト時の chrome API モックが不要になる

## BDD受け入れシナリオ

```gherkin
Scenario: Obsidian 保存成功時の通知
  Given saveToObsidianStep が成功する
  When ステップが完了する
  Then 通知は作成されない
  And context.obsidianDuration が設定される

Scenario: 呼び出し元での通知
  Given パイプラインが saveObsidian ステップを実行する
  When ステップが成功する
  Then ハンドラ層が通知を作成する

Scenario: テストでのモック不要
  Given saveToObsidianStep に通知ロジックがない
  When ステップの単体テストを実行する
  Then NotificationHelper のモックが不要になる
```

## 受け入れ基準
- [ ] saveToObsidianStep に `NotificationHelper.notifySuccess` の呼び出しがない
- [ ] 通知ロジックがハンドラ層に移動している
- [ ] ステップの単体テストが NotificationHelper モックなしで実行できる
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存のE2Eシナリオがパスすることを確認

### 統合テスト
- Obsidian 保存成功時に通知が正しく表示されることを検証

### 単体テスト
- saveToObsidianStep の単体テストが NotificationHelper モックなしで実行できることを確認

## 実装アプローチ
- **Outside-In**: saveToObsidianStep から通知を除去し、ハンドラ層に移動
- **Red-Green-Refactor**: 移動後にテストがパスすることを確認

## 見積もり
1ポイント

## 技術的考慮事項
- 依存関係: なし（独立して実装可能）
- テスタビリティ: テスト時のモックが不要になる
- リスク: 低（通知の移動のみ）

## 実装者向け注記

### 現状コードの確認
```bash
# NotificationHelper の使用箇所を確認
grep -rn "NotificationHelper" src/background/pipeline/steps/saveToObsidianStep.ts
```

### 実装手順
1. saveToObsidianStep から NotificationHelper.notifySuccess を除去
2. 通知ロジックを RecordingPipeline の後処理またはハンドラ層に移動
3. テストを更新

### 落とし穴
- 通知は saveToObsidianStep の成功時のみ呼ばれる。失敗時の通知（chrome.notifications.create）は別途対応済みの可能性がある。既存の通知パターンを確認すること

## Definition of Done
- [ ] saveToObsidianStep に NotificationHelper がない
- [ ] 通知が正しく表示される
- [ ] 全テストがパスしている
- [ ] コードレビュー完了
