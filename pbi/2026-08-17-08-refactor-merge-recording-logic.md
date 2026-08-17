# PBI: RecordingLogic を RecordingPipeline に統合する

## ユーザーストーリー
開発者として、`RecordingLogic` の149行の薄い委譲レイヤーを `RecordingPipeline` に統合したい。なぜなら、RecordingLogic は主に mutex 取得と設定取得を行ってから pipeline.execute() を呼び出すだけで、`retryObsidianWriteOnly` がパイプラインをバイパスして手動でステップを呼び出しているため、オーケストレーションロジックが2箇所に分散しているから。

## ビジネス価値
- 記録オーケストレーションが1モジュールに集中し、変更時の影響範囲が局所化される
- retryObsidianWriteOnly がパイプラインのステップチェーンを再利用し、ステップ追加時の追加作業が不要になる
- RecordingLogic の149行が不要になり、コードベースが縮小する

## BDD受け入れシナリオ

```gherkin
Scenario: 通常の記録パス
  Given RecordingLogic が RecordingPipeline に統合されている
  When 記録リクエストが来る
  Then パイプラインが mutex を取得してからステップを実行する
  And 結果が返される

Scenario: オフラインリトライ
  Given オフラインキューにリトライジョブが存在する
  When retryObsidianWriteOnly が呼ばれる
  Then パイプラインの formatMarkdown + saveObsidian ステップが再利用される
  And 手動でステップを呼び出すコードがない

Scenario: 既存テストの維持
  Given RecordingLogic の既存テストが存在する
  When 統合が完了する
  Then 既存テストがすべてパスする
  And テストの期待値が更新されている
```

## 受け入れ基準
- [ ] RecordingLogic クラスが削除されている
- [ ] RecordingLogic の责務（mutex、settings fetch、retryObsidianWrite）が RecordingPipeline に移動している
- [ ] retryObsidianWriteOnly がパイプラインのステップチェーンを再利用している
- [ ] createBackgroundServices.ts が RecordingLogic の作成をしない
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存のE2Eシナリオがパスすることを確認

### 統合テスト
- RecordingPipeline のテストで mutex 取得・設定取得を含むテストを追加
- retryObsidianWrite の統合テストを追加

### 単体テスト
- RecordingLogic の既存テストを RecordingPipeline のテストに移行
- mutex の並行性テストを追加

## 実装アプローチ
- **Outside-In**: RecordingLogic の呼び出し箇所を特定し、RecordingPipeline に移設
- **Red-Green-Refactor**: 移設後に型エラーが発生する場合のみ修正

## 見積もり
3ポイント

## 技術的考慮事項
- 依存関係: PBI-07（RecordingContext崩壊）が前提
- テスタビリティ: 統合によりモジュール数が減り、テストが簡単になる
- リスク: 中（service-worker.ts の呼び出し箇所を修正する必要がある）

## 実装者向け注記

### 現状コードの確認
```bash
# RecordingLogic の呼び出し箇所を検索
grep -rn "RecordingLogic\|recordingLogic" src/ --include="*.ts" | grep -v test | grep -v __tests__
# retryObsidianWriteOnly の呼び出し箇所を検索
grep -rn "retryObsidianWriteOnly" src/ --include="*.ts"
```

### 実装手順
1. RecordingLogic の呼び出し箇所をすべて特定
2. RecordingPipeline に mutex ロジックと settings fetch を追加
3. retryObsidianWriteOnly を RecordingPipeline のメソッドとして実装
4. createBackgroundServices.ts から RecordingLogic の作成を削除
5. 既存テストを RecordingPipeline のテストに移行
6. `npm run validate` で型エラーがないことを確認

### 落とし穴
- RecordingLogic の static urlRecordMutexes は並行性制御に使用。RecordingPipeline でも同じパターンを維持すること
- retryObsidianWriteOnly は formatMarkdownStep と saveToObsidianStep を直接呼び出していた。統合後はパイプラインのステップチェーンを再利用する

## Definition of Done
- [ ] RecordingLogic クラスが削除されている
- [ ] retryObsidianWriteOnly がパイプラインを再利用している
- [ ] 全テストがパスしている
- [ ] コードレビュー完了
