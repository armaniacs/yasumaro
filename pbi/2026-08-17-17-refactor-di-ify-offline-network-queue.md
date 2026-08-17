# PBI: OfflineNetworkQueue を DI 化する

## ユーザーストーリー
開発者として、`OfflineNetworkQueue` が `sharedOfflineNetworkQueue` シングルトンとして直接インポートされている状態を解消したい。なぜなら、RecordingPipeline と buildRecordingPipelineDeps が直接インポートしているため、テスト時にモックキューを注入できないから。

## ビジネス価値
- テスト時にモックキューを注入できるようになる
- オフラインリトライ動作が独立してテストできる
- 本番とテストで異なるキューを注入できる柔軟性を得る

## BDD受け入れシナリオ

```gherkin
Scenario: 本番環境でのオフラインキュー
  Given 共有 OfflineNetworkQueue が注入されている
  When オフラインリトライジョブがキューされる
  Then ジョブが永続化される

Scenario: テスト環境でのオフラインキュー
  Given NoOpOfflineNetworkQueue が注入されている
  When オフラインリトライジョブがキューされる
  Then ジョブは無視される

Scenario: キューの注入
  Given RecordingPipelineDeps に offlineNetworkQueue が含まれる
  When RecordingPipeline が作成される
  Then 注入されたキューが使用される
```

## 受け入れ基準
- [ ] RecordingPipelineDeps に offlineNetworkQueue がオプショナルで含まれている
- [ ] buildRecordingPipelineDeps が sharedOfflineNetworkQueue を直接インポートしない
- [ ] テストが NoOpOfflineNetworkQueue を使用している
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存のE2Eシナリオがパスすることを確認

### 統合テスト
- オフラインリトライの統合テストを追加

### 単体テスト
- NoOpOfflineNetworkQueue を使用した単体テストを追加

## 実装アプローチ
- **Outside-In**: RecordingPipelineDeps に offlineNetworkQueue を追加し、依存を注入
- **Red-Green-Refactor**: 修正後に型エラーが発生する場合のみ修正

## 見積もり
1ポイント

## 技術的考慮事項
- 依存関係: なし（独立して実装可能）
- テスタビリティ: NoOpOfflineNetworkQueue により改善
- リスク: 低（オプショナルパラメータの追加のみ）

## 実装者向け注記

### 現状コードの確認
```bash
# sharedOfflineNetworkQueue の使用箇所を確認
grep -rn "sharedOfflineNetworkQueue" src/ --include="*.ts" | grep -v test | grep -v __tests__
```

### 実装手順
1. RecordingPipelineDeps に offlineNetworkQueue をオプショナルで追加
2. buildRecordingPipelineDeps から sharedOfflineNetworkQueue の直接インポートを除去
3. createBackgroundServices.ts で sharedOfflineNetworkQueue を注入
4. テストを NoOpOfflineNetworkQueue 使用に更新

### 落とし穴
- sharedOfflineNetworkQueue はモジュールレベルのシングルトン。ファクトリ関数に変更するか、モジュールレベルのデフォルトを維持するか判断すること

## Definition of Done
- [ ] buildRecordingPipelineDeps が sharedOfflineNetworkQueue を直接インポートしない
- [ ] テストが NoOpOfflineNetworkQueue を使用している
- [ ] 全テストがパスしている
- [ ] コードレビュー完了
