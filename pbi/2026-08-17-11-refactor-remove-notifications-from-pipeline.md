# PBI: パイプラインオーケストレータから chrome.notifications を除去する

## ユーザーストーリー
開発者として、`RecordingPipeline.buildErrorResult` が `chrome.notifications.create` を呼び出している状態を解消したい。なぜなら、パイプラインのオーケストレータに Chrome API の side effect があると、テスト時に chrome.notifications をモックする必要が生じ、テストが複雑になるから。

## ビジネス価値
- パイプラインが pure なオーケストレータになり、テストが簡単になる
- 通知ロジックがハンドラ層に集中し、変更時の影響範囲が局所化される
- テスト時の chrome API モックが不要になる

## BDD受け入れシナリオ

```gherkin
Scenario: エラー発生時の通知
  Given パイプラインがエラーを検出する
  When buildErrorResult が呼ばれる
  Then 通知は作成されない
  And エラー結果が RecordingResult として返される

Scenario: 呼び出し元での通知
  Given パイプラインがエラー結果を返す
  When ハンドラ層がエラー結果を受け取る
  Then ハンドラ層が chrome.notifications.create を呼び出す
  And 通知が表示される

Scenario: テストでのモック不要
  Given パイプラインに chrome.notifications がない
  When パイプラインの単体テストを実行する
  Then chrome.notifications のモックが不要になる
```

## 受け入れ基準
- [ ] RecordingPipeline に `chrome.notifications.create` の呼び出しがない
- [ ] 通知ロジックがハンドラ層に移動している
- [ ] パイプラインの単体テストが chrome notifications モックなしで実行できる
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存のE2Eシナリオがパスすることを確認

### 統合テスト
- エラー発生時に通知が正しく表示されることを検証

### 単体テスト
- パイプラインの単体テストが chrome notifications モックなしで実行できることを確認

## 実装アプローチ
- **Outside-In**: パイプラインから通知を除去し、ハンドラ層に移動
- **Red-Green-Refactor**: 移動後にテストがパスすることを確認

## 見積もり
1ポイント

## 技術的考慮事項
- 依存関係: PBI-10（result-building抽出）が前提
- テスタビリティ: テスト時のモックが不要になる
- リスク: 低（通知の移動のみ）

## 実装者向け注記

### 現状コードの確認
```bash
# chrome.notifications の使用箇所を確認
grep -rn "chrome\.notifications" src/background/pipeline/ --include="*.ts"
```

### 実装手順
1. RecordingPipeline の buildErrorResult から chrome.notifications.create を除去
2. 通知ロジックを service-worker.ts のハンドラ層に移動
3. テストを更新

### 落とし穴
- 通知は pipeline-error と obsidian-write-failed の2パターンで呼ばれる。両方のパターンをハンドラ層に移動すること

## Definition of Done
- [ ] RecordingPipeline に chrome.notifications がない
- [ ] 通知がハンドラ層から正しく表示される
- [ ] 全テストがパスしている
- [ ] コードレビュー完了
