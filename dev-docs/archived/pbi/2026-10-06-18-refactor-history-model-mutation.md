# PBI: sqliteHistoryModel の mutation 後処理をヘルパーに寄せる

## ユーザーストーリー

履歴パネルの保守担当者として、mutation 後処理を 1 つにしたい。4 操作が分岐→dispatch→無効化→通知を手書きし、一括削除は単体削除のループ再実装で、エラーポリシーと通知の有無が箇所ごとにずれるから。

## 優先度

- 順位: 18/23
- RICE: 1.6（R4 / I1 / C0.8 / E2）
- 根拠: 1 ファイル。reducer・fetchData は不変
- 依存: NN07（同一ファイル。ガードヘルパー確定後）

## 背景（file:line 現状）

すべて `src/dashboard/panels/asyncData/sqliteHistoryModel.ts`:

- `:597-600`（`invalidateCache` が `void reason` で理由不使用）
- `:659-672`（toggleStarImpl）、`:674-692`（deleteEntry）、`:695-730`（deleteSelectedEntries。ループ内再実装）、`:732-743`（appendSelectedToObsidian）
- 反復ペア: `:597-600,670-671,690-691,723-724,738-739`
- 不変: reducer `:109-249`、`fetchData :457-518`、`historyQueryCache` ポリシー、`ReloadGuard` 世代管理

## BDD受け入れシナリオ

```gherkin
Scenario: 後処理がヘルパー経由になる
  Given 4 操作のいずれかの成功・失敗時
  When 処理する
  Then mutateWithInvalidation を経由し、dispatch・無効化・通知が統一されている

Scenario: 一括削除が委譲する
  Given 一括削除
  When 実行する
  Then URL 回収のみ残して本体を委譲し、エラーポリシーが単体削除と一致する
```

## 受け入れ基準

- [x] `mutateWithInvalidation(fn)` 内部ヘルパーに早期復帰と成功時処理が寄っている
- [x] 一括削除が委譲し、URL 回収（`:699-702`）のみ残っている
- [x] `invalidateCache` の `reason` がログ用に保持されるか、引数ごと畳まれている（`void` 残しなし）
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 既存 historyModel テストが green
- 実時間待ちは使わない

## 見積もり

2 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `sqliteHistoryModel.ts` のみ（ヘルパー＋委譲。`reason` 引数は畳み。reducer/fetchData 不変）
- ゲート: colocated 5 ファイル 27 tests green / type-check PASS / lint 0 errors
