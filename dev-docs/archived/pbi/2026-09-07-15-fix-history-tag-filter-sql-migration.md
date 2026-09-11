# PBI 15: history-panel の tag-filter を SQL 移行し 5000 件 over-fetch cap を撤去

> **実装完了（2026-09-11、arch-delivery-loop round 4）**。保留解除の 3 つの未解決事項を
> 自律決定して実装した。決定と実測は下記「実装メモ（2026-09-11）」参照。

## ユーザーストーリー

履歴パネルでタグ絞り込みを使う利用者として、5000 件を超える履歴があっても「古い順」ソート
＋タグ絞り込みで新しいタグ付きエントリが表示されてほしい。なぜなら現状は「最も古い 5000 件」に
cap され、それより新しいタグ付きエントリがサイレントに除外されるから
（`sqliteHistoryQuery.ts:288-296` に "known limitation" と明記）。あわせて短いタグ
（例 "AI"）でも正しくヒットしてほしい。

## 優先度

- 順位: 03 / 7
- RICE スコア: 6.0（Reach=3 / Impact=2 / Confidence=50% / Effort=0.5 人週）
- 根拠: `sqliteHistoryQuery.ts:288-296` で「known limitation」と明記された、ユーザーに見える
  データ欠落（古い順ソート + タグ絞り込みで新しいエントリがサイレント除外）の解消。
  PBI 2026-09-05-14（interface 狭窄）が見送り境界で「tag-filter の SQL 移行（5000 over-fetch
  cap）は次ラウンドの再評価対象」として明示的に繰り越した残債。tag セマンティクス変更リスクで
  Confidence 中。
- backlog: [2026-09-05-00-backlog-future.md](2026-09-05-00-backlog-future.md)
- 依存: なし。ただし tag マッチセマンティクスの製品判断（未解決事項 1）が着手の前提。

## BDD 受け入れシナリオ

```gherkin
Scenario: 5000 件超の履歴で古い順 + タグ絞り込みしても新しいエントリが表示される
  Given browsing_logs にタグ "work" を持つエントリが 6000 件あり、うち最新の 100 件が
        「最も古い 5000 件」の外にある
  And   履歴パネルのソート方向が「古い順」（ASC）
  When  タグ "work" で絞り込み、最終ページ（最も新しい側）を開く
  Then  最も古い 5000 件の外にあるタグ付きエントリも結果に含まれる
  And   total 件数が 6000 として表示される（5000 で頭打ちにならない）

Scenario: 短いタグ（AI 等）でも正しくヒットする
  Given browsing_logs にタグ "AI"（2 文字）を持つエントリが複数ある
  When  タグ "AI" で絞り込む
  Then  FTS5 trigram MATCH が 3 文字未満で何も返さない代わりに
        tags LIKE フォールバックで該当エントリが返る
  And   Tag Cluster 由来（tagInitiated）でなくても 0 件フォールバックに落ちない

Scenario: タグ絞り込みのページングが SQL 側で完結する
  Given タグ絞り込みが有効
  When  2 ページ目（offset=50, limit=50）を要求する
  Then  SQL クエリに limit=50, offset=50 が直接渡り、クライアント側の
        over-fetch（TAG_FILTER_FETCH_LIMIT=5000）と slice が行われない

Scenario: バックエンドが tag フィルタを honor しない場合の挙動が定義済み
  Given SQLite バックエンドが IdbVfs / fallback / in-memory のいずれか
        （PBI-34 で tag フィルタを意図的に無視する分岐）
  When  タグ絞り込みクエリを発行する
  Then  合意した方針どおりに振る舞う（統合 or call site 明示フォールバック）
  And   サイレントに全件返す挙動は残らない
```

## 受け入れ基準

- [ ] タグ絞り込みが SQL クエリに移る。3 文字以上は既存 FTS5 `MATCH` パス、3 文字未満は
      `tags LIKE '%<tag>%'`（または合意したパターン）フォールバック
- [ ] `limit` / `offset` が SQL に直接渡り、`TAG_FILTER_FETCH_LIMIT = 5000` 定数と
      `filterRowsByTag` によるクライアント側スライスが撤去される
- [ ] `queryHistory()` の非検索パスから `useServerPaging = !options.tagFilter` 分岐が消え、
      tag 有無にかかわらず SQL ページングになる
