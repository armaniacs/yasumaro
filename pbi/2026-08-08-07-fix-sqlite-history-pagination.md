# PBI: 履歴パネルのページングが1000件で破綻する問題を修正する

**作成日**: 2026-08-08
**優先度**: 高
**見積もり**: 🟡中（2pt目安）
**副作用**: 🔴あり（履歴取得クエリの変更。表示件数・並び順の回帰リスク）
**種別**: 🔧非機能追加（fix）

---

## 背景

アーキテクチャレビュー（2026-08-08、候補4）で、`sqliteHistoryPanel.ts` の `fetchData` に**実害のある欠陥**が見つかった。

### 問題: サーバ側ページングを使わずクライアント側で slice している

```typescript
// src/dashboard/panels/asyncData/sqliteHistoryPanel.ts:442-449（実測）
result = await queryLogs({
  limit: 1000,      // ← ハードコード
  offset: 0,        // ← ハードコード
  since: options.since,
  until: options.until,
  orderBy: 'created_at',
  orderDir: 'DESC',
});
```

その後クライアント側で切る：

```typescript
// 477行・483行
rows: filteredRows.slice(offset, offset + limit)
rows: result.rows.slice(offset, offset + limit)
```

### 実害

`PAGE_SIZE = 20` なので、**51ページ目以降（1001件目以降）が閲覧不能**。履歴が1000件を超えると古い記録に到達できない。

`state.total` には `result.total`（DB上の全件数）が入るため、**ページネーションUIは1000件超のページを表示するが、開いても空になる**。

### サーバ側は既にページングを実装している

| 機能 | サーバ側実装 |
|---|---|
| `limit` / `offset` | ✅ `recordsRepo.query`（39-46行）→ `backend.query`。SQL の `LIMIT`/`OFFSET` |
| `tagFilter` | ✅ `opfsWorker.ts:284-287`（FTS5 経由） |
| `MAX_QUERY_LIMIT` | 100000（`sqliteEngineContext.ts:98`） |

**つまりクライアント側 slice は不要**。`tagFilter` もサーバ側で処理できるため、1000件フェッチの理由が現状のコードには無い。

### なぜ気づかれなかったか（なぜなぜ分析）

1. **なぜ1000件超で壊れるのか** → クライアント側で slice しているため、DBから取得した1000件しか対象にならない
2. **なぜクライアント側で slice したのか** → `tagFilter` をクライアント側の `filterRowsByTag` で適用しているため、フィルタ後の件数でページングする必要があった
3. **なぜ `tagFilter` をクライアント側で適用したのか** → サーバ側 `tagFilter` の存在を知らずに実装された可能性が高い（`recordsRepo.query` は `tagFilter` を受け取り `backend.query` へ渡している）
4. **なぜテストで検出されなかったのか** → `sqliteHistoryPanel` のテストは2ファイル250行で、XSS エスケープとタグフォールバックのみ。**ページング境界のテストが存在しない**
5. **なぜページングのテストが無いのか** → 931行のクロージャ内にあり、`state` と DOM に密結合していて単体テストが困難（候補4の指摘そのもの）

**根本原因**: ページング境界にテストが無く、サーバ側の能力が把握されていなかった。

### 削除テスト

クライアント側 slice を削除すると、ページング責務がサーバ側に集約される → **複雑度が集中する**。

---

## 実装者向け注記: 現状の確認

```bash
# fetchData の全体
sed -n '417,511p' src/dashboard/panels/asyncData/sqliteHistoryPanel.ts

# サーバ側の tagFilter 実装
grep -n "tagFilter" src/offscreen/opfsWorker.ts src/offscreen/recordsRepo.ts

# 既存のページング関連テスト（存在しないことの確認）
grep -rn "currentPage\|PAGE_SIZE\|offset" src/dashboard/panels/asyncData/__tests__/
```

---

## 設計

### 方針: テストを先に書く（TDD）

**この修正は必ずテストを先に書く**。理由：
- 931行のクロージャに手を入れるため、回帰の検出手段が先に必要
- 現状の挙動（1000件超で空になる）をテストで固定してから直すことで、修正が効いたことを証明できる

### 修正内容

```
Before                                  After
────────────────────────────────        ────────────────────────────────
queryLogs({ limit: 1000, offset: 0 })   queryLogs({ limit: PAGE_SIZE,
  ↓                                                  offset: page * PAGE_SIZE,
filterRowsByTag（クライアント側）                      tagFilter })
  ↓                                       ↓
rows.slice(offset, offset + limit)      そのまま表示（slice 不要）

51ページ目以降が空                        全ページ閲覧可能
```

