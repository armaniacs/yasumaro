# PBI: 探索パスのツリー表示と「検索→解決」指標

種別: feat

## ユーザーストーリー

自分の調べ方を改善したいユーザーとして、2つのことをしたい。

- 各セッションで、どの検索語から始めてどのページを経由したかをツリーで見る。
- タグごとに「検索から解決までに平均何ページ・何分かかったか」を見て、迷子になりやすいテーマを知る。

どの経路が役に立ったかが残っていれば同じ調査の近道になるし、時間のかかるテーマには、先に自分用のノートを用意しておけるから。

## ビジネス価値

- 提案2の中心である「線（プロセス）」の分析を形にする。
- 探索パスで「どの記事を比べ、最後にどれへたどり着いたか」を再現でき、暗黙知が残る。
- 検索→解決指標で、時間のかかるテーマが数字で分かり、ノート化や学習の優先度を決める材料になる。
- 02（セッション集計）と 03（`nav_source_url` / `search_query`）を組み合わせるだけで作れる。記録経路は変えない。

## 優先度

- 順位: 04 / 4
- RICEスコア: 0.67（Reach=2 / Impact=2 / Confidence=50% / Effort=3 SP）
- 根拠:
  - Impact は大きいが、遷移記録をオプトインした人にしか届かない。
  - 「解決ページ = セッションの最後の記録」という定義の妥当性は、実データでまだ確かめていない。そのため Confidence は 50% とした。
  - RICE では 03 より高いが、03 に依存するので後回しにする（依存を優先）。
- 依存: 02（`groupResearchSessions` と `renderRecord`）、03（2 列、`normalizeNavUrl`、`getNavTrailConsent`）

## BDD受け入れシナリオ

```gherkin
Scenario: 検索から始まったセッションが経路のツリーで表示される
  Given 遷移記録が有効である
  And 10:00 に「react suspense」を検索して記事 A を開き、A から記事 B、B から記事 C に移って、3 件とも記録された
  When ユーザーがリサーチ・セッションでそのセッションを開く
  Then 先頭に「検索: react suspense」が表示される
  And A の下に B、B の下に C が入れ子で表示される

Scenario: 流入元がセッション内にない記録は根になる
  Given 同じセッションに、流入元が記事 A の記事 B と、流入元が外部サイトの記事 D がある
  When ユーザーがセッションを開く
  Then B は A の子として表示される
  And D は根として表示される

Scenario: タグごとの検索→解決指標が表示される
  Given 検索から始まり、最後の記録にタグ #react が付いたセッションが 2 件ある
  And その 2 件は 4 ページ・20 分と、2 ページ・10 分である
  When ユーザーがリサーチ・セッションを開く
  Then 「迷子になりやすいトピック」の表に「react / 2 / 3.0 / 15」の行が表示される

Scenario: 対象のセッションが少ないタグは表示しない
  Given 検索から始まり、最後の記録にタグ #vue が付いたセッションは 1 件だけである
  When ユーザーがリサーチ・セッションを開く
  Then 「迷子になりやすいトピック」に vue の行は表示されない

Scenario: 遷移記録が無効なら案内を出す
  Given 遷移記録が無効である
  When ユーザーがリサーチ・セッションを開く
  Then セッションは 02 と同じ平坦な一覧で表示される
  And 指標の表の代わりに「設定で『遷移記録』を有効にすると、検索から解決までの経路を表示できます。」が表示される
```

## 受け入れ基準

- [ ] セッション内のどれかの記録に `nav_source_url` があれば、そのセッションの展開部を入れ子の `<ul>` によるツリーで描画する。1 件もなければ 02 と同じ平坦な一覧で描画する
- [ ] 親は「同じセッション内で自分より前にあり、URL が自分の流入元と一致する記録のうち最も新しいもの」とする。URL の比較は `normalizeNavUrl` で正規化してから行う
- [ ] 先頭の記録に `search_query` があれば、ツリーの前に「検索: …」を表示する
- [ ] 検索→解決指標の算出規則
  - 対象: 先頭の記録に `search_query` があるセッション
  - 解決ページ: セッションの最後の記録
  - 集計単位: 解決ページのタグ。タグなしは「(タグなし)」にまとめる
  - 表示: セッション数が 2 以上のタグだけ
  - 並び順: 平均ページ数の降順
- [ ] 平均ページ数は小数 1 桁、平均分は整数で表示する
- [ ] 遷移記録が無効なら、指標の表を隠して案内文を表示する
- [ ] ガイド（ja / en）に次の 3 点を書く: 解決ページの定義、指標の限界（同日の再訪はスキップされ、記録にはゲートもあるため、記録されない経路がある）、有効にする手順
- [ ] `npm run validate` と `npm run build` が通る

