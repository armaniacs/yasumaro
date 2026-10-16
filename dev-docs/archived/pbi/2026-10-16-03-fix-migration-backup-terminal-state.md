# PBI: 移行バックアップに終端保証を付ける（空stuck・不一致リプレイ）

## ユーザーストーリー
旧 IDB 履歴の保持者として、移行チェックが毎起動リトライで残り続けてほしくない。なぜなら終わらない warn と全量リプレイは起動コストと quota を食い続けるから。

## 優先度
- 順位: 03 / 08
- RICEスコア: 64（Reach=20 / Impact=2 / Confidence=0.8 / Effort=0.5）
- 根拠: legacy 保持者の一部だが発火すれば毎起動の実害。修正は条件分岐の終端追加で Effort 小。依存なし。

## 背景
adversarial-code-review (2026-10-16) の検証通過指摘 (ハッカー S8a/S8b、保守 #1/#2 と収束)。反証で配線確認済み。
- 0件バックアップは `actualCount >= expectedCount && expectedCount > 0` (`src/offscreen/sqliteEngineContext/migrationBackup.ts:360`) で永久に成功扱いにならず、削除も done もなく毎起動 warn を繰り返す。新規ユーザーは `:207-210` で除外されるが空 legacy DB 所有者は stuck する。
- count 不一致復元経路 (`:368-384`) に `remove` / `done` がなく次回起動で必ず再検証する。正常系は次回収束するが挿入不能行があると無限ループ。done 設定は grep で3箇所のみ (`208,349,363`)。
- 却下済み関連: `databases()` 未対応の素通り・payload 形状・`!` assertion・finally 上書き・Set 同期・`LIMIT 0`・qualify・executor 束縛・INIT 遅延・cap 超過・RESTORE 空・test seam・e2e 系はいずれも配線・テストで反証済みのため対象外。

## BDD受け入れシナリオ
Scenario: 空バックアップは終端する
  Given records 0件のバックアップ
  When `runMigrationRestore` を実行する
  Then バックアップを破棄し done を立て、2回目は warn を出さない

Scenario: 不一致復元は終端する
  Given actualCount < expectedCount の状態
  When 復元を実行する
  Then 復元後に done を立てるか bounded な再試行上限で終わり、毎起動の全量リプレイが残らない

Scenario: 正常系は従来通り
  Given 件数一致
  When 実行する
  Then バックアップ破棄＋done（既存テスト緑）

## 受け入れ基準
- [x] 空・不一致の両経路に終端（done＋backup 削除または上限付き再試行）がある
- [x] 既存の移行テストが緑（期待更新は最小）
- [x] `npx vitest run src/offscreen/sqliteEngineContext/` 全緑

## テスト戦略
- 単体: 上記シナリオの Red→Green（fake engine 注入、実時間待ちなし）
- 既存: offscreen 移行系テストで回帰確認

## 見積もり
1.0 SP（終端方針の決定＋テストを含む）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）
