# PBI: queryPlanner ⇄ queryPlan の循環 import 解消

## ステータス: ⬜ 未着手（順位2 / RICE 32.0 / 台帳: 2026-09-15-00-backlog-archloop-0915.md）

## ユーザーストーリー

メンテナとして、クエリ計画層の依存が一方向になっていてほしい。なぜなら循環した seam は方向の読み取りを妨げ、将来のバンドル分割（worker 境界用に plan だけ分離）を不可能にするから。

## 優先度

- 順位: 2 / 全候補数 11
- RICEスコア: 32.0（Reach=4 / Impact=1 / Confidence=80% / Effort=0.1人週）
- 根拠: 関数の移動＋import 付け替えのみで解消でき、费用対効果が高い

## 背景（診断結果）

- 循環: `queryPlanner.ts:22` が `clampLimit, clampOffset` を plan から import、`queryPlan.ts:18` が `planQueryMode` を planner から import
- `queryPlan.ts:315-317` の `clampLimit(query.limit, cap, 100)` は planner の `applyReadPolicy`（queryPlanner.ts:69-74）との**防御的再 clamp**であり、コメント自体がそれを認めている
- 593行の集中自体は正当（FTS/LIKE/plain の文面と束縛順序は一体で変わる — PBI-34 の判断を支持）。削るべきは行数ではなく**循環**

## 実装ガイド

1. **`planQueryMode` と `selectReadCap` を `queryPlan.ts` に移動**（または両者が依存してよい `limits.ts` 側の小 module に）。planner は plan を import するだけの一方向にする
2. **`buildQuerySpec` の再 clamp をブランド型で表現**: 引数を `AlreadyCappedQuery`（branded `StorageQuery`）にし、未 plan のクエリを受け付けない
3. caller 3 backend（OpfsWorkerBackend / IdbVfsBackend / storageFallback）は型のみの変更

## BDD受け入れシナリオ

```gherkin
Scenario: 依存が一方向になる
  Given queryPlanner と queryPlan が存在する
  When  import グラフを検査する
  Then  planner は plan を import し、plan は planner を import しない
```

## 受け入れ基準

- [ ] plan が planner を import していない（grep で確認）
- [ ] `AlreadyCappedQuery` ブランド型により `buildQuerySpec` が正規化済みクエリのみ受け付ける
- [ ] 既存の queryPlan / queryPlanner / backend テスト全件 green

## テスト戦略

- 既存: queryPlan / queryPlanner / real-engine 系テストが回帰網
- 単体: ブランド型による未 plan クエリの拒否（コンパイル時のみでよい）

## 見積もり

0.5日

## Definition of Done

- [ ] 全BDDシナリオが完了している
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（必要なら queryPlan 先頭コメント）
