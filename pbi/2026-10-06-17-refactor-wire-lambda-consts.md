# PBI: wire 表の単要素ラムダ群を共有ファクトリに置換する

## ユーザーストーリー

wire 表の保守担当者として、単要素ラムダを定数化したい。各表に分散複製され、レビュー時に「意図的空」と「書き忘れ」の区別が付かず、新規行追加時のコピペ元になるから。

## 優先度

- 順位: 16/23
- RICE: 1.5（R3 / I0.5 / C1.0 / E1）
- 根拠: 可読性・保守性の小改善。NN11 着地後（同一ファイルの編集競合回避）
- 依存: NN11

## 背景（file:line 現状）

- `src/messaging/sqliteWireTable.ts:221` / `:241`（`() => ({})`）、`:239` / `:259`（`() => null`）、`:240` / `:260`（`[p.id]`）
- `src/messaging/archiveWireTable.ts:182,236,258,282,310,345,431,471`（`() => null` 8 複製）、`:351-353` / `:350`（`() => ({})`＋空 project の対）

## BDD受け入れシナリオ

```gherkin
Scenario: 単要素ラムダが共有参照になる
  Given 各表の該当行
  When 読む
  Then noValidate / emptyProject / idArg 等の共有ファクトリ参照になっている
```

## 受け入れ基準

- [x] `messaging/` に共有ファクトリが置かれている
- [x] 全該当行が参照に置換され、振る舞い不変である
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 既存 wire 表テストが green
- 実時間待ちは使わない

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: 新規 `wireLambdaFactories.ts`（8 ファクトリ。freshness あり共有定数ではない）、両 wire 表の 42 サイト置換、新規テスト（freshness＋共有参照固定）
- ゲート: 対象 4 ファイル 45 tests green / type-check PASS / lint 0 errors
