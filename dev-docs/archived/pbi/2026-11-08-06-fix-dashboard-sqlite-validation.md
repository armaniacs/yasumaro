# PBI DASHBOARD_SQLITEの行・値検証

## ユーザーストーリー

履歴利用者として、取込や更新で不正な型・値の行が保存層に混入しないようにしてほしい、なぜなら不正行は後続の検索・エクスポート・リマインダへ波及するから。

## 優先度

- 順位: 06/17
- RICE: 107 (Reach=100 / Impact=2 / Confidence=80% / Effort=1.5人日)
- 根拠: データ完全性。送信者は拡張ページ文脈に限定されるがユーザ取込ファイル経路が残る。

## 対象の指摘(検証済み)

- (1) src/messaging/validators.ts:437-443 ― importスペックが行内fieldを見ない。
- (2) src/background/handlers/dashboardSqlite/maintenanceBatchHandler.ts:125-160 ― 型検査なしでinsertBatchへ。
- (3) src/messaging/sqliteWireTable.ts:177-183/228-243 ― encodeOpとupdate検証はidと非空のみ。
- (4) src/background/handlers/dashboardSqlite/coreCrudHandler.ts:61-66 ― キー部分集合のみで値不問。
- (5) offscreen側 sqliteMessageHandlers.ts:83-103からbrowsingLogCodec.ts:34-72は強制型変換のみで拒否なし。

## BDD受け入れシナリオ

### シナリオ1 ハッピーパス: 正規の取込・更新は成功する

- Given 正規の型と値を持つ履歴行がある
- When 取込または更新を実行する
- Then 検証を通過し保存層に反映される

### シナリオ2 エラー系: 不正型の行は検証で拒否される

- Given 型が不正な行を含む取込データがある
- When 取込の検証を実行する
- Then 当該行は拒否され正規行への影響なく記録される

### シナリオ3 境界値: 不正値は更新時に拒否される

- Given 不正な値を持つ更新要求がある
- When 更新の検証を実行する
- Then 更新は拒否され既存の保存内容が保たれる

## 受け入れ基準

- 行と値の検証が取込経路と更新経路に追加されていること。
- 不正型の行が保存層に混入しないこと。
- 不正値の更新が拒否され既存データが保たれること。
- 回帰テストが追加され既存の正規経路が壊れていないこと。

## テスト戦略

- 単体テスト: 不正行列(型違い、空値、不正値)に対する検証の可否を確認する。
- 統合テスト: import経路で不正行混入時に拒否と記録が行われることを確認する。
- 既存の正規取込・更新の回帰テストを実行する。

## 見積もり

- M

## Definition of Done

- 全BDDシナリオが自動テスト化されていること。
- 回帰テストが成功していること。
- レビューが完了していること。

## 出典

- adversarial-code-review 2026-11-08
