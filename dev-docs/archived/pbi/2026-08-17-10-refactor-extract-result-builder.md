# PBI: RecordingPipeline から result-building を抽出する

## ユーザーストーリー
開発者として、`RecordingPipeline` の `buildResult`、`buildErrorResult`、`buildPrivatePageResult` の3つの結果構築メソッドと、side effect（chrome.notifications、addPendingPage）を専用モジュールに抽出したい。なぜなら、パイプラインのオーケストレータが結果構築と通知を混在させているため、結果構築ロジックの単体テストが困難だから。

## ビジネス価値
- 結果構築ロジックが1モジュールに集中し、テストが容易になる
- パイプラインのオーケストレータが純粋になり、side effect が分離される
- 通知ロジックがハンドラ層に移動し、テスト時の chrome API モックが不要になる

## BDD受け入れシナリオ

```gherkin
Scenario: 結果構築の抽出
  Given buildResult / buildErrorResult / buildPrivatePageResult が RecordingResultBuilder に移動している
  When パイプラインがステップを実行する
  Then 結果は RecordingResultBuilder が構築する
  And パイプラインはオーケストレーションのみを行う

Scenario: 通知ロジックの分離
  Given chrome.notifications.create がパイプラインから除去されている
  When エラーが発生する
  Then パイプラインが RecordingResult を返す
  And 通知は呼び出し元（ハンドラ層）が作成する

Scenario: 結果構築の単体テスト
  Given RecordingResultBuilder が独立したモジュールとして存在する
  When buildErrorResult をテストする
  Then chrome.notifications のモックなしでテストできる
```

## 受け入れ基準
- [ ] `RecordingResultBuilder` モジュールが新設されている
- [ ] buildResult / buildErrorResult / buildPrivatePageResult が RecordingResultBuilder に移動している
- [ ] RecordingPipeline が RecordingResultBuilder を呼び出すようになっている
- [ ] RecordingPipeline に `chrome.notifications.create` がない
- [ ] RecordingPipeline に `addPendingPage` の呼び出しがない
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存のE2Eシナリオがパスすることを確認

### 統合テスト
- パイプライン全体の実行テストがパスすることを確認
- 結果が正しく構築されることを検証

### 単体テスト
- RecordingResultBuilder の単体テストを追加（chrome API モックなし）
- 各 build メソッドのパラメータ検証テストを追加

## 実装アプローチ
- **Outside-In**: RecordingResultBuilder を定義し、RecordingPipeline からの呼び出しに置換
- **Red-Green-Refactor**: 置換後に型エラーが発生する場合のみ修正

## 見積もり
2ポイント

## 技術的考慮事項
- 依存関係: なし（独立して実装可能）
- テスタビリティ: 結果構築の単体テストが可能になる
- リスク: 低（メソッドの移動のみ）

## 実装者向け注記

### 現状コードの確認
```bash
# buildResult の使用箇所を確認
grep -n "buildResult\|buildErrorResult\|buildPrivatePageResult" src/background/pipeline/RecordingPipeline.ts
# chrome.notifications の使用箇所を確認
grep -n "chrome.notifications" src/background/pipeline/RecordingPipeline.ts
# addPendingPage の使用箇所を確認
grep -n "addPendingPage" src/background/pipeline/RecordingPipeline.ts
```

### 実装手順
1. RecordingResultBuilder モジュールを新設
2. buildResult / buildErrorResult / buildPrivatePageResult を RecordingResultBuilder に移動
3. RecordingPipeline が RecordingResultBuilder を呼び出すよう修正
4. chrome.notifications.create と addPendingPage を RecordingPipeline から除去
5. 呼び出し元（service-worker.ts のハンドラ）に通知ロジックを移動
6. テストを更新

### 落とし穴
- addPendingPage は pipeline-error と obsidian-write-failed の2パターンで呼ばれる。両方のパターンをハンドラ層に移動すること
- buildErrorResult が chrome.i18n.getMessage を使用している。これもハンドラ層に移動すること

## Definition of Done
- [ ] RecordingResultBuilder が独立したモジュールとして存在する
- [ ] RecordingPipeline に chrome.notifications がない
- [ ] 全テストがパスしている
- [ ] コードレビュー完了
