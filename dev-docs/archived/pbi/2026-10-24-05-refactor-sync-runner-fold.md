# PBI: SyncBatchRunnerの畳み込み

## ユーザーストーリー

保守担当者として、仮説のseamを畳みたい。なぜならadapterがGistのみで、loop方針の学習costが唯一の利用者に転嫁しているから。

## 優先度

- 順位: 05 / 全8件
- RICE スコア: 5.3（Reach = 4 / Impact = 1 / Confidence = 1.0 / Effort = 0.75人日）
- 根拠: deletion testでdepthなしが確定。外部interface不変の小手術。

## ビジネス価値

学ぶinterfaceが減り、batch方針の変更が利用者と同所に集まる。

## BDD受け入れシナリオ

```gherkin
Scenario: 同期が変更前と同一に動く
  Given 同期対象がある
  When 同期する
  Then 変更前と同一に処理される

Scenario: batch方針が利用者側に集まる
  Given 方針を変えたい
  When 変える
  Then Gist側の1箇所で済む
```

## 受け入れ基準

- [x] runnerがGist側内部seamに畳まれる（外部interface不変）
- [x] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- 同期フローテスト維持

### 単体テスト
- batch loopのテスト移設

## 実装アプローチ

- **Outside-In**: 既存テストが緑のまま移設されることを確認する

## 見積もり

1pt（🟢低）

## 技術的考慮事項

- 依存関係: なし
- 非機能要件: 外部interface・batchSize/iterations/0件停止の振舞い不変。EXPERIMENTAL表示を保つ

## 変更点の概要

runnerを内部seamに畳み、2つ目のadapter出現時に再抽出する。

## 現状と問題（file:line 付き）

- `src/background/syncTargets/SyncTarget.ts:15-46` ― interface
- `src/background/syncTargets/SyncBatchRunner.ts:19-109` ― ports＋batch loop
- `src/background/syncTargets/gistSyncTarget.ts:32-123` ― 唯一のadapter

## 変更の理由（depth）

One adapter means a hypothetical seam。畳んで回収する。

## 提案コード（骨子のみ）

```typescript
// runnerのloopをgist側内部に移し、外部interfaceは不変に保つ。
// 再抽出条件（2つ目のadapter）をコメントに残す。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -rn "SyncBatchRunner\|SyncTarget" src/background/syncTargets/ --include='*.ts' | grep -v __tests__ | head
```

### 落とし穴

- 外部interfaceを変えない（呼び側の変更なし）
- 再抽出条件を記録する

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過
- [x] コードレビュー完了
- [x] `npm run validate` 通過
- [x] ドキュメント更新済み