- [ ] tag 一致セマンティクスが 1 箇所で定義され、ドキュメント化される
      （未解決事項 1 の決定を反映）
- [ ] `sqliteHistoryQuery.ts:250-258` / `:288-296` の "known limitation" コメントが
      解消済みとして書き換わる
- [ ] `shouldFallbackToTextSearch`（Tag Cluster 由来 0 件フォールバック）の挙動は維持され、
      `historyFilters` ファイルは削除しない
- [ ] IdbVfs / fallback / in-memory の tag 無視分岐の扱いが決定・実装される（未解決事項 3）
- [ ] 振る舞い変更（セマンティクス変更・cap 撤去）を CHANGELOG と
      DESIGN_SPECIFICATIONS.md の history panel 節に記録

## テスト戦略（t_wada スタイル）

### 単体テスト
- `queryHistory()` の tag 分岐: 3 文字以上（MATCH パス）・3 文字未満（LIKE パス）・
  ページング（limit/offset が SQL に届くこと）を fake の `queryLogs` / `searchLogs` で検証
- tag セマンティクス関数の単体テスト: `#AI` が `#AImaster` にマッチするか等、
  決定したルールの真理値表
- 5000 cap 撤去の回帰テスト: 5000 件超のモックで「最も古い 5000 件の外」のエントリが
  返ることをアサート

### 統合テスト
- 実 SQLite エンジンで tags カラムに対する MATCH / LIKE の両パスが期待どおり行を返すこと
  （既存の SQLite 統合テスト基盤を利用）
- LIKE フォールバック時の全表スキャン性能を、代表的な件数（例: 5 万件）でベンチ計測し
  許容範囲を判定（未解決事項 2）

### 例外ハンドリング
- フォールバック検索失敗時に over-fetch した生行を成功結果として返さない現行挙動を維持
- バックエンド非対応分岐のフォールバック経路のテスト

## 実装アプローチ

1. **セマンティクス確定**（未解決事項 1）: `#AI` の前方一致 / 完全一致 / 部分一致を製品判断。
   現行クライアント側は「カンマ split して部分一致」、SQL 側 `buildFtsTagMatchCondition` は
   `#<tag>` MATCH。ギャップを埋める仕様を 1 つに決める
2. **クエリビルダー拡張**: `queryPlan.ts` の `buildPlainListStatements(spec, { tag })` に
   3 文字未満のタグで `tags LIKE ?` フォールバックを追加（`sqliteQueryBuilder.ts` の
   LIKE 版 `{ tagCondition: 'tags LIKE ?', tagParam: '#%' }` を汎用化）。
   `shouldUseFts5(fts5Available, bareTerm)` の閾値ロジックを流用
3. **`queryHistory()` 改修**: 非検索パスで `options.tagFilter` を `queryRows` の
   引数に渡し、`limit` / `offset` をそのまま SQL へ。`filterRowsByTag` 呼び出しと
   `filteredRows.slice(...)` を削除。`total` は SQL の返す件数を使う
4. **定数撤去**: `TAG_FILTER_FETCH_LIMIT` と `filterRowsByTag` を削除
   （`filterRowsByTag` に他の参照がないことを grep 確認）
5. **バックエンド分岐の扱い決定**（未解決事項 3）: `IdbVfsBackend.query` が tag に
   null を渡す・fallback / in-memory が無視する PBI-34「INTENTIONAL divergence」を、
   統合するか call site で明示エラー / フォールバックにするか決める
6. `shouldFallbackToTextSearch` フォールバックは SQL 側 0 件時にそのまま接続
7. コメント・ドキュメント更新

## 見積もり

0.5w（Effort=0.5 人週）。難易度: 🟡中（2pt 目安）。副作用: 🟡軽微
（tag マッチセマンティクス変更 + 短タグ LIKE の全表スキャン性能）。種別: 🔧非機能追加（fix）。

## 実装者向け注記（調査で判明した事実・2026-09-07）

### 現状のロジック（`src/dashboard/panels/asyncData/sqliteHistoryQuery.ts`）

