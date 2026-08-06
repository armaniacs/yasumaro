# PBI: Tag Cluster クリック時にタグ未マッチなら全文検索へフォールバック

## ユーザーストーリー

ダッシュボードの **Tag Cluster** パネルを使う閲覧履歴のオーナーとして、タグノード (`#教育` など) をクリックしたとき、そのタグが付いた履歴が 0件なら自動で「タグ文字列を含む全文検索結果」に切り替わってほしい。なぜなら、クリックしても `0件` が出てくると「タグクラスタのバグ?」と不安になり、そのタグについて記録された情報にたどり着けず、Tag Cluster 機能自体の信頼を失うから。

## ビジネス価値

| 指標 | 現状 | 目標 |
|------|------|------|
| Tag Cluster → SQLite History 遷移後の 0件率 | 高 (タグ一致履歴がないタグは常に 0件) | タグ起点の遷移は常に N≥1件 を返す (フォールバック先も 0件のときのみ 0件) |
| Tag Cluster 経由で履歴に到達する操作 | 「タグ完全一致する履歴」のみ | 「タグまたは本文/タイトル/URL/AI要約にその文字列が含まれる履歴」 |
| Tag Cluster 機能の印象 | クリックしても何も出ない | クリック = 何らかの関連履歴に到達する |

## BDD受け入れシナリオ

```gherkin
Scenario: タグ一致が 0件のとき、自動で全文検索にフォールバックする
  Given ダッシュボードに「#教育」タグが 1件も付いていないが、本文・タイトル・AI要約に「教育」を含む履歴が 54件存在する
  When  ユーザーが Tag Cluster パネルで「#教育」ノードをクリックする
  Then  SQLite History パネルに切り替わり、54件すべてが表示される
  And   ヘッダーに「#教育」タグバッジが残ったまま、その下に「#教育 タグは 0件でした。「教育」を含む全文検索結果を表示しています (54件)。」という通知が表示される
  And   検索ボックス (input#sqlite-search-input) には "教育" が入力されている

Scenario: タグ一致が 1件以上あるとき、フォールバックせず既存挙動を維持する
  Given 「#tech」タグが付いた履歴が 5件存在し、本文に「tech」を含む履歴が追加で 10件ある
  When  ユーザーが Tag Cluster パネルで「#tech」ノードをクリックする
  Then  SQLite History パネルに 5件 (タグ一致分のみ) が表示される
  And   フォールバック通知は表示されない
  And   検索ボックスは空のまま

Scenario: フォールバック先も 0件のときは、通知を出さず従来の「0件」表示のまま
  Given どの履歴にも「#nonexistent」タグは付いておらず、本文・タイトル等にも「nonexistent」を含む履歴もない
  When  ユーザーが Tag Cluster パネルで「#nonexistent」ノードをクリックする
  Then  SQLite History パネルに「記録が見つかりませんでした。」と表示される
  And   フォールバック通知は表示されない (0件の通知を出しても混乱を招くため)

Scenario: フォールバック後にユーザーがタグフィルタの「×」を押すと、元の全件表示に戻る
  Given 上記「タグ一致が 0件のとき」シナリオで表示が 54件に切り替わっている
  When  ユーザーがタグフィルタ横の「×」ボタンをクリックする
  Then  検索ボックスの "教育" がクリアされ、全件 (または現在の範囲条件での全件) が再表示される
  And   フォールバック通知も消える

Scenario: ドメイン起点の遷移ではフォールバックを発動しない
  Given ドメイン検索パネルから「example.com」を起点に SQLite History に遷移した
  When  遷移時のフィルタで 0件だった
  Then  フォールバックは発動せず、searchQuery には "example.com" のまま (または空)、通知も出ない
```

## 受け入れ基準

- [ ] `shouldFallbackToTextSearch(source, tagRows, rawTagFilter)` 純粋関数が定義され、source / ヒット件数 / タグ文字列に応じて `string | null` を返す
- [ ] `onActivate({ searchTag })` 経路で `fetchData` に `tagInitiated: true` が伝搬する
- [ ] タグ絞り込み結果が 0件かつ `tagInitiated: true` のとき、`searchLogs(tag.replace(/^#/, ''))` を実行し結果を `state.entries` / `state.total` に入れる
- [ ] フォールバック発動時、`#タグ` バッジを残しつつ `state.pendingTagFallback` に `{ tag, fallbackTo, matched }` を保持し、`renderState` で通知を描画する
- [ ] ユーザーがタグクリア (`sqlite-tag-filter-clear`) を押すと `pendingTagFallback` も `searchQuery` もクリアされる
- [ ] ユーザーが `sqlite-search-input` を編集すると `pendingTagFallback` はクリアされる (通知だけ消える)
- [ ] フォールバック先の `searchLogs` が `{ error }` を返したときはフォールバックせず、元の 0件表示のまま
- [ ] i18n: `tagFallbackNotice` (日本語 / 英語) を `_locales/{ja,en}/messages.json` に追加する
- [ ] 既存の `searchLogs` / `queryLogs` のリトライ・タイムアウト挙動は変えない
- [ ] `npm run validate` (type-check + 全テスト) が緑
- [ ] `npm run build` が緑 (`dist/` 生成)
- [ ] 実機 Chrome でスクリーンショットと同条件 (`#教育` クリック) を再現し、54件 & 通知が表示されることを目視確認

