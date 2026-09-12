# PBI 2026-09-12-16 — Read-limit 政策の単一 owner（planner が fts/plain cap を所有）

- **種別**: 🔧非機能追加（refactor）
- **優先度**: 8 位 / RICE **6.4**（R12 × I1 × C80% / E1.5人日）
- **出典**: round 10 診断 候補 08・サブエージェント探索

## 背景（なぜ）

read 政策 seam が 2 module に分裂: planner が MAX_QUERY_LIMIT(100k) で clamp した後 `buildQuerySpec`（queryPlan.ts:188-190）が caps.fts/plain(100k/10k) で再 clamp。OPFS SEARCH（searchHandlers.ts:35-36）は QuerySpec を組まず fts/plain 選択を inline 手組み。3 call site・2 cap 語彙・未文書の順序依存。queryPlan.ts:7 のコメントは `plain:1000` のまま drift 済み（実コードは 10000）。

## スコープ

- `queryPlanner` を limit 政策の単一 owner に: `applyReadPolicy`（または新 `applySearchPolicy(bare, fts5Available)`）が fts/plain cap を選択
- `buildQuerySpec` / `handleSearch` は clamp 済み limit の受領に縮約（再 clamp ではなく assert）
- `QUERY_CAPS.plain` は `limits.ts` の MAX_QUERY_LIMIT の隣へ移動し queryPlan は再 export（対の drift 不能化）
- コメント drift（plain:1000 表記）も修正
- 振る舞い不変（実効 cap は現行どおり）

## 受け入れ基準（BDD）

### シナリオ 1: cap 選択が planner 1 箇所で決まる（ハッピーパス）
```gherkin
Given fts/plain の両クエリ
When applyReadPolicy/applySearchPolicy を通す
Then 正しい cap が選択され、buildQuerySpec/handleSearch は再 clamp しない
```

### シナリオ 2: 対の cap が drift 不能（境界）
```gherkin
Given limits.ts の片方の cap を変更
When 型/テストで対の存在が要求される
Then もう片方の更新漏れが検出される
```

## DoD

- [x] planner に cap 選択を集約・受領側を縮約・limits.ts へ移動・コメント修正
- [x] cap 選択の純粋 table test 新設（3 backend 起動を要しない）
- [x] offscreen query/limits 関連テスト green
- [x] type-check / lint green

## 実装メモ（2026-09-12）

- `QUERY_CAPS` 定義を `messaging/limits.ts`（MAX_QUERY_LIMIT の隣）に移動。`queryPlan.ts` は worker 境界用に再 export（既存 import は不変）
- `selectReadCap(useFts)` + `applySearchPolicy(q, fts5Available)` を planner に新設。searchHandlers の inline ternary を置換
- `buildQuerySpec` の clamp は worker 境界の防御的再適用として文書化し維持（生 payload が直接来るため削除しない — 削除が怖かった理由を明示）
- `IdbVfsBackend` の orphan `100000` を `QUERY_CAPS.fts` に配線 + stale コメント（old worker cap 言及）を修正
- `queryPlan.ts:7` の `plain:1000` コメント drift を修正
- 検証: cap table test 3 件新設・offscreen 全 73 ファイル 1034 tests green・type-check green・lint 0 errors

## 見積もり

🟡中（2pt目安） / 副作用: 🟢なし（振る舞い不変）