## 詳細設計

### 変更ファイル一覧

| # | ファイル | 種別 |
|---|---|---|
| 1 | `src/dashboard/researchSessionAggregate.ts` | 変更（関数 2 つと定数を追加） |
| 2 | `src/dashboard/panels/asyncData/researchSessionsPanel.ts` | 変更（ツリー描画・指標の表・無効時の案内） |
| 3 | `entrypoints/options/index.html` | 変更（指標の見出し・表・案内を section に追加） |
| 4 | `entrypoints/options/dashboard.css` | 変更（ツリーの字下げ） |
| 5 | `public/_locales/{ja,en}/messages.json` | 変更 |
| 6 | テスト（変更 2） | — |
| 7 | `docs/DATA_ANALYTICS_GUIDE.md` / `CHANGELOG.md` | 変更 |

### 1. 集計（`src/dashboard/researchSessionAggregate.ts` に追加）

```ts
import { normalizeNavUrl } from '../utils/navUrl.js';

export interface SessionTreeNode { record: SessionInput; children: SessionTreeNode[] }
export interface SearchToGoalRow { tag: string; sessions: number; avgPages: number; avgMinutes: number }
export const SEARCH_TO_GOAL_MIN_SESSIONS = 2;
export const UNTAGGED_KEY = '';

export function hasNavTrail(session: ResearchSession): boolean
export function buildSessionTree(session: ResearchSession): SessionTreeNode[]
export function computeSearchToGoal(sessions: readonly ResearchSession[]): SearchToGoalRow[]
```

**`hasNavTrail`**: `session.records` の中に、`nav_source_url` が空でない文字列の記録が 1 件でもあれば true を返す。

**`buildSessionTree`**

1. `session.records` は昇順に並んでいる（02 で保証済み）。
2. 各記録から `SessionTreeNode`（`children` は空配列）を作る。
3. `lastNodeByUrl = new Map<string, SessionTreeNode>()` を用意し、記録を昇順に 1 件ずつ処理する。
   1. `const src = rec.nav_source_url ? normalizeNavUrl(rec.nav_source_url) : null`
   2. `const parent = src ? lastNodeByUrl.get(src) : undefined`
   3. `parent` があれば `parent.children.push(node)`、なければ `roots.push(node)`
   4. `const self = normalizeNavUrl(rec.url)`。null でなければ `lastNodeByUrl.set(self, node)` で上書きする。上書きするので、同じ URL が複数回あれば最新のものが親になる。
4. `roots` を返す。親より後の記録だけが子になるので、循環は起きない。

**`computeSearchToGoal`**

1. `records[0].search_query` が空でないセッションだけを対象にする。
2. 各セッションについて、次の値を求める。
   - `pages = records.length`
   - `minutes = sessionDurationMinutes(durationMs)`（02 の関数）
   - `tags = parseTagsForDisplay(records[records.length - 1].tags)`。空なら `[UNTAGGED_KEY]`
3. タグごとに `{ sessions, pagesSum, minutesSum }` を積み上げる。1 セッションに複数のタグがあれば、そのすべてに 1 セッションとして加える。
4. 行を作る。
   - `avgPages = Math.round(pagesSum / sessions * 10) / 10`
   - `avgMinutes = Math.round(minutesSum / sessions)`
5. `sessions >= SEARCH_TO_GOAL_MIN_SESSIONS` の行だけを残す。
6. 並べ替える。`avgPages` の降順、同じなら `sessions` の降順、それも同じなら `tag` の昇順（`<` で比較）。

### 2. パネル（`researchSessionsPanel.ts` の変更）

**状態**: `navTrailActive: boolean = false` を追加する。

**reload()**: `fetchPeriodRows` と同じタイミングで `navTrailActive = isNavTrailActive(await getNavTrailConsent())` を取得する。`Promise.all` で並列に実行してよい。同意の読み込みに失敗したときは false として扱い、パネルの読み込みは失敗させない。

**render()**: 次の処理を追加する。

- セッションの展開部
  - `hasNavTrail(session)` が true なら `renderTree(buildSessionTree(session))` を使う。
  - false なら、02 と同じ `<ol>` による平坦な一覧を使う。
