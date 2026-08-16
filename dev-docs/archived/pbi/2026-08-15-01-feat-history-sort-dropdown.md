# PBI: SQLite History パネルへの並び替え機能追加

## ユーザーストーリー

拡張機能ユーザーとして、SQLite History パネルの検索結果を新しい順・古い順・関連度順で並び替えたい、なぜなら現在は `created_at DESC` 固定で、古い記録を遡って探したり検索の関連度で絞り込んだりする手段がないから。

## ビジネス価値

- 検索結果を関連度順で確認できることで、目的の記録に到達するまでのスクロール量が減る
- 古い順ソートにより、特定の時期の閲覧履歴を体系的に振り返れる
- 測定方法: 実装後、ダッシュボードでソート操作が正しく機能し、選択が次回起動時も引き継がれることを手動確認で検証する（利用ログ等の定量計測は本PBIのスコープ外）

## 既実装確認（着手前チェック済み）

以下を実施済み — **未実装であることを確認済み**:

- 非検索パス（`queryLogs`）は既に `orderBy`/`orderDir` パラメータを持つが、呼び出し元（`sqliteHistoryQuery.ts`）が `created_at DESC` 固定で呼んでいる
- 検索パス（`searchLogs` → 3バックエンド: `IdbVfsBackend` / OPFS Worker / `FallbackStorageAdapter`）は `ORDER BY rank` 固定で、並び替えパラメータ自体が存在しない
- `dashboardSqliteProtocol.ts` の `search` サブタイプ定義に `orderBy`/`orderDir` は無い
- UIにソート切り替え要素は存在しない（`sqliteHistoryPanel.ts` を確認）

実装者は着手前に以下で現況の再確認を行うこと（コードは変更が入る可能性があるため）:

```bash
grep -n "orderBy\|orderDir" src/dashboard/panels/asyncData/sqliteHistoryQuery.ts src/dashboard/dashboardSqliteService.ts
grep -n "'search'" src/background/handlers/dashboardSqliteProtocol.ts
```

## 分割判断

技術レイヤー分割（バックエンド/UI等）は行わない。「並び替えが検索・非検索の両方の結果一貫して効く」という単一のユーザー価値を1PBIとして扱う。3バックエンド全てへの対応が必要なため、1スプリント相当のサイズとして妥当と判断（既存の実装計画で11タスクに分解済み）。

## BDD受け入れシナリオ

```gherkin
Scenario: 新しい順から古い順に切り替える
  Given SQLite History パネルを開いており、複数件の記録が新しい順で表示されている
  When ソートドロップダウンで「古い順」を選択する
  Then 一覧が created_at 昇順（最も古い記録が先頭）で再表示される
  And ページが1ページ目にリセットされる

Scenario: 検索実行中のみ関連度順が選べる
  Given SQLite History パネルを開いており、ソートは「新しい順」、検索欄は空である
  When 検索欄にキーワードを入力して検索を実行する
  Then ソートドロップダウンに「関連度順」の選択肢が追加され、それが選択された状態になる
  And 一覧はFTS5のランキングスコア順で表示される

Scenario: 検索をクリアすると関連度順から新しい順にフォールバックする
  Given 検索を実行しており、ソートが「関連度順」になっている
  When 検索欄を空にする
  Then ソートドロップダウンから「関連度順」の選択肢が消える
  And ソートは自動的に「新しい順」に戻り、一覧もそれに従って再表示される

Scenario: ソート設定がダッシュボード再読み込み後も保持される
  Given ソートを「古い順」に変更した
  When ダッシュボードを再読み込みする
  Then SQLite History パネルの初期表示は「古い順」のまま維持される

Scenario: 日付フィルタとソートを併用する
  Given SQLite History パネルで「過去7日間」ボタンを押し、期間フィルタが適用されている
  When ソートを「古い順」に変更する
  Then 過去7日間に絞り込まれた記録が、その範囲内で古い順に表示される
```

## 受け入れ基準