### 注意: タグフォールバック機能との相互作用

`shouldFallbackToTextSearch`（457行）は「タグで絞った結果が0件なら全文検索に切り替える」機能（PBI `2026-08-06-01` で実装）。

サーバ側 `tagFilter` に移すと、**フォールバック判定に必要な「タグでの絞り込み結果が0件」という情報の取得方法が変わる**。サーバ側 `tagFilter` の結果が0件であることで判定できるはずだが、実装時に既存テスト（`sqliteHistoryPanel-tagFallback.test.ts` 170行）を壊さないよう注意。

**判断が必要な点**: サーバ側 `tagFilter` の絞り込み条件がクライアント側 `filterRowsByTag` と同一か。異なる場合（例: 部分一致 vs 完全一致）、移行すると表示結果が変わる。実装時に両者のロジックを比較し、差異があれば**クライアント側フィルタを維持しつつページングのみサーバ側に寄せる**折衷案を採る。

---

## 受け入れ基準（BDD）

```gherkin
Scenario: 1000件を超える履歴の51ページ目以降が閲覧できる
  Given DB に 1500 件の履歴が存在する
  When 履歴パネルで 60 ページ目（offset 1200）を開く
  Then その範囲のレコードが表示される（空にならない）

Scenario: サーバ側ページングが使われる
  Given 履歴パネルで 3 ページ目を開く
  When queryLogs が呼ばれる
  Then limit: 20, offset: 40 が渡される（limit: 1000, offset: 0 ではない）

Scenario: タグフォールバックが従来通り動作する
  Given タグで絞った結果が0件になるタグを指定する
  When 履歴パネルを開く
  Then 全文検索へのフォールバックが発生する

Scenario: 既存テストが全てパスする
  When 修正を完了する
  Then npm run validate が成功する
```

## 受け入れ基準

- [ ] **先に**ページング境界のテストを追加し、現状の欠陥を再現（1000件超で空になることを確認）
- [ ] サーバ側 `tagFilter` とクライアント側 `filterRowsByTag` のロジック差異を比較・記録
- [ ] `queryLogs` に `limit: PAGE_SIZE` / `offset: page * PAGE_SIZE` を渡す
- [ ] クライアント側の `slice` を削除（またはサーバ側ページングと整合させる）
- [ ] タグフォールバック機能の既存テストがパスする
- [ ] 追加したページング境界テストがパスする
- [ ] `npm run validate` が成功する

## テスト戦略

### 単体テスト（新規・最優先）
- 3ページ目を開いたとき `queryLogs` に `offset: 40` が渡ること
- 1000件超の offset でもレコードが返ること
- `state.total` とページネーション表示の整合性

### 回帰テスト
- `sqliteHistoryPanel-tagFallback.test.ts`（170行）— タグフォールバック
- `sqliteHistoryPanel-formatDiagnosticMetadata.test.ts`（80行）— XSS エスケープ
- `sqliteHistoryQuery.test.ts`（149行）— 抽出済み純関数

## 実装アプローチ

1. ページング境界のテストを書き、**落ちることを確認**（欠陥の再現）
2. サーバ側 `tagFilter` の挙動を確認（クライアント側と同一か）
3. `queryLogs` の呼び出しを修正
4. クライアント側 `slice` を削除
5. タグフォールバックのテストがパスすることを確認
6. `npm run validate`

## 見積もり
2pt（テスト先行 + tagFilter の挙動比較 + 931行クロージャへの変更）

## 技術的考慮事項

- **副作用🔴あり**: 履歴取得クエリの変更は表示内容に直結する。件数・並び順・タグ絞り込みの回帰に注意
- `searchLogs` 経路（439-440行）は既に `limit, offset` を正しく渡している。修正対象は `queryLogs` 経路のみ
- `MAX_QUERY_LIMIT = 100000` のため、サーバ側は大きな offset を扱える
- 本PBIはページングの**修正**に絞る。931行クロージャの分割（描画の純関数化・state の reducer 化）は別PBI（`2026-08-08-09`）とする
- `PAGE_SIZE = 20` はモジュール定数。ハードコードを避ける方針に沿って定数のまま利用する

## 関連

- アーキテクチャレビュー（2026-08-08）候補4（実害の指摘）
- 関連PBI: `2026-08-06-01-feat-tag-cluster-fallback-to-text-search.md`（タグフォールバック。相互作用に注意）
- 対象: `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts`（417-511行 `fetchData`）
- サーバ側: `src/offscreen/recordsRepo.ts`, `src/offscreen/opfsWorker.ts`