- `TAG_FILTER_FETCH_LIMIT = 5000`（`:37`）
- `queryHistory()`（`:259-344`）の非検索パス（`:279-335`）:
  `const useServerPaging = !options.tagFilter;`（`:282`）。tagFilter 有効時は SQL に
  `limit: 5000, offset: 0` を渡して全件取得 → `filterRowsByTag(rows, options.tagFilter)`
  （`:302`、`:145-151`）で JS 側で部分一致フィルタ →
  `filteredRows.slice(offset, offset+limit)` でページング（`:328`）
- `filterRowsByTag`（`:145-151`）: `row.tags`（カンマ区切り文字列）を `split(',')` して
  `tag.trim().includes(tagFilter)` 部分一致
- 既知の制約（コメント `:288-296`）: sortDir が user 制御になったため
  「oldest first + tag filter」で「最も古い 5000 件」に cap され、新しいタグ付きエントリが
  サイレント除外。「known limitation, not a bug to fix here」
- 0 件ヒットかつ Tag Cluster 由来（`tagInitiated`）なら全文検索フォールバック
  （`shouldFallbackToTextSearch`、`historyFilters.ts:17-26`）

### なぜ client-side なのか（コード内の理由、`:253-258` / `:141-143`）

「SQL 側は FTS5 trigram MATCH でタグを照合、3 文字以上必須で LIKE フォールバックが
そのパスに無いため、短いタグ（例 "AI"）はサイレントに何も返さない」

### SQL 側のタグマッチ能力（既に存在）

- `src/offscreen/schema.ts:14` `tags TEXT`（カンマ区切りカラム）。
  **tags 専用インデックスは無い**（idx_logs_created / domain / active / obsidian / gist のみ、
  `:46-60`）
- `src/offscreen/queryPlan.ts` `buildPlainListStatements(spec, { tag })`（`:318-336`）:
  `opts.tag` あれば `buildFtsTagMatchCondition` を AND 追加。
  **opfs QUERY パスは tag を honor、`IdbVfsBackend.query` は null を渡して無視、
  fallback / in-memory も無視**（`:306-314` に
  「INTENTIONAL divergence preserved by PBI-34」）
- LIKE-fallback 検索パスは `tags LIKE ?` を含む（`:293`）
- `src/offscreen/sqliteQueryBuilder.ts` `buildFtsTagMatchCondition(tag)`（`:42-51`）:
  `id IN (SELECT rowid FROM browsing_logs_fts WHERE tags MATCH ?)`、param は
  `"#<cleanTag>"`（演算子文字除去）。`shouldUseFts5(fts5Available, bareTerm)`（`:110-114`）:
  `fts5Available && charLen >= 3`。LIKE 版:
  `{ tagCondition: 'tags LIKE ?', tagParam: '#%' }`（`:122`）

### この PBI でやること

- タグ絞り込みを SQL クエリに移す。3 文字以上は既存 FTS5 `MATCH` パス、3 文字未満は
  `tags LIKE '%<tag>%'` フォールバック
- `limit` / `offset` を SQL に直接渡し、`TAG_FILTER_FETCH_LIMIT = 5000` を撤去
- タグ一致セマンティクスを定義し直す（現状 JS は「カンマ split して部分一致」、SQL 側
  `buildFtsTagMatchCondition` は `#<tag>` MATCH。`#AI` が `#AImaster` にマッチすべきか等）

### 制約

- `historyFilters.ts` は `shouldFallbackToTextSearch` を SQLite パネルが使うため
  **ファイル削除不可**
- tag マッチのセマンティクス変更に注意（現行 client-side は部分一致、SQL は `#<tag>`
  FTS5 MATCH）
- FTS5 3 文字未満はフォールバック必要。`tags` カラムに無インデックスなので LIKE は
  全表スキャン
- IdbVfs / fallback / in-memory は tag フィルタを意図的に無視（PBI-34
  「INTENTIONAL divergence」）。この分岐の扱いを決める

## 未解決事項

1. **tag マッチの正しいセマンティクス**: `#AI` で `#AImaster` を含めるか
   （前方一致 / 完全一致 / 部分一致）。ユーザー期待とプロダクト判断
2. **5000 cap を SQL 化で本当に外せるか**: 短タグ LIKE フォールバック時の性能
   （tags 無インデックス全表スキャン）が許容範囲か。tags 用インデックスや正規化テーブルを
   別途作るべきか
