# PBI: ステータス CSS クラス名の STATUS_CLASS 定数統一

## ユーザーストーリー

保守者として、ステータス表示の CSS クラス名（'success' / 'error'）を production とテストで共有する STATUS_CLASS 定数に統一したい。15 件超のテストがリテラルの className を pin しており、クラス名変更時に production とテストが別々に壊れるからだ。

## 優先度

- 種別: refactor
- 順位: 07 / 20
- RICEスコア: 10.0（Reach=5 / Impact=1 / Confidence=1.0 / Effort=0.5 SP）
- 根拠: 単一定数への統一でクラス名変更の影響範囲が 1 箇所に縮む。動作非変更のためリスクが低い。
- 依存: なし

## 背景

- `src/popup/__tests__/main.test.ts:563,575,593,618,689,720,777,806,838,875,908,937,965,1014,1061` — 15 件超のアサーションがリテラル 'success' / 'error' を pin。
- `src/popup/__tests__/recordOrchestrator.test.ts` — 同様のリテラル pin。
- production 側のリテラル: `src/popup/errorUtils.ts:233,257`、`src/popup/privatePageDialog.ts:107-114`。

## BDD受け入れシナリオ

```gherkin
Scenario: ステータス表示のクラス名は STATUS_CLASS から供給される
  Given errorUtils がステータス表示を更新する
  When className が設定される
  Then 設定値は STATUS_CLASS 定数と一致し、見た目は変更前と同一である

Scenario: クラス名のリネームは 1 箇所の変更で完結する
  Given production とテストが STATUS_CLASS を参照している
  When STATUS_CLASS の値を 1 箇所で変更する
  Then production の表示とテストのアサーションが同時に新しい値に追従する
  And テストが実コードと無関係なリテラルで合格することはない
```

## 受け入れ基準

- [ ] STATUS_CLASS 定数が production 側の共有位置に定義されている。
- [ ] `errorUtils.ts:233,257` のリテラルが STATUS_CLASS 参照に置き換わっている。
- [ ] `privatePageDialog.ts:107-114` のリテラルが STATUS_CLASS 参照に置き換わっている。
- [ ] `main.test.ts` および `recordOrchestrator.test.ts` のクラス名アサーションが STATUS_CLASS 参照に置き換わっている。
- [ ] DOM への適用結果（クラス名の文字列）は変更前と同一である。
- [ ] CSS 側のセレクタ定義は変更していない。
- [ ] `npm run validate` が成功している。

## テスト戦略（t_wadaスタイル）

### 単体テスト

- 既存アサーションを STATUS_CLASS 参照へ置き換える。リテラルの単純置換で検証を弱めず、状態遷移に対するクラス適用を検証し続ける。
- 検証内容は維持し、pin 対象だけをリテラルから定数へ移す。

### 統合テスト

- errorUtils / privatePageDialog が同一の STATUS_CLASS を参照し、表示が変更前と同一であることを確認する。

## 見積もり

**0.5 SP**

定数定義、production 2 ファイルとテスト 2 ファイルの機械的置換、パリティ確認が主体。

## Definition of Done

- [ ] STATUS_CLASS 定数が production とテストから参照されている。
- [ ] production 側のクラス名リテラルが残っていない。
- [ ] テスト側のリテラル pin が解消されている。
- [ ] DOM 適用結果に回帰がない。
- [ ] `npm run validate` が成功している。
- [ ] BDD 受け入れシナリオとテスト戦略の検証が完了している。
- [ ] コードレビューが完了している。