- 先頭記録の `search_query`: 空でなければ、展開部の先頭に `<p class="research-sessions-query-root">` を置き、`msg('researchSessions_searchQuery', { q }, 'Search: {q}')` を入れる。このとき、03 で追加した記録行側の「検索: …」は先頭の記録では出さない（重複を避けるため）。
- 指標の表
  - `navTrailActive` が true の場合:
    1. `#researchSessionsSearchToGoalOff` を hidden にする。
    2. `#researchSessionsSearchToGoalTable` を表示する。
    3. `computeSearchToGoal(agg.sessions)` の行を `#researchSessionsSearchToGoalBody` に描画する。
    4. 行が 0 件なら、`<td colspan="4">` に `researchSessions_searchToGoalEmpty` を入れる。
  - false の場合: 表を hidden にし、案内の `<p>` を表示する。
  - 注意: 集計の対象は、表示用に切り詰めた `agg.sessions`（最大 100 件）とする。これは `truncated` 通知と同じ範囲であり、ガイドにもそう書く。

**renderTree(nodes: SessionTreeNode[]): HTMLUListElement**

- `<ul class="research-sessions-tree">` を作る。
- 各ノードについて `<li>` を作る。
  - 中身は 02 の `renderRecord(node.record)` から取り出す。この関数が `<li>` を返す場合は、その中身を移すか、中身だけを返すように 02 の関数を分割してよい。
  - `children.length > 0` なら、`renderTree(children)` の結果を追加する。
- 再帰で深さは無制限にする。セッションは最大でも 10000 行を分割したものなので、実用上は問題ない。

### 3. HTML（`#panel-research-sessions` の `</ol>` の直後に追加）

```html
<h3 class="data-table-heading" data-i18n="researchSessions_searchToGoalTitle">Topics that take the longest to resolve</h3>
<p class="data-table-notice is-muted" data-i18n="researchSessions_searchToGoalHint">Sessions that started from a search, grouped by the tags of their last page.</p>
<p id="researchSessionsSearchToGoalOff" class="data-table-notice is-muted" data-i18n="researchSessions_navTrailOff" hidden>Turn on "Record navigation trail" in Privacy settings to see paths from search to resolution.</p>
<table id="researchSessionsSearchToGoalTable" class="data-table">
  <thead><tr>
    <th scope="col" data-i18n="researchSessions_tagColumn">Tag</th>
    <th scope="col" data-i18n="researchSessions_sessionsColumn">Sessions</th>
    <th scope="col" data-i18n="researchSessions_avgPagesColumn">Avg. pages</th>
    <th scope="col" data-i18n="researchSessions_avgMinutesColumn">Avg. minutes</th>
  </tr></thead>
  <tbody id="researchSessionsSearchToGoalBody"></tbody>
</table>
```

平均ページ数は `avgPages.toFixed(1)` で表示する。タグが `UNTAGGED_KEY` の行は、`msg('researchSessions_untagged', {}, '(untagged)')` を表示する。

### 4. CSS（`.research-sessions-records li` の後に追加）

```css
.research-sessions-tree {
  list-style: none;
  margin: 0;
  padding-left: var(--ym-space-3, 12px);
  border-left: 1px solid var(--ym-color-border, #e2e8f0);
}
.research-sessions-query-root {
  margin: var(--ym-space-1, 4px) 0;
  font-weight: 600;
}
```

`.research-sessions-query-root` 以外の新しい色指定は追加しない。

### 5. i18n（ja / en）

`description` は英語で書く。

| キー | ja | en |
|---|---|---|
| `researchSessions_searchToGoalTitle` | 迷子になりやすいトピック | Topics that take the longest to resolve |
| `researchSessions_searchToGoalHint` | 検索から始まったセッションを、最後に見たページのタグごとにまとめています。 | Sessions that started from a search, grouped by the tags of their last page. |
| `researchSessions_navTrailOff` | 設定で「遷移記録」を有効にすると、検索から解決までの経路を表示できます。 | Turn on "Record navigation trail" in Privacy settings to see paths from search to resolution. |
| `researchSessions_tagColumn` | タグ | Tag |
| `researchSessions_sessionsColumn` | セッション数 | Sessions |
| `researchSessions_avgPagesColumn` | 平均ページ数 | Avg. pages |
| `researchSessions_avgMinutesColumn` | 平均分 | Avg. minutes |
| `researchSessions_untagged` | (タグなし) | (untagged) |
| `researchSessions_searchToGoalEmpty` | 検索から始まったセッションが2件以上あるタグはまだありません。 | No tag has two or more sessions that started from a search yet. |

### 6. ドキュメント

`docs/DATA_ANALYTICS_GUIDE.md`（ja / en）の「リサーチ・セッション」の節に、次を追記する。

