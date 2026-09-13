# PBI 06: sqliteHistoryPanel pending region の構造摩擦を解消（round 5 の残半分）

## ユーザーストーリー

履歴パネルを保守する開発者として、pending region の描画契約が「ordering の偶然」でなく構造で保証され、同一 interface の重複定義が無い状態を望む。なぜなら round 5 の PBI-P が機能としては完成したが、3 つの摩擦を残したから。

## 優先度

- 順位: 06 / 9
- RICE スコア: 6.7（Reach=2 / Impact=0.5 / Confidence=100% / Effort=0.15 人週）
- 根拠（round 6 診断）: `sqliteHistoryPanelView.ts:403-407` と `:442-446` に**同一 `PendingRegionActions` が 2 回定義**（TS 暗黙 merge — drift 誘発）。`sqliteHistoryPanel.ts:212` の `model.subscribe` が生成時実行（load 前の panel が購読保持）。`renderFull` が `#sqlite-pending-region` を空で再作成するが `refresh()` は再充填しない（mount 順の偶然で動作）。

## BDD 受け入れシナリオ

```gherkin
Scenario: renderFull 再構築後も pending region が復元される
  Given pending を表示中のパネルで refresh() が renderFull path を通る
  Then pending region は再描画される（空にならない）

Scenario: interface は 1 箇所のみ
  Given PendingRegionActions 定義
  When ファイル内を grep する
  Then 1 箇所のみである
```

## 受け入れ基準

- [x] `PendingRegionActions` の重複定義を 1 箇所に
- [x] `model.subscribe` を load() 内へ移動（subscribePendingStorage と対称）
- [x] `renderFull` が pending region を再構築した場合の再描画契約を refresh() に集約（loadPending 再呼び出し or renderFull に region 復元を含める）
- [x] テスト green

## テスト戦略

pending テストに renderFull 復元ケース追加。

## 見積もり

XS-S（0.15 人週）。種別: refactor。

## 実装メモ（2026-09-11 round 6）

- `PendingRegionActions` の 2 重定義を 1 箇所に統合。
- `model.subscribe` を生成時から load() 内へ移動（作成のみの panel が購読を保持しない）— destroy は modelUnsubscribe を解放。
- renderFull 後の pending region 復元は PBI 03 の idempotent 再配線パターンと合わせて refresh 契約で担保（テスト green 維持）。
