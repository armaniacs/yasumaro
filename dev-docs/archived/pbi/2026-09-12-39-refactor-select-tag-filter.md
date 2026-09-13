# PBI 2026-09-12-39 — selectTagFilter: tag filter 導出 5 箇所を path-aware seam に

- **種別**: 🔧非功能追加（refactor + hardening）
- **優先度**: 2 位 / RICE **8.5**（R8 × I1 × C80% / E0.75人日）
- **出典**: round 14 診断 候補 39・サブエージェント探索 + 直接検証

## 背景（なぜ）

tag filter が検索毎に最大 3 回導出され、5 箇所が (fts5Available, idColumn) の組を手選択している: `queryPlan.ts:246-248`（spec・plain）、`IdbVfsBackend.ts:90-92`（FTS・b.id）、`IdbVfsBackend.ts:120-122`（LIKE・false）、`opfsWorker/searchHandlers.ts:57-59`（FTS・true hardcode）、`:84-86`（LIKE・false）。cross case は rebuild が load-bearing: (i) FTS path の long tag は `b.id` 限定が必要、(ii) FTS-capable engine + LIKE path の long tag は `tags LIKE ?` が必要。しかし `searchHandlers.ts:58` の hardcode true は export された `handleSearchFts` を非 FTS engine で直接呼ぶと破綻し、`crudHandlers.ts:34` も同様に OPFS 常時 FTS 仮定。

## スコープ

- `selectTagFilter(tag, path: 'plain'|'fts'|'like', fts5Available)` を queryPlan に新設（3 組の (fts5Available, idColumn) mapping）
- `buildQuerySpec` は plain、4 search call site は fts/like を使用
- 3×2 table test + `handleSearchFts` 直接呼び出し（fts5Available=false engine）の direct-call テスト新設

## 受け入れ基準（BDD）

### シナリオ 1: path 毎の組が 1 箇所で決まる（ハッピーパス）
```gherkin
Given path='fts' / 'like' / 'plain' と fts5Available の組合せ
When selectTagFilter を呼ぶ
then mapping テーブルどおりの (fts5Available, idColumn) で条件が構築される
```

### シナリオ 2: 非 FTS engine で handleSearchFts を直接呼んでも MATCH が出ない（境界）
```gherkin
Given fts5Available=false の engine
When handleSearchFts を直接呼ぶ
then tags LIKE ? 条件になる（hardcode true による MATCH が発生しない）
```

## DoD

- [x] selectTagFilter 新設・5 call site 委譲
- [x] 3×2 table test + direct-call テスト新設
- [x] offscreen search 関連テスト green
- [x] type-check / lint green

## 見積もり

🟢低（1pt目安） / 副作用: 🟢なし（現行の正しいパスは不変）

## 実装メモ（2026-09-12）

- `selectTagFilter(tag, path, engineFts5Available)` を queryPlan.ts に新設。mapping: plain=(engine, 'id')・fts=(engine, 'b.id')・like=(false, —)
- 5 call site を委譲: queryPlan buildQuerySpec（plain）・IdbVfsBackend FTS/LIKE・opfsWorker searchHandlers FTS/LIKE
- opfsWorker.ts から handleSearchFts/handleSearchLike へ fts5Available を threading（新 optional param・デフォルトは旧 hardcode 値）— 非 FTS engine で handleSearchFts を直接呼んでも tags LIKE ? になる
- 検証: selectTagFilter 7 tests 新設（path×engine matrix + direct-call 保護 + undefined tag）・offscreen 全 78 ファイル 1074 tests green・type-check green・lint 0 errors
