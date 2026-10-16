# PBI: defense-in-depth 項目1の発火対応（ssrfGuard 正規化ギャップ）

`pbi/2026-09-22-11-backlog-defense-in-depth-hardening.md` 項目1の分割 PBI（発火日 2026-10-12 に実装済みの事後記録）。

## ユーザーストーリー
防御監視の担当者として、発火した項目は個別 PBI に分割して追跡したい。なぜなら束ね PBI は索引であり、実装の DoD は分割先で閉じる約束だから。

## 優先度
- 順位: 分割 01 / 01
- RICEスコア: 対象外（発火対応の事後記録）
- 根拠: `c66a2cce` で実装・検証済み

## 背景
発火条件「allowedUrls 層なしで ssrfGuard を通る呼び出し元」は既に成立していた。`new URL()` が `http://localhost./` の hostname を `localhost.` のまま返すため既存判定をすり抜け、`validateUrlForAIRequests` ではポート許可リストを迂回していた。

## BDD受け入れシナリオ
Scenario: 正規化後の hostname で判定される
  Given 末尾ドット付き localhost
  When validate 系で検証する
  Then 正規化後の判定でブロックまたは許可リスト適用される

Scenario: 数値 IP 形は回帰テストで固定される
  Given 2130706433 / 0x7f000001 形
  When 検証する
  Then URL パーサ正規化により 127.0.0.1 として検出される

## 受け入れ基準
- [x] `normalizeHostname` を追加し 4 検証入口を統一（`c66a2cce`）
- [x] ssrfGuard 33 件・AI・fetch・recording 系 503 件が緑（当時記録）
- [x] `npm run validate` exit 0（当時記録）

## テスト戦略
- 単体: ssrfGuard 回帰テスト（実装コミットに同梱）
- 既存: AI・fetch・recording 系で回帰確認済み

## 見積もり
事後記録のため 0 SP（実装は `c66a2cce` に計上済み）

## Definition of Done
- [x] 本 PBI の受入・テストが実装コミットで満たされている
- [x] コードレビュー完了（当時実施）
- [x] 束ね PBI からリンクされる