- [ ] ソートドロップダウンが検索ボックス付近に表示され、デフォルトは「新しい順」（`created_at DESC`）
- [ ] 「古い順」選択時、非検索パス・検索パスともに `created_at ASC` で結果が返る
- [ ] 「関連度順」は実際にFTS5全文検索が実行されている間のみ選択肢に表示され、検索開始時のデフォルトになる。タグクリックにより検索ボックスに文字列が入っているだけでFTS5検索が動いていない状態（`fetchData`に`search`が渡っていない状態）では表示しない。ただしタグフィルタが全文検索へフォールバックしている場合は表示する
- [ ] 検索クエリを空にすると、ソートが「関連度順」だった場合は「新しい順」に自動フォールバックする
- [ ] 選択したソート設定が `chrome.storage.local` に永続化され、ダッシュボード再読み込み後も引き継がれる
- [ ] 3つの検索バックエンド（`IdbVfsBackend`／OPFS Worker／`FallbackStorageAdapter`）すべてで `orderBy`/`orderDir` に応じた `ORDER BY` 分岐が機能する
- [ ] `orderBy`/`orderDir` が `dashboardSqliteService.searchLogs()` からバックエンドまでの全経路（`sqliteClient.searchResult()` の本番配線 `createSqliteClientDeps`、`offscreen.ts` のメッセージハンドラ、`src/messaging/sqliteMessages.ts` のメッセージ型定義を含む）で型安全に途切れず伝播する — 実装中の調査でこの3箇所が当初の実装計画から漏れていたことが判明し、Task 4.5として追加・Task 5に統合した（`sqliteMessages.ts`は`tsc --noEmit`実行で発覚）
- [ ] ソート変更時、ページングは1ページ目にリセットされる
- [ ] タグフィルタ・日付フィルタと併用してもソートが正しく適用される（ただし既知の制約: タグフィルタ有効時は `TAG_FILTER_FETCH_LIMIT`=5000件のクライアント側取得が発生するため、「古い順」選択時は直近5000件超のタグ付き記録が表示対象から漏れうる — 実装計画Task 2「Known limitation」参照。この制約自体の解消は本PBIのスコープ外）
- [ ] 既存の期間フィルタボタン（今日/昨日/過去7日間/過去30日間）・カレンダー日付選択の挙動に変更がない

## テスト戦略（t_wadaスタイル）

### E2Eテスト（最小限）
- 手動確認（本PBIでは自動E2Eを新設しない — 既存のPlaywright E2E資産がSQLite History向けに薄いため、実装計画Task 11の手動チェックリストで代替）:
  1. 「古い順」切替で並びが反転する
  2. 検索実行で「関連度順」が現れ、クリアで消える
  3. リロード後もソートが保持される
  4. 期間フィルタとの併用が壊れない

### 統合テスト
- `sqliteHistoryQuery.test.ts`: `queryHistory()` が `sortBy`/`sortDir` を非検索パス・検索パス・タグフォールバック検索パスの3経路すべてに正しく伝播すること
- `dashboardSqliteHandlers.test.ts`: `search` サブタイプが `orderBy`/`orderDir` を `deps.search()` に渡すこと
- `dashboardSqliteService.test.ts`: `searchLogs()` が `orderBy`/`orderDir` をメッセージペイロードに含めること

### 単体テスト
- `sqliteHistoryPanelState.test.ts`: `sortChange` アクションの状態遷移、`search` アクションでのrelevanceフォールバックルール
- `IdbVfsBackend-search-sort.test.ts`: FTS5パス・LIKEフォールバックパスそれぞれで `ORDER BY` 節が `orderBy`/`orderDir` により切り替わること
- `storageFallback-search-sort.test.ts`: メモリ内ソートが `orderBy=created_at` の `ASC`/`DESC` で正しい順序を返すこと
- 境界値: `sortBy` 未指定時のデフォルト値（`created_at`/`DESC`）、`relevance` 指定時に検索クエリが空の場合の扱い

## 実装アプローチ

- **Outside-In**: 実装計画（`docs/superpowers/plans/2026-08-15-history-sort-and-date-filter.md`）のTask 1（状態層）から開始し、各層のテストを先に書いてから実装する
- **Red-Green-Refactor**: 各タスクは「失敗するテストを書く→実行して失敗確認→最小実装→テスト成功確認→コミット」のサイクルで進める
- **リファクタリング**: 全11タスク完了後、`npm run validate` と型チェックで全体の整合性を確認してから手動検証に進む

## 見積もり

5pt（要チームでの見積もり）— バックエンド3系統（IdbVfs/OPFS Worker/Fallback）すべてに同種の分岐変更が必要なため中〜高難度。設計・実装計画は既に完了しており、単体タスクへの分解リスクは低い。

