# PBI 2026-09-12-06 — OPFS read path hardening（offset 正規化 + worker 既定値の死除去）

- **種別**: 🔧非機能追加（refactor・防御層 + backend 差異封じ）
- **優先度**: 6 位 / RICE **8.5**（R8 × I1 × C80% / E0.75人日）
- **出典**: round 9 診断 候補 06・直接検証で「現在の wire 経路は planQuery が limit clamp 済み」と降格確認

## 背景（なぜ）

- `opfsWorker/crudHandlers.ts:38` が `buildPlainListStatements({ ...spec, limit, offset })` で spec を上書きする。planQuery が上游で clamp するため現在は到達不能だが、spread は「worker が wire 値を再適用できる」という誤った誘惑を残す（IDB backend は spec 素通しで非対称）
- `offset` はどこでも無検証（`queryPlan.ts:175` `offset = query.offset ?? 0`）。SQL backend は `OFFSET -5` を SQLite に渡し、`storageFallback.ts:290-292` は `slice(-5,…)` で末尾から数える — backend 間で行が発散するクラス
- 既定値 3 流儀（worker plain 20 / worker search 50 / planner 100）が死コード化

## スコープ

- `queryPlan.ts` に `clampOffset`（非整数/負 → 0）を追加し `buildQuerySpec` で適用
- worker `handleQuery` を spec 素通しに変更（spread 削除・`limit = 20` 既定値削除）
- `searchHandlers` の `limit = 50` 既定値も削除し planner 既定に統一
- parametric テスト: 巨大 limit → 両 backend で cap / 負・小数 offset → 0

## 受け入れ基準（BDD）

### シナリオ 1: 負 offset は両 backend で 0 扱い（ハッピーパス）
```gherkin
Given StorageQuery の offset が -5
When buildQuerySpec を通して IDB / OPFS / fallback で読む
Then いずれも offset 0 として同一の先頭行が返る
```

### シナリオ 2: 巨大 limit は cap される（境界）
```gherkin
Given StorageQuery の limit が 10^9
When 両 backend で読む
Then QUERY_CAPS.plain で cap された行数が返る
```

## DoD

- [x] clampOffset + spec 素通し + 既定値統一
- [x] parametric テスト 2 本
- [x] offscreen 関連テスト green
- [x] type-check / lint green

## 見積もり

🟢低（1pt目安） / 副作用: 🟢なし

## 実装メモ（2026-09-12）

- `clampOffset`（非整数/負/NaN → 0）を queryPlan.ts に追加し `buildQuerySpec` で適用（clampLimit の隣に配置・read policy が paging 値を両方所有）
- worker `handleQuery` を spec 素通しに変更（`{...spec, limit, offset}` spread 削除・`limit = 20` 既定値削除）。旧 spread は「plain cap を回避する」意図のコメント付きだったが、実際には IDB / fallback がどちらも spec の cap（1000）に従っており、**OPFS だけが planner limit（最大 100k）を通す唯一の backend という逆方向の発散**だった。spec 素通しで 3 backend が同一 policy に統一（MAX_QUERY_LIMIT は planner が引き続き担保）
- worker `handleSearch` の `limit = 50` 既定値を削除し clampLimit/clampOffset 経由に（FTS は QUERY_CAPS.fts・LIKE は plain cap）
- 旧既定値 20/50 に依存するテスト pin 4 件を planner 既定 100 に更新（死んだ第 3 既定値の除去）
- parametric テスト新設: 負/小数/NaN offset → idb + opfs で 0（旧 fallback は `slice(-5,…)` で末尾から数える backend 発散）・巨大 limit → 3 backend とも QUERY_CAPS.plain に cap
- 検証: offscreen 全 72 ファイル 1020 tests green・type-check / lint 0 errors green