- **探索パス**: ツリーの読み方と、親を決める規則。
- **迷子になりやすいトピック**: 次の 3 点を書く。
  - 解決ページの定義（セッションの最後の記録）
  - 集計対象は表示中の最大 100 セッションであること
  - 指標の限界（同日の再訪はスキップされ、ゲート条件（5 秒・50%）も満たさないページは記録されないため、実際の経路より短く出る）
- **有効化の手順**: 「プライバシー」→「遷移記録」の順に開いて有効にする。

あわせて CHANGELOG の Unreleased に追記する。

## 実装手順（Outside-In TDD）

1. main からブランチ `feature/session-path-tree` を切る（02 と 03 がマージ済みであること）。
2. `researchSessionAggregate.test.ts` に `hasNavTrail`、`buildSessionTree`、`computeSearchToGoal` のケースを追加し、失敗することを確認する（Red）。
3. 集計を実装する（Green）。
4. `researchSessionsPanel.lifecycle.test.ts` にツリー、指標、無効時の案内のケースを追加する（Red）。
5. パネル、HTML、CSS、i18n を実装する（Green）。
6. ガイドと CHANGELOG を更新する。
7. `npm run validate` と `npm run build` を実行し、Chrome で手動確認する（遷移記録を ON にしたうえで、検索 → A → B → C と移る）。

## テスト戦略

### 単体（`researchSessionAggregate.test.ts` に追記）

| # | ケース | 期待 |
|---|---|---|
| 1 | `nav_source_url` を持つ記録がない | `hasNavTrail` が false |
| 2 | A、B（src=A）、C（src=B） | ルートは A だけ。A の子が B、B の子が C |
| 3 | A、D（src=外部サイト） | ルートは A と D |
| 4 | A、A'（同じ URL で後の時刻）、B（src=A） | B の親は A'（最新のもの） |
| 5 | B の src が `A#section`、A の URL にはフラグメントがない | 正規化により、B は A の子になる |
| 6 | 先頭の記録に `search_query` がないセッション | 指標の対象外になる |
| 7 | 解決ページのタグが `#a #b` のセッションが 2 件 | a と b の両方に `sessions: 2` として計上される |
| 8 | タグ a のセッションが 1 件だけ | 行に出ない |
| 9 | 4 ページ・20 分と、2 ページ・10 分（タグ react） | `{ tag: 'react', sessions: 2, avgPages: 3, avgMinutes: 15 }` |
| 10 | 解決ページにタグがない | `tag: ''` に集計される |
| 11 | avgPages 3.0 と 3.0 で sessions が 2 と 3 | sessions が多い方が先に並ぶ |

### 統合（`researchSessionsPanel.lifecycle.test.ts` に追記）

- **遷移ありの行を返す**: `queryLogs` が `nav_source_url` と `search_query` を持つ行を返すようにする。
  - `.research-sessions-tree` が入れ子で描画されること。
  - 先頭に「Search: …」が 1 回だけ表示されること。
- **同意が有効**: `navTrailConsent` を `vi.mock` して有効にする。指標の表に行が描画され、案内が hidden になること。
- **同意が無効**: 表が hidden になり、案内が表示されること。
- **同意の読み込みが reject**: 例外にならず、無効として扱われ、セッション一覧は表示されること。

### 回帰

- `localeParity.test.ts`
- 02 の lifecycle テスト（平坦な一覧の表示が壊れていないこと）

## 落とし穴（実装者向け）

- URL の比較は、必ず両側を `normalizeNavUrl` で正規化してから行う。フラグメントの違いで親が見つからなくなる。
- `lastNodeByUrl` は、自分の親を探した**後**に自分を登録する。先に登録すると、自分自身を親にしてしまう場合がある。
- 先頭記録の「検索: …」は、ツリーの前と記録行の両方に出さない。
- `normalizeNavUrl` は `src/utils/navUrl.ts`（03 で追加）から import する。background 側のモジュールは dashboard から import できない（ESLint の層境界）。
- import は `.js` 拡張子にする。`any` と `unknown` は使わない。定数は直接書かない。`innerHTML` は要素を空にする用途に限る。

## 見積もり

3 SP（集計 1 ＋ ツリー描画 1 ＋ 指標の表・案内・ドキュメント 1）

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run validate` と `npm run build` が通る
- [ ] Chrome での手動確認済み
- [ ] コードレビュー完了
- [ ] ガイド（ja / en）・CHANGELOG を更新済み
- [ ] `pbi/00-INDEX.md` を更新し、アーカイブ済み
