# PBI 2026-09-12-13 — FallbackStorage.query の alias 再派生を削除（planner 信頼の回復）

- **種別**: 🔧非機能追加（refactor + fix・backend 分岐の実バグ解消を伴う）
- **優先度**: 5 位 / RICE **12.8**（R8 × I2 × C80% / E1.0人日）
- **出典**: round 10 診断 候補 05・サブエージェント探索

## 背景（なぜ）

fallback adapter が `qAny['isStarred'/'since'/'until'/'is_starred']` を手動で再派生する（storageFallback.ts:202-233）が、`normalizeStorageQuery`（queryNormalize.ts:19-46）は `is_starred` 数値 alias を知らない。同じ wire payload が `SQLITE_QUERY` 経由（正規化済み・alias 消失）と legacy `search()` shim 経由（未正規化・alias 有効）で異なるフィルタになる backend 分岐の実バグ。純粋関数は well-tested なのに重複側は untested。

## スコープ

- storageFallback.ts:206-233 の `qAny` alias ブロックを削除し、正規化済み `StorageQuery` を `matchesExtraWhere(q)` で直接消費
- `search()` shim（:181-196）は `normalizeStorageQuery` 経由に。呼び出し元が test のみなら shim 削除
- 残る実 wire shape なら `is_starred` を queryNormalize 側に追加 + seam test
- 振る舞い: 正規化済みパスは不変、shim パスは planner 準拠に統一

## 受け入れ基準（BDD）

### シナリオ 1: planner 出力を verbatim で fallback に食わせて SQL と一致（ハッピーパス）
```gherkin
Given planQuery 済みの StorageQuery
When fallback.query と SQL backend にそのまま渡す
Then 同一の行集合が返る（alias 分岐なし）
```

### シナリオ 2: shim パスも正規化を経由する（境界）
```gherkin
Given legacy search() shim への呼び出し
When 実行する
Then normalizeStorageQuery を経由した結果と一致する
```

## DoD

- [x] alias ブロック削除・shim 経路修正・seam test 新設
- [x] offscreen fallback/queryNormalize 関連テスト green
- [x] type-check / lint green

## 実装メモ（2026-09-12）

- `is_starred` 数値 alias を queryNormalize 側に吸収（starred > isStarred > is_starred の優先順位）。`is_starred` を送る sender は存在しないことを grep で確認（row field としての使用のみ）
- fallback.query の qAny ブロック（:206-233）を削除し `matchesExtraWhere(r, q)` を直接消費。excludeDeleted の既定（!== false で削除済み除外）は維持
- `search()` shim を削除（呼び出し元は test 3 ファイルのみ）。test 10 箇所を `query({text, limit, offset, orderBy, orderDir})` に移行
- 旧 back-compat 契約を pin していた test 4 件（starred/time-range/is_starred×2）を normalize 経由に更新 — 製品パス準拠
- 検証: seam test 4 件新設・offscreen 全 73 ファイル 1031 tests green・type-check green・lint 0 errors

## 見積もり

🟡中（2pt目安） / 副作用: 🟡軽微（shim パスのフィルタが planner 準拠に変わる = 意図した統一）
