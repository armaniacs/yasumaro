# PBI 2026-09-12-38 — IDB LIKE path の qualified SQL 実行回帰修正（1-2 文字検索が必ず throw）

- **種別**: 🔧非功能追加（fix・SQL 実行回帰修正 + テストギャップ解消）
- **優先度**: 1 位 / RICE **32.0**（R15 × I2 × C80% / E0.75人日）
- **出典**: round 14 診断 候補 38・サブエージェント探索 + 直接検証

## 背景（なぜ）

round 12 PBI 27 の filter SSOT 統合で、`IdbVfsBackend.query` が branch 前に 1 個の `extra = buildExtraWhereSql(q, { qualified: true })` を構築し FTS/LIKE 両方に渡すようにした（IdbVfsBackend.ts:76-81）。LIKE path の SQL は `FROM browsing_logs`（別名なし・queryPlan.ts:404-407）に対し `extraWhereSql` は `AND b.is_deleted = 0` 等の `b.` 限定付き条件 → **1-2 文字の text 検索（useFts=false）が毎回 `no such column: b.is_deleted` で throw**。domain/dateFrom/ids フィルタ付き検索も同様に失敗する。params は位置同一のため正しいが、SQL text は path 毎に異なる。

テストギャップ: parametric suite は stub `execWithCache` に対する `toContain`/params の string assert で SQL を実行しないため本バグは素通りした。

## スコープ

- `IdbVfsBackend.query` で branch 毎に射影: FTS は `{qualified: true}`、LIKE は `{qualified: false}`
- `ExtraWhere` から vestigial `extraWhereSqlFts` フィールドを削除（round 13 以降常に extraWhereSql と同一・「1 個で両方」の誤解を生んだ原因）
- **real-engine LIKE regression test** 新設: 短文検索（`{text:'ru'}`）、`{text:'ru', domain}`、`{text:'ru', ids}` を wa-sqlite（または better-sqlite3 harness）で実行し rows/total を assert — stub-blindness hole を恒久閉鎖

## 受け入れ基準（BDD）

### シナリオ 1: 1-2 文字検索が行を返す（ハッピーパス）
```gherkin
Given IDB backend に 'rune stone' を含む行がある
When query({ text: 'ru' }) を実行する
then no such column エラーではなく該当行が返る
```

### シナリオ 2: フィルタ付き短文検索も実行できる（境界）
```gherkin
Given query({ text: 'ru', domain: 'a.com' }) と query({ text: 'ru', ids: [1] })
When 実行する
then SQL エラーではなく正常応答が返る
```

## DoD

- [x] branch 毎射影・ExtraWhere 1 フィールド化
- [x] real-engine LIKE regression test 新設
- [x] offscreen query 関連テスト green
- [x] type-check / lint green

## 見積もり

🟢低（1pt目安） / 副作用: 🟢なし（FTS path は qualified のまま不変）

## 実装メモ（2026-09-12）

- `IdbVfsBackend.query` を FTS=`{qualified: true}` / LIKE=`{qualified: false}` の branch 毎射影に修正（round 12 PBI 27 の 1 投影共用を解消）
- `ExtraWhere` から vestigial `extraWhereSqlFts` を削除（round 13 語彙統合以降常に extraWhereSql と同一）— 関連参照を queryPlan/テストで更新
- real-engine regression test 新設（better-sqlite3 in-memory、archiveDbReader と同一技術）: 短文検索・domain フィルタ付き・ids フィルタ付きの 3 実行 + 「qualified 射影を LIKE SQL に流すと throw する」mutation proof
- 検証: realEngineLikeSearch 6 tests 新設・offscreen 全 78 ファイル 1074 tests green・type-check green・lint 0 errors