3. **IdbVfs / fallback / in-memory の tag 無視分岐**を統合するか call site に残すか

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] 未解決事項 1〜3 が着手前に決定され、決定内容が PBI 実装メモに記録される
- [x] dashboard 関連テスト全 green（type-check / lint / build 含む）
- [x] LIKE フォールバックの性能ベンチを取得し、許容判定を PR に添付
- [x] コードレビュー完了（アーキテクチャ round 4 の全体検証で実施）
- [x] ドキュメント更新（DESIGN_SPECIFICATIONS.md の history panel 節に SQL 移行後の
      tag-filter 挙動と cap 撤去を反映。`sqliteHistoryQuery.ts` の "known limitation"
      コメントを解消済みに書き換え。CHANGELOG に振る舞い変更を記載）
- [x] `00-INDEX.md` の進行中テーブルを更新（着手時に「実装しない」注記を外す）

## 実装メモ（2026-09-11・arch-delivery-loop round 4）

### 未解決事項の決定

1. **セマンティクス = 部分一致を維持**（振る舞い不変の移行）。旧 client 側
   `filterRowsByTag` はカンマ split 後の `includes` 部分一致。SQL 側は
   `buildTagFilterCondition`（`sqliteQueryBuilder.ts`）に統一:
   - 3 文字以上 + FTS5 利用可 → trigram `MATCH`（phrase quote した生の語、**`#` prefix を付けない**
     — trigram は連続部分一致なので `AI` は `#AImaster` にヒットし、旧 client 挙動と同じ）
   - 3 文字未満 or FTS 無し → `tags LIKE '%<term>%'`（全表スキャン。`%`/`_` はワイルドカード
     として機能 — LIKE 検索パスと同一の documented 挙動）
2. **性能 = 実測で許容判定**。better-sqlite3 + 実スキーマ（FTS5 trigram・trigger 同期）で
   50,000 行を投入して計測:
   - `tags LIKE '%AI%'` rows: median 3.2ms / p95 3.2ms（6,428 件一致・COUNT 込み 3.1ms）
   - `FTS MATCH "project"` rows: median 2.3ms / p95 2.7ms（5,000 件一致）
   - 許容判定: dashboard の DASHBOARD_SQLITE_TIMEOUT=10000ms に対して 3 桁の余裕。
     tags 用インデックス/正規化テーブルは不要。
3. **backend 分岐 = 統合**（IdbVfsBackend / fallback / in-memory も tag を honor）。
   旧 PBI-34 の「INTENTIONAL divergence」は pinning test が存在しないことを確認済み
   （`query-backends-parametric.test.ts` の 3 divergence に tag は無い）。列投影の
   33 vs 13 分歧は 2026-09-09-03 の決着どおり維持。

### 実装

- `queryPlan.ts`: `buildQuerySpec` が `tagFilter: {condition, params} | null` を組む
  （fts5Available を注入）。`buildPlainListStatements` は spec の tagFilter を使用
  （opts.tag 引数は廃止）。`matchesExtraWhere` に tag 述語追加 + `tagMatchesFilter`
  （旧 filterRowsByTag と同一ルール）を SSOT 化。
- `IdbVfsBackend.query`: plain path が spec 経由で tag を適用（旧 divergence 削除）。
- `opfsWorker/crudHandlers.handleQuery`: `fts5Available: true` に変更（OPFS エンジンは
  FTS5 有効。旧 false は未使用の text-search 分岐向け simplification だった）。
- `storageFallback.query`: `tagMatchesFilter` による JS 述語を追加（旧: tag 無視）。
- `InMemoryTransport`: `matchesExtraWhere` 経由で自動的に tag を honor。
- `sqliteHistoryQuery.ts`: `TAG_FILTER_FETCH_LIMIT` / `filterRowsByTag` /
  `useServerPaging` 分岐 / client slice を削除。`tagFilter` を wire に渡し、SQL の
  total を使用。`shouldFallbackToTextSearch`（Tag Cluster 由来 0 件フォールバック）は
  SQL total === 0 で発火する形で維持（`historyFilters.ts` は削除せず）。
- parametric テストに tag parity（idb vs opfs 同一条件・同一 params）+ 旧 divergence
  不再発の regression pin を追加。

### 検証

- type-check / offscreen 961 tests / dashboard+messaging 1451 / background 1291 /
  utils+popup+content 3841 — 全 green（2026-09-11 時点）。
