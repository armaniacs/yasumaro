# PBI: runCoreCrud/runArchive の骨格を runTableDriven に共通化する

## ユーザーストーリー

dashboard sqlite ハンドラの保守担当者として、表駆動の骨格を 1 つにしたい。validate→deps 解決→toFailure→project の 4 手順が 2 ファイルで重複し、片側改善がもう片側に届かないから。

## 優先度

- 順位: 20/23
- RICE: 1.6（R4 / I1 / C0.8 / E2）
- 根拠: 薄いアダプタ化。層ポリシーは残す
- 依存: NN10（差分が小さくなってから）

## 背景（file:line 現状）

- `src/background/handlers/dashboardSqlite/coreCrudHandler.ts:24-37`（runCoreCrud）
- `src/background/handlers/dashboardSqlite/archiveHandler.ts:30-44`（runArchive。`:42` のフォールバック含む）
- 呼び出し側: coreCrud `:54-59` と archive `:46-54` の dispatch 差
- 層ポリシーとして残す: `update` の `DASHBOARD_MUTABLE_SUBSET` 事前検査（`:61-70`）、archive の `DESCRIPTOR_BY_SUBTYPE` 引き（`:26-28`）

## BDD受け入れシナリオ

```gherkin
Scenario: 骨格が共有される
  Given core / archive のいずれかの操作
  When 実行する
  Then runTableDriven を経由し、エラーメッセージとフォールバック解決が統一されている
```

## 受け入れ基準

- [x] `runTableDriven(descriptor, raw, invoke, project)` が `deps.ts` 隣に切り出されている
- [x] 両 handler が薄いアダプタ（メソッド名解決＋エラ prefix）に畳まれている
- [x] 層ポリシー（事前検査・引き）が残っている
- [x] 振る舞い不変
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 既存 dashboardSqlite テストが green
- 実時間待ちは使わない

## 見積もり

2 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `deps.ts`（TableDrivenDescriptor＋runTableDriven）、両 handler（アダプタ化。NN10 のフォールバック維持）
- ゲート: dashboardSqlite 8 ファイル 55 tests green / type-check PASS / lint 0 errors
