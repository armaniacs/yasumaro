# PBI 11: sqliteHistoryModel の LRU キャッシュを深い QueryCache モジュールへ抽出

優先度: 1 位 / RICE 53 = (16 × 1 × 100%) / 0.3w / Strength: Strong
backlog: [2026-09-04-00-backlog-arch2.md](2026-09-04-00-backlog-arch2.md)

## ユーザーストーリー
ダッシュボード履歴を操作する開発者として、クエリキャッシュの eviction・キー正規化・無効化が 1 つの深いモジュールにまとまってほしい。なぜなら state 機械（fetchData 67 行）からキャッシュポリシーを読み解くのが難しく、eviction 変更のたびに状態機械を触るリスクがあるから。

## BDD受け入れシナリオ

```gherkin
Scenario: LRU キャッシュが cap を超えたら最古を追い出す
  Given QueryCache に cap=20 件のエントリがある
  When  21 件目を set する
  Then  最古のエントリが削除され、21 件目が取得できる
  And   get したエントリは LRU 順が更新される

Scenario: get は rows の防御コピーを返す
  Given キャッシュに rows=[a,b] のエントリがある
  When  get(key) の戻り値の rows に要素を追加する
  Then  キャッシュ内の rows は変化していない
```

## 受け入れ基準
- [x] `historyQueryCache.ts` に QueryCache クラス（cap/buildKey/get/set/clear）が抽出される
- [x] sqliteHistoryModel は get/set/clear のみ呼び、キャッシュポリシーを保持しない
- [x] rows の防御コピーが get 内に移動する
- [x] 既存の asyncData suite が全绿
- [x] tagInitiated を含むキー契約が維持される

## テスト戦略（t_wadaスタイル）
### 単体テスト
- QueryCache: cap eviction / LRU 更新 / 防御コピー / buildKey 正規化（'' と undefined 同一化、tagInitiated 区別）
### 統合テスト
- 既存 sqliteHistoryModel.cache.test.ts / sort-persistence.test.ts が無修正で green

## 実装アプローチ
- **Outside-In**: 既存 cache テストが QueryCache 抽出後も green であることを統合で確認 → QueryCache 単体テスト → 実装

## 見積もり
0.3w

## 技術的考慮事項
- 依存関係: なし（PBI 17 は本 PBI 後に同ファイルへ着手）
- テスタビリティ: QueryCache は純粋な Map ラッパ（I/O なし）
- 非機能要件: 挙動変更なし（性能層の抽出のみ）

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "queryCache|buildCacheKey|setCacheEntry|clearCache" src/dashboard/panels/asyncData/sqliteHistoryModel.ts
```
2026-09-04 時点で :338-373（キャッシュ本体）、:461-527（fetchData 67 行）、:601-647（無効化 3 箇所）、:595-599（unmount clear）に存在。

### 実装手順
1. `historyQueryCache.ts` を新設: `class QueryCache`（constructor(cap=20)、`static buildKey(params)`、`get`（LRU 更新 + `{...cached, rows: [...cached.rows]}`）、`set`、`clear`、`get size`）
2. `__tests__/historyQueryCache.test.ts` を先に書いて赤
3. sqliteHistoryModel.ts から queryCache/buildCacheKey/setCacheEntry を削除し `new QueryCache(20)` に置換
4. 既存 cache テストが無修正で green なことを確認

### 落とし穴
- buildKey は `''` と `undefined` を同一化し、`tagInitiated` は区別する（PBI 07 レビュー指摘）。この契約を buildKey 単体テストで固定
- fetchData 内の `generation` ガードはキャッシュと無関係（残す）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存 asyncData suite 全绿
- [x] コードレビュー完了
- [x] ドキュメント更新（不要: 内部リファクタリング）
