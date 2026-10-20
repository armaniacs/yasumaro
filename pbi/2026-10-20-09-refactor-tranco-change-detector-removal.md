# PBI 09: TrancoChangeDetector の削除（死にクラス 271 行・死にキー）

## ユーザーストーリー
メンテナーとして、本番から接続されていない TrancoChangeDetector とその死にキーが削除された状態がほしい、なぜなら本クラスは SSOT 外の生リテラルを直読みし、恒偽の抑制分岐を持つデッドロジックを監査不可視のまま残すから。

## 変更点の概要
TrancoChangeDetector クラス（271 行）と対応テストを削除し、SSOT 宣言キー StorageKeys.TRANCO_NOTIFICATION_SHOWN（死にキー）を StorageKeys・DEFAULT_SETTINGS から除去する。

## 現状と問題
- src/utils/trustDb/trancoChangeDetector.ts:71（クラス全体 271 行）― 本番 import は 0 件（参照は src/utils/trustDb/__tests__/trancoChangeDetector.test.ts のみ）
- src/utils/storage/types.ts:230（TRANCO_NOTIFICATION_SHOWN = 'tranco_notification_shown'、DEFAULT_SETTINGS null 付き）― 読み書きする実装なし
- 実装側は SSOT 外の生リテラル 'tranco_last_notification' を直読み直書き（:73,209-226,231-237）、Date.now() を保存しながら :217 で lastNotification === version と比較する恒偽分岐（デッドロジック）
- テスト: trancoChangeDetector.test.ts:245-295 が生キーを pin（ただし本クラス自体に production caller なし）

## 変更の理由
[可読性/保守性] 本番経路のないクラスが、SSOT と実装の二重管理・恒偽分岐・生キーの監査不可視を生んでいる。削除は本番経路に触れないため挙動不変。将来 Tranco 通知を復活させる場合は接続と同時に SSOT 整合を行う判断を記録する。

## 提案コード（骨子）
- trancoChangeDetector.ts と __tests__/trancoChangeDetector.test.ts を削除
- types.ts:230 の TRANCO_NOTIFICATION_SHOWN と defaults.ts の DEFAULT_SETTINGS 該当行を削除（読み書き実装がないため実効影響なし）

## BDD受け入れシナリオ
Scenario: 削除後も本番経路は不変
  Given 本クラスの本番 import は 0 件
  When クラスとテストを削除する
  Then 本番経路の挙動は変更されず、全テストが通過する

Scenario: 死にキーの除去
  Given StorageKeys から TRANCO_NOTIFICATION_SHOWN が消える
  When 新規インストールで DEFAULT_SETTINGS が書き込まれる
  Then 書き込まれるキー集合から読み書きされないキーが消える（実効値の変化なし）

## 見積もり
1 pt（RICE: 30 = Reach 5 × Impact 3 × Confidence 1.0 ÷ Effort 0.5 人日）

## DoD
- [ ] 削除直前に本番 import 0 件を再確認
- [ ] npm run validate 通過
- [ ] npm run build 通過