## 技術的考慮事項

- **依存関係**: なし。既存の日付フィルタ・タグフィルタ機能は変更せず、そのまま活用する
- **テスタビリティ**: `IdbVfsBackend`・`FallbackStorage`はエンジンやchrome.storage.localをスタブ化してSQL文字列・ソート結果を検証する。OPFS Worker側は既存の単体テスト資産が薄いため、型チェックとE2E相当の手動確認で担保する
- **非機能要件**: SQLインジェクションのリスクなし（`orderBy`/`orderDir`は`'rank'|'created_at'`と`'ASC'|'DESC'`の閉じた文字列リテラル集合からのみ構築し、ユーザー入力を直接SQL文字列に埋め込まない）

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -n "orderBy\|orderDir" src/dashboard/panels/asyncData/sqliteHistoryQuery.ts
grep -n "async search" -A 5 src/offscreen/IdbVfsBackend.ts src/offscreen/storageFallback.ts
grep -n "'search'" src/background/handlers/dashboardSqliteProtocol.ts
```

前回確認時点（2026-08-15）では検索パスに `orderBy`/`orderDir` が一切存在しなかった。もし既に対応済みであれば、本PBIは「UIドロップダウン追加のみ」に縮小できる可能性がある。

### 実装手順

詳細な手順・コードは実装計画に完全に記載済み: `docs/superpowers/plans/2026-08-15-history-sort-and-date-filter.md`

概要（実装計画のTask番号に対応）:
1. `sqliteHistoryPanelState.ts` に `sortBy`/`sortDir` 状態と `sortChange` アクションを追加（Task 1）
2. `sqliteHistoryQuery.ts` の `queryHistory()` に `sortBy`/`sortDir` を伝播（Task 2）
3. `dashboardSqliteService.searchLogs()` に `orderBy`/`orderDir` パラメータ追加（Task 3）
4. `dashboardSqliteProtocol.ts` / `dashboardSqliteHandlers.ts` の `search` サブタイプ拡張（Task 4）
5. `recordsRepo.search()` の passthrough 更新（Task 5）
6. `IdbVfsBackend.search()` の `ORDER BY` 分岐実装（Task 6）
7. OPFS Worker (`opfsWorker.ts`, `OpfsWorkerBackend.ts`) の同等分岐（Task 7）
8. `FallbackStorage.search()` のメモリ内ソート実装（Task 8）
9. `StorageKeys.HISTORY_SORT_PREFERENCE` とi18nラベル追加（Task 9）
10. `sqliteHistoryPanel.ts` にソート `<select>` UIと永続化ロジックを追加（Task 10）
11. `npm run validate` + 手動Chrome確認（Task 11）

### 落とし穴

- **3バックエンドの一貫性**: `IdbVfsBackend`・OPFS Worker・`FallbackStorageAdapter` のいずれか1つでもORDER BY分岐を入れ忘れると、実行環境（OPFS対応ブラウザか、IndexedDBフォールバックか、ストレージ完全フォールバックか）によってソートが効いたり効かなかったりする不具合になる。3系統すべてを必ず変更すること
- **relevance と検索クエリの整合性（双方向）**: 「関連度順」はFTS5の `rank` に依存するため、検索クエリが空の状態でrelevanceのままにすると意味を持たない。`search`アクションのリデューサーは**2方向とも**扱う必要がある — (1) 検索クエリが空になった際に自動的に`created_at DESC`へフォールバックする、(2) 検索クエリが空→非空に変わった（検索を開始した）際に自動的に`relevance`へ切り替える。(2)を実装し忘れると、直前に「古い順」等を選んでいたユーザーが検索を実行しても`created_at`のままになり、「検索開始時のデフォルトになる」という受け入れ基準を満たさない（アドバーサリアルレビューで検出、`sqliteHistoryPanelState.ts`のテストで両方向を担保すること）
- **タグフィルタのクライアント側フォールバック検索**: `sqliteHistoryQuery.ts`内でタグフィルタがヒットせず全文検索にフォールバックする経路（`shouldFallbackToTextSearch`）にも `orderBy`/`orderDir` を渡し忘れないこと。ここを見落とすとタグ由来のフォールバック検索だけソートが効かない
- **タグフィルタ + 5000件キャップ + ソート方向の非対称性（既知の制約、修正不要）**: タグフィルタ有効時、`TAG_FILTER_FETCH_LIMIT`=5000件をSQLクエリで取得してからクライアント側でタグ絞り込みする。これまでは常に`DESC`固定だったため「直近5000件のみ」という一貫した制約だったが、`orderDir`が可変になると「古い順」選択時は「最古の5000件のみ」を取得することになり、直近のタグ付き記録が表示から漏れる非対称な挙動になる。これは本PBIで新規に発生させる欠陥ではなく、ソート機能追加によって顕在化する既存アーキテクチャの制約なので、修正はスコープ外。ただしコードコメント・テスト・手動確認項目でこの挙動を明示的に記録すること（実装計画Task 2参照）
- **「関連度順」表示条件は検索ボックスの文字有無だけでは判定できない**: タグクリック（`tagInitiated`）は検索ボックスに「タグ名」を表示ラベルとしてセットするだけで、実際にはFTS5検索を実行しない（`fetchData`は`tagFilter`のみを渡し`search`は渡さない）。そのため「検索ボックスが非空なら関連度順を表示する」という単純な条件だと、タグフィルタ中に選んでも何も起きない無効な選択肢を見せてしまう。かといって「タグフィルタが有効なら常に非表示」にすると、タグがヒットせず全文検索にフォールバックした場合（`pendingTagFallback`が立っている状態）は実際にFTS5検索が動いているのに関連度順を隠してしまう逆方向のバグになる。`isFullTextSearchActive(state)`のように「タグフィルタなし かつ 検索クエリが非空」または「タグフィルタありでもフォールバック検索が成立している」の両方を判定する必要がある（実装計画Task 10参照）
- **SQLインジェクション対策**: `orderBy`/`orderDir` を SQL 文字列に埋め込む際は、必ず型で閉じた文字列リテラル（`'rank'|'created_at'`、`'ASC'|'DESC'`）からのみ構築し、生の`payload.orderBy`のような外部入力をそのままテンプレートリテラルに挿入しないこと
- **LIKEフォールバック検索（3文字未満のクエリ）**: FTS5が使えない短いクエリ用のLIKE検索パスにも同じORDER BY分岐が必要。FTS5パスだけ直して満足しないこと
- **既存テストの期待値更新漏れ**: `sqliteHistoryQuery.ts`（Task 2）の変更で`searchLogs`呼び出しが常に4引数目（`{orderBy, orderDir}`）を持つようになったが、これを直接呼び出す全てのテストファイルを更新しないと、機能自体は正しいのにテストだけ落ちる状態になる。今回`sqliteHistoryPanel-tagFallback.test.ts`（Task 2の直接のレビュー範囲外だった兄弟ファイル）で4件の見落としが発生した。パネル層のUI実装（Task 10）を行う際は`npx vitest run`をこのパネルのテストディレクトリ全体に対して実行し、新規追加した機能以外の既存テストも含めて確認すること
- **新規StorageKeysは`getSettings()`契約テストへの追加要否を必ず確認する**: `src/utils/__tests__/storage-keys.test.ts`は、`getSettings()`が`internalKeys`リストに載っていない全`StorageKeys`をプロパティとして返すことを検証する契約テスト。`HISTORY_SORT_PREFERENCE`は`chrome.storage.local`を直接読み書きする設計（`getSettings()`/`saveSettings()`経由ではない）のため、この`internalKeys`リストへの追加が必要だったが、Task 9新設時には見落とされ、`npm run validate`をプロジェクト全体に対して実行して初めて（Task 11で）発覚した。個別のタスクスコープのテストだけでなく、Task 11のような全体検証を経ないと気づけない種類の欠落がある

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする（手動確認シナリオを除く）
- [ ] テストカバレッジ: 状態層・クエリ層・サービス層・ハンドラ層・3バックエンドそれぞれに単体/統合テストが存在する
- [ ] `npm run validate`（型チェック＋全テスト）が成功する
- [ ] `npm run build` が成功し、`dist/chromium-mv3` が生成される
- [ ] 実装計画Task 11の手動確認チェックリスト（実Chrome環境）を実施し、全項目が通過する
- [ ] コードレビュー完了
- [ ] リファクタリング完了（各タスクがグリーンになった後の整合性確認を含む）
- [ ] `pbi/00-INDEX.md` を更新（本PBI追加、完了後はアーカイブ）