## テスト戦略（t_wadaスタイル）

### 単体テスト (Vitest + jsdom)
- `src/dashboard/__tests__/historyFilters.test.ts` に `shouldFallbackToTextSearch` のケースを追加
  - source='manual' → null
  - rawTagFilter=null → null
  - rawTagFilter='#教育' → '教育' (`#` を剥がす)
  - tagRows.total > 0 → null
  - 空白トリム: `  #AI  ` → `AI`
  - 空文字: `'#'` → null

### 統合テスト (Vitest + jsdom)
- 新規 `src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanel-tagFallback.test.ts`
  - `onActivate({ searchTag: '教育' })` → `queryLogs` モックが空、`searchLogs` モックが 54件 → `state.entries.length === 54`、`state.searchQuery === '教育'`、`state.activeTagFilter === '教育'` のまま、`state.pendingTagFallback` がセットされる
  - `onActivate({ searchTag: 'tech' })` → `queryLogs` モックが 5件 → `searchLogs` は呼ばれない、`searchQuery` は空、`pendingTagFallback === null`
  - `onActivate({ searchTag: 'nonexistent' })` → 両方 0件 → `entries=[]`、通知なし
  - `onActivate({ searchDomain: 'example.com' })` → タグ起点ではないので `searchLogs` フォールバックは呼ばれない
  - `onActivate({ searchTag: '教育' })` でフォールバック後、タグクリアボタン (`sqlite-tag-filter-clear`) クリック → `pendingTagFallback === null`、`searchQuery === ''`

### E2Eテスト (任意・後段でも可)
- `testDir/e2e/dashboard-ui.spec.ts` に Tag Cluster 経由のフォールバック通知表示 spec を 1件追加 (優先度低)

### Outside-In 順
1. 統合テストを先に書き Red を確認
2. 単体テスト (`shouldFallbackToTextSearch`) を書いて Red を確認
3. 実装で Green
4. 統合テストが Green になったらリファクタ

## 実装アプローチ

- **Outside-In**: 統合テスト (sqliteHistoryPanel) から開始 → 失敗確認 → 単体テスト (`shouldFallbackToTextSearch`) → 失敗確認 → 実装 → グリーン → リファクタ
- **TDD**: 各レイヤーで Red-Green-Refactor
- **テスタビリティ**: `dashboardSqliteService` の `queryLogs` / `searchLogs` を `vi.mock` でモック

## 見積もり

🟡 **2pt** (中規模)。SQLite パネル側の state 拡張 + 既存 `fetchData` への分岐追加 + UI 通知 + i18n 2 言語 + テスト 2 ファイル。

## 技術的考慮事項

- **依存関係**: 既存 `searchLogs` (FTS5 / LIKE フォールバック) をそのまま流用。新規依存なし。
- **テスタビリティ**: `dashboardSqliteService` を `vi.mock` して `queryLogs` / `searchLogs` の戻り値を制御。
- **非機能要件**:
  - パフォーマンス: `searchLogs` のリトライが最大 2 回かかる (既存仕様)。タグ起点の遷移で +0.5〜1.5 秒。`state.loading` フラグで既にローディング UI は出ているので UX 影響は限定的。
  - アクセシビリティ: フォールバック通知は `role="status"` で `aria-live="polite"` 相当として読み上げ可能にする。
  - i18n: ja/en 両方を必ず追加 (PR レビューで ja-only を見つけたら差し戻し)。
- **i18n キー**: `tagFallbackNotice` 1 キーで `%tag%` `%term%` `%count%` のプレースホルダを使う。

## 実装者向け注記

### 現状コードの確認
着手前に以下を実行し、未実装であることを再確認:

```bash
grep -rn "tagFallback\|pendingTagFallback\|fallbackToTextSearch\|shouldFallbackToTextSearch" src/
grep -rn "tagFallbackNotice" public/_locales/
```

