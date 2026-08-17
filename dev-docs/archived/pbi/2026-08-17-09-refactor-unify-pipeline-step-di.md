# PBI: パイプラインステップの DI パターンを統一する

## ユーザーストーリー
開発者として、パイプラインステップが3種類の異なるDIパターンを使用している状態を解消したい。なぜなら、パラメータ経由、context.aiService、内部new の3パターンが混在すると、テスト時のモック戦略がステップごとに異なり、保守成本が増すから。

## ビジネス価値
- 全ステップが同じDIパターンを採用し、テスト時のモック戦略が統一される
- ステップの依存関係が1つの StepDeps インターフェースで可視化される
- ステップ内部での new ObsidianClient() フォールバックが排除される

## BDD受け入れシナリオ

```gherkin
Scenario: 統一された DI パターン
  Given 全パイプラインステップが StepDeps を受け取る
  When ステップをテストする
  Then StepDeps をモックしてテストできる
  And chrome API のモックが不要になる

Scenario: saveToObsidianStep のフォールバック排除
  Given saveToObsidianStep が StepDeps 経由で ObsidianClient を受け取る
  When obsidian が未注入の場合
  Then ステップが new ObsidianClient() を作成しない
  And 代わりに StepDeps から取得する

Scenario: processPrivacyPipelineStep のDI統一
  Given processPrivacyPipelineStep が StepDeps.aiService を使用する
  When ステップをテストする
  Then context.aiService にアクセスしない
  And StepDeps.aiService から取得する
```

## 受け入れ基準
- [ ] 全パイプラインステップが `execute(context, deps)` のシグネチャを持っている
- [ ] StepDeps インターフェースが1つだけ定義されている
- [ ] saveToObsidianStep が内部で `new ObsidianClient()` を作成しない
- [ ] processPrivacyPipelineStep が `context.aiService` にアクセスしない
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存のE2Eシナリオがパスすることを確認

### 統合テスト
- パイプライン全体の実行テストがパスすることを確認
- StepDeps のモックが正しく機能することを検証

### 単体テスト
- 各ステップの既存テストが新しいDIパターンでパスすることを確認
- StepDeps のモックを使用したステップ単体テストを追加

## 実装アプローチ
- **Outside-In**: StepDeps インターフェースを定義し、全ステップを順次移行
- **Red-Green-Refactor**: 移行後に型エラーが発生する場合のみ修正

## 見積もり
3ポイント

## 技術的考慮事項
- 依存関係: PBI-07（RecordingContext崩壊）が前提
- テスタビリティ: DI統一により大幅に改善
- リスク: 低（既存パラメータをStepDepsに移行するだけ）

## 実装者向け注記

### 現状コードの確認
```bash
# 各ステップの関数シグネチャを確認
grep -n "export const.*Step.*=.*async" src/background/pipeline/steps/*.ts
# context.aiService の使用箇所を確認
grep -n "context\.aiService" src/background/pipeline/steps/*.ts
# new ObsidianClient の使用箇所を確認
grep -n "new ObsidianClient" src/background/pipeline/steps/*.ts
```

### 実装手順
1. StepDeps インターフェースを pipeline/types.ts に定義
2. 各ステップの execute 関数に deps パラメータを追加
3. RecordingPipeline が StepDeps を構築しステップに渡すよう修正
4. saveToObsidianStep から new ObsidianClient() フォールバックを削除
5. processPrivacyPipelineStep を StepDeps.aiService 使用に変更
6. テストを更新

### 落とし穴
- StepDeps のフィールドはオプショナルにしないこと（ステップごとに必要なものだけを含める）
- 既存のステップが recordingContext 経由で依存を取得している場合、両方のパターンを一時的に許容する移行期間を設けること

## Definition of Done
- [ ] 全ステップが StepDeps を受け取る
- [ ] saveToObsidianStep が内部で new ObsidianClient() を作成しない
- [ ] 全テストがパスしている
- [ ] コードレビュー完了
