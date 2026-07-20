# PBI: record()呼び出しごとのPipeline新規生成をファクトリ抽出で最適化

## ユーザーストーリー
開発チームとして、`record()` メソッドが呼ばれるたびに新しい `RecordingPipeline` インスタンスを生成する処理を見直したい、なぜなら現状は毎回のインスタンス生成コストが発生しており、特にプレビュー用途など軽量な処理でもフルパイプラインが生成されているから

## ビジネス価値
- 記録処理のパフォーマンス改善（インスタンス生成コスト削減）
- 用途に応じた軽量パイプライン（プレビュー等）の切り出しにより、無駄な依存注入を削減

## 実装者向け注記（フェーズ0の既実装確認結果）

Read で確認済み:
- `src/background/recordingLogic.ts:396-401`（`record()`メソッド）— 呼び出しのたびに `new RecordingPipeline(this.getPrivacyInfoWithCache.bind(this), this.obsidian, this.aiService, this.sqliteClient)` を生成
- 対処案（親レポートより）: 軽量プレビューパイプラインを返すファクトリを導入
- side-effects.md L7判定: 「ファクトリ抽出は既存の`record()`呼び出し元に影響しない範囲で対応可能」（副作用なし）

```bash
# 実装前の再確認コマンド
sed -n '390,405p' src/background/recordingLogic.ts
grep -n "new RecordingPipeline" src/background/*.ts src/background/**/*.ts 2>&1 | grep -v __tests__
grep -n "class RecordingPipeline\|constructor" src/background/pipeline/RecordingPipeline.ts | head -5
```

## BDD受け入れシナリオ

```gherkin
Scenario: 通常の記録処理でファクトリ経由のPipelineが従来通り動作する
  Given record()が呼び出される
  When ファクトリ関数経由でRecordingPipelineインスタンスを取得する
  Then 従来と同じ依存（getPrivacyInfoWithCache, obsidian, aiService, sqliteClient）が注入されたPipelineが返る
  And 記録処理は変更前と同じ結果になる

Scenario: プレビュー用途では軽量なPipelineが生成される
  Given previewRecord()相当のプレビュー専用フローが呼び出される
  When 軽量プレビューパイプラインファクトリを使用する
  Then フル機能のPipelineより少ない依存注入で軽量に動作する
```

## 受け入れ基準
- [ ] `RecordingPipeline` インスタンス生成をファクトリ関数（例: `createRecordingPipeline(deps)`）として抽出
- [ ] `record()` メソッドはファクトリ経由でPipelineを取得するよう変更
- [ ] 既存の記録処理フローに回帰がない
- [ ] （オプション、影響調査次第）プレビュー用途向けの軽量ファクトリを追加

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- 不要

### 統合テスト
- `record()` 呼び出しがファクトリ経由でPipelineを取得し、既存のエンドツーエンドの記録フローが変わらないことを検証

### 単体テスト
- ファクトリ関数が正しい依存を注入したPipelineインスタンスを返すことを検証

## 実装アプローチ
- **Outside-In**: 既存の `record()` の統合テストがあればそのままパスすることを確認しつつ、ファクトリ抽出のリファクタリングを行う（挙動変更なしのリファクタリングのため、既存テストのグリーン維持がゴール）

## 見積もり
2pt（半日。既存呼び出し元への影響確認を含む）

## 技術的考慮事項
- 依存関係: `RecordingLogic` クラス内の他メソッドに影響しないことを確認
- テスタビリティ: ファクトリ関数は純粋関数に近い形にできればテスト容易性が向上
- 非機能要件: パフォーマンス（インスタンス生成コスト削減）

## 落とし穴
- 「軽量プレビューパイプライン」を具体的にどう軽量化するか（どの依存を省略できるか）は、`RecordingPipeline` の内部実装を精査してから判断すること。安易に依存を削ると既存のプレビュー機能が壊れる可能性がある

## Definition of Done
- [ ] ファクトリ関数が抽出されている
- [ ] `record()` がファクトリ経由に変更されている
- [ ] 既存テストが全てパスする（挙動変更なしのリファクタリング）
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