ヒットしなければ未実装。本 PBI 着手 OK。

### 設計プラン
`plans/2026-08-06-tag-cluster-fallback-to-text-search.md` を参照。設計の最終決定事項:

- フォールバック判定は `src/dashboard/historyFilters.ts` の純粋関数 `shouldFallbackToTextSearch(source, tagRows, rawTagFilter)` に集約
- `sqliteHistoryPanel.ts` の `SqliteHistoryState` に `pendingTagFallback: { tag: string; fallbackTo: string; matched: number } | null` を追加
- `fetchData` に `tagInitiated?: boolean` オプション追加。`onActivate` の `searchTag` 経路でのみ `true` を渡す
- `renderState` の `sqlite-tag-filter-bar` 直下にフォールバック通知 (`<div class="sqlite-tag-fallback-note" role="status">`) を描画
- タグクリア (`sqlite-tag-filter-clear`) 時に `pendingTagFallback = null` にする
- 検索入力 (`sqlite-search-input` の `input` イベント) 時に `pendingTagFallback = null` にする

### 実装手順
1. `historyFilters.ts` に `shouldFallbackToTextSearch` を追加 (純粋関数)
2. `historyFilters.test.ts` に単体テスト 6 ケース追加 → Red → Green
3. `_locales/ja/messages.json` と `_locales/en/messages.json` に `tagFallbackNotice` を追加 (各 1 行)
4. `sqliteHistoryPanel.ts`:
   - `SqliteHistoryState.pendingTagFallback` を追加
   - `fetchData` の `options` 型に `tagInitiated?: boolean` を追加
   - `onActivate` の `searchTag` 経路で `tagInitiated: true` を渡す
   - `fetchData` 内で `result.rows.length === 0 && options.tagInitiated` の場合に `searchLogs` フォールバック + `pendingTagFallback` セット
   - `renderState` で通知描画 (`#タグ` バッジの直下)
   - タグクリアボタンクリック時 + 検索入力時に `pendingTagFallback = null`
5. `sqliteHistoryPanel-tagFallback.test.ts` を新規作成 (統合テスト)
6. `npm run validate` → 緑
7. `npm run build` → 緑 (`dist/chromium-mv3` を Chrome にロードして `#教育` クリックで 54件 & 通知表示を目視確認)

### 落とし穴
- `state.searchQuery` をフォールバックでセットすると、ユーザーが `×` ではなく検索ボックス手動クリアで戻そうとしてもクリア後の `fetchData()` は `searchQuery=''` を見て全件再取得する。OK だが、フォールバック状態と手動検索状態が一見区別つかないので、通知 UI が唯一のシグナル。通知に「(タグ起点の自動切替)」と補足するとさらに親切 (任意)。
- `searchLogs` が `{ error: ... }` を返したケースをテストに含める (FTS5 無効環境でのフォールバック抑制)。
- `getPluralKey('historyRecordCount', n)` を使う件数表示は変えない (通知テキスト内の `%count%` だけ別途)。
- フォールバック後にページネーション (`currentPage = 0` 固定) 以外の操作 (日付範囲選択等) をユーザーが行った場合は、`pendingTagFallback` を残すかクリアするかで挙動が変わる。`searchQuery` がすでに「教育」になっているので、日付範囲を変えても `fetchData({ since, until })` 経路に入り「教育 AND 日付範囲」の結果になる。これはユーザーが意図した結果なので OK。`pendingTagFallback` はユーザーが明示的に「教育」検索を外すまで残す。
- `navigateToHistoryWithTag` 側の `searchTag: tag` セマンティクスは変えない (Tag Cluster パネルには触らない)。「タグ起点で履歴に遷移する」という意味は維持し、SQLite パネル側で吸収する。

## Definition of Done
- [ ] `shouldFallbackToTextSearch` の単体テスト 6 ケースが緑
- [ ] 統合テスト 5 シナリオ (フォールバック発動 / 既存挙動維持 / 両側 0件 / ドメイン起点 / タグクリア) が緑
- [ ] `npm run validate` 全テスト緑
- [ ] `npm run build` 成功 (`dist/chromium-mv3` 生成)
- [ ] 実機 Chrome で `#教育` クリック → 54件 & 通知表示、`#tech` クリック → 既存どおり 5件、`×` クリック → 全件に戻る、を再現確認
- [ ] i18n キーが ja/en 両方追加されている
- [ ] CHANGELOG.md にエントリ追加 (Conventional Commits: `feat(dashboard): Tag Cluster クリック時にタグ未マッチなら全文検索へフォールバック`)
- [ ] コードレビュー完了
