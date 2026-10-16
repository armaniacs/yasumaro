# PBI: 検索 SQL の `is_deleted = 0` 二重付与を単一化

## ユーザーストーリー
履歴検索の利用者として、削除済み除外フィルタが単一・明確な条件で適用されてほしい。なぜなら二重付与は恒真で無害に見えても、将来の条件変更時に片方だけ変わる乖離リスクと、可読性・クエリプランへの不要な負荷を生むから。

## 優先度
- 順位: 04 / 11
- RICEスコア: 4.5（Reach=9 / Impact=0.5 / Confidence=1.0 / Effort=1.0）
- 根拠: 全検索に波及するが意味論は不変。等価性テストの期待更新を伴うため SP 1.0。

## 背景
`deletedCond`（FTS: `b.is_deleted = 0`）と共有条件セット由来の `extra` が両方 `is_deleted = 0` を含み、出力が `... AND b.is_deleted = 0 AND b.is_deleted = 0 AND ...` になる。等価性テスト（`search-statement-twins-equivalence.test.ts:46,51,70-76`）がこの二重出力を期待値として pin している。レビュー指摘 Low #7（Tuning）。

## BDD受け入れシナリオ
Scenario: FTS 検索の削除除外は1回だけ付与される
  Given `includeDeletedFilter` 有効の FTS 検索条件
  When `buildFtsSearchStatements` で文を組み立てる
  Then `b.is_deleted = 0` が1回だけ含まれる

Scenario: LIKE 検索・カウント系も同様に単一化される
  Given 同条件の LIKE / COUNT 文
  When 組み立てる
  Then `is_deleted = 0` が1回だけ含まれる

Scenario: `excludeDeleted: false` の経路はフィルタなしのまま
  Given `includeDeletedFilter` 無効
  When 組み立てる
  Then `is_deleted` 条件が含まれない（既存テスト緑）

## 受け入れ基準
- [x] `deletedCond` / `baseConds` と共有条件セットのどちらか一方に集約され、二重付与が消える
- [x] 等価性テストの期待値が単一化後の出力に更新され全緑
- [x] `npx vitest run src/offscreen/` 全緑

## テスト戦略
- 単体: 等価性テストの期待更新（Red: 旧期待で失敗確認 → Green）
- 既存: offscreen 全体テストで回帰確認

## 見積もり
1.0 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了（差分点検済み：所有権一本化、意味論不変・bind順序不変）
- [x] ドキュメント更新済み（不要ならその旨を記録）※コード内コメント更新のみ。外部ドキュメントの変更は不要と判断

## 実装メモ（2026-10-16）
- 解：所有権をビルダー側（`deletedCond`/`baseConds`）に一本化。`buildExtraWhereSql` が共有
  `is_deleted = 0` を検索 fragment から除外（`DELETED_CONDITION_SQL` で単一スペル管理）。
  `buildFilterConditions` 自体と plain listing（`buildWhereClause`）は不変。
- 旧期待で Red 確認済（FTS/LIKE の全文一致2件が単一化後出力で失敗）→ 新期待で Green。
- `npx vitest run src/offscreen/`：98ファイル・1255テスト全緑（実時間待ちなし）。
- 注意：二重出力を pin していた `filterConditionSsot.test.ts:56`、
  `realEngineLikeSearch.test.ts` の mutation-proof fixture、
  `opfs-search-skeleton-pin.test.ts.snap` 8件も最小更新（.snap diff は重複除去のみ）。
  詳細は `/tmp/whywhy-nn04.md`。
