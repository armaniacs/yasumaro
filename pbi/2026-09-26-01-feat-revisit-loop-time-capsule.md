# PBI: 再訪とタイムカプセル（ループ課題の検出・再訪ランキング・休眠テーマ・1年前の今週）

種別: feat

## ユーザーストーリー

閲覧履歴を振り返りたいユーザーとして、
- 何か月か空けて調べ直しているテーマ
- よく再訪するページ
- 最近触れていないテーマ
- 1年前の今週に見ていたもの

を1つのパネルで見たい。同じことを調べ直す時間を減らし、散らばった記録を1枚のノートにまとめるきっかけにしたいから。

## ビジネス価値

- 自動記録はデイリーノートに日ごとに分かれて書き出される。同じテーマの記録が何日分にも散らばり、1か所にまとまらない。このパネルは「何度も調べている」テーマを検出し、過去の訪問を Markdown で一括コピーできるようにする。これで集約ノートを作る手間を1操作にする。
- 休眠テーマとタイムカプセルは、忘れかけた興味をもう一度見せる。
- 09-24 台帳で台帳送りになっていた「再訪分析」（RICE 2.13）も、このパネルで実現する。
- 既存のカラム（`url` / `title` / `domain` / `tags` / `created_at`）だけで作れる。記録経路・権限・プライバシーポリシーには手を入れない。

## 優先度

- 順位: 01 / 4
- RICEスコア: 1.60（Reach=4 / Impact=1.5 / Confidence=80% / Effort=3 SP）
- 根拠: 全ユーザーの既存データで動き、タグ OFF のユーザーにもドメインと URL の単位で価値を出せる。他の PBI に依存しない。02 が再利用する `fetchAllPeriodRows` と `NameCount` をここで作る。

## BDD受け入れシナリオ

```gherkin
Scenario: 数か月空けて再び頻繁に調べているドメインがループとして表示される
  Given example.dev の記録が 100 日前に 1 件ある
  And 31〜89 日前の記録はない
  And 直近 30 日のうち異なる 3 日に example.dev の記録がある
  When ユーザーが「再訪とタイムカプセル」パネルを開く
  Then 「何度も調べているテーマ」に種別「ドメイン」・対象「example.dev」の行が表示される
  And 直近30日の日数は 3、90日以上前の件数は 1 と表示される

Scenario: 過去の訪問を Markdown でコピーする
  Given 「何度も調べているテーマ」に example.dev の行が表示されている
  When ユーザーがその行の「Markdownでコピー」を押す
  Then 「## example.dev」と、訪問ごとに「- YYYY-MM-DD [タイトル](URL)」を並べた文字列がクリップボードに入る
  And ボタンの文言が 2 秒間「コピーしました」に変わる

Scenario: 毎日使っているドメインはループとして扱わない
  Given news.example の記録が 100 日前にも、31〜89 日前にも、直近 30 日にもある
  When ユーザーがパネルを開く
  Then 「何度も調べているテーマ」に news.example は表示されない

Scenario: 記録がないとき
  Given 直近 400 日の記録が 0 件である
  When ユーザーがパネルを開く
  Then 空状態メッセージ「記録がありません。」が表示され、エラーにならない

Scenario: 読み込みに失敗したとき
  Given SQLite が初期化されていない
  When ユーザーがパネルを開く
  Then 「再訪データの読み込みに失敗しました。」が表示される
  And SQLite が使えるようになってから開き直すと、表が表示される
```

## 受け入れ基準

- [ ] サイドバーの「データ」区分で、「ドメイン分析」の直後に「再訪とタイムカプセル」が並ぶ
- [ ] 4つの区分（何度も調べているテーマ / よく再訪するページ / 最近触れていないテーマ / 1年前の今週）が、下の「詳細設計」の判定どおりに表示される
- [ ] 区分ごとに、該当がなければ「該当なし」が表示される
- [ ] ループ行ごとに「Markdownでコピー」と「履歴で見る」がある
- [ ] Markdown では、リンク文字列の `[]()` がエスケープされ、http(s) 以外の URL は `about:blank` になる
- [ ] 取得行数が上限（50000）に達したときは、上限通知が表示される
- [ ] UTC 日の注記がパネル上部に表示される
- [ ] ja / en の全文言が i18n 経由で表示され、ハードコードされた文言がない
- [ ] 既存の `domainAnalysisPanel.lifecycle.test.ts` が無変更で通る（`fetchAllPeriodRows` への移設が退行しない）
- [ ] `npm run validate` と `npm run build` が通る

## 詳細設計

### 変更・新規ファイル一覧

| # | ファイル | 種別 | 内容 |
|---|---|---|---|
| 1 | `src/dashboard/panels/fetchPeriodRows.ts` | 変更 | `fetchAllPeriodRows` を追加する（`domainAnalysisPanel.ts` から移設） |
| 2 | `src/dashboard/panels/asyncData/domainAnalysisPanel.ts` | 変更 | ローカルの `fetchAllRows`（L257 付近）を削除し、`fetchAllPeriodRows` を呼ぶ |
| 3 | `src/utils/computeLimits.ts` | 変更 | 定数を2つ追加する |
| 4 | `src/dashboard/revisitInsightsAggregate.ts` | 新規 | 純粋な集計関数（DOM・chrome を使わない） |
| 5 | `src/dashboard/panels/asyncData/revisitInsightsPanel.ts` | 新規 | パネル |
| 6 | `src/dashboard/panels/panelCatalog.ts` | 変更 | カタログに1行追加する |
| 7 | `src/dashboard/panels/panelFactories.ts` | 変更 | import と `DIRECT_FACTORIES` に1行ずつ追加する |
| 8 | `entrypoints/options/index.html` | 変更 | サイドバーのボタンと section を追加する |
| 9 | `entrypoints/options/dashboard.css` | 変更 | `.revisit-insights-actions` を1つ追加する（それ以外は既存の `.data-table*` を使う） |
| 10 | `public/_locales/{ja,en}/messages.json` | 変更 | i18n キーを追加する |
| 11 | `src/dashboard/panels/__tests__/panelCatalog.test.ts` | 変更 | 固定 id リストに追加し、`SIDEBAR_PANELS` の長さを 24 から 25 にする |
| 12 | テスト（新規3・変更1） | — | 下の「テストケース」を参照 |
| 13 | `docs/DATA_ANALYTICS_GUIDE.md` / `README.md` / `docs/guides.html` / `CHANGELOG.md` | 変更 | ドキュメント |

### 1. `fetchAllPeriodRows`（`src/dashboard/panels/fetchPeriodRows.ts`）

`domainAnalysisPanel.ts` のローカル関数 `fetchAllRows(since, until, tagFilter)` には、次の処理が入っている。

- 取得開始時点で `until` を固定する
- keyset カーソル（`until: cursor`）で次のページへ進む
- `Map` で id の重複を除く
- 行数が上限に達したら止める
- 返ってきたページが短ければ止める

これらのロジックとコード内の WHY コメントを**そのまま**移し、引数だけをオブジェクトにする。

```ts
export interface FetchAllPeriodRowsOptions {
  since?: number | undefined;
  until?: number | undefined;
  tagFilter?: string | undefined;
  pageSize: number;
  maxRows: number;
  label: string;
}
export async function fetchAllPeriodRows(options: FetchAllPeriodRowsOptions): Promise<{ rows: BrowsingLogEntry[]; capped: boolean }>
```

`domainAnalysisPanel.ts` からの呼び出しは次のとおり。

```ts
fetchAllPeriodRows({ since, until, tagFilter, pageSize: DOMAIN_ANALYSIS_PAGE_SIZE, maxRows: MAX_DOMAIN_ANALYSIS_ROWS, label: 'domainAnalysis' })
```

`label` には、元の関数が `fetchPeriodRows` に渡していた値を使う。

### 2. 定数（`src/utils/computeLimits.ts`）

```ts
export const MAX_REVISIT_INSIGHTS_ROWS = 50000;
export const REVISIT_INSIGHTS_PAGE_SIZE = QUERY_CAPS.plain;
```

置き場所と書き方は、既存の `MAX_DOMAIN_ANALYSIS_ROWS` と `DOMAIN_ANALYSIS_PAGE_SIZE` の隣に同じ体裁で置く。`QUERY_CAPS` の import が既にあるかどうかは実装時に確認する。

### 3. 集計（`src/dashboard/revisitInsightsAggregate.ts`）

```ts
import { DAY_MS, startOfLocalDay } from './components/periodFilter.js';
import { startOfLocalWeek, nextBucketStart, formatBucketDate } from './tagFrequencyTimeline.js';
import { parseTagsForDisplay } from '../utils/tagUtils.js';
import { sanitizeForMarkdownLinkText, sanitizeUrlForMarkdownTarget } from '../utils/markdownSanitizer.js';

export const REVISIT_CONFIG = {
  fetchLookbackDays: 400,      // covers the time capsule week (364d + 7d) with margin
  recentDays: 30,
  dormantFromDays: 90,
  loopMinRecentDays: 3,
  dormantWindowStartDays: 120,
  dormantWindowEndDays: 60,
  dormantMinCount: 3,
  capsuleOffsetDays: 364,      // 52 weeks: keeps the same weekday alignment
  capsuleTopN: 10,
  topN: 20,
  visitsPerItemMax: 10,
} as const;
export type RevisitConfig = typeof REVISIT_CONFIG;

export interface NameCount { name: string; count: number }
export interface RevisitInput { id: number; url: string; title?: string | null; domain?: string | null; tags?: string | null; created_at: number }
export type RevisitKeyKind = 'url' | 'domain' | 'tag';
export interface RevisitVisit { id: number; url: string; title: string | null; created_at: number }
export interface LoopItem { kind: RevisitKeyKind; key: string; recentDays: number; pastCount: number; visits: RevisitVisit[] }
export interface RevisitRankItem { url: string; title: string | null; distinctDays: number; lastAt: number }
export interface DormantItem { kind: 'domain' | 'tag'; key: string; windowCount: number; lastAt: number }
export interface TimeCapsule { rangeStart: number; rangeEnd: number; topTags: NameCount[]; topDomains: NameCount[]; visits: RevisitVisit[] }
export interface RevisitInsights { loops: LoopItem[]; ranking: RevisitRankItem[]; dormant: DormantItem[]; capsule: TimeCapsule }

export function aggregateRevisitInsights(rows: readonly RevisitInput[], now: number, config: RevisitConfig = REVISIT_CONFIG): RevisitInsights
export function formatLoopVisitsMarkdown(item: LoopItem): string
```

`startOfLocalWeek`、`nextBucketStart`、`formatBucketDate` が `tagFrequencyTimeline.ts` から export されていない場合は、`export` を付ける。移設はしない。

#### 前処理

- 行をキーに振り分ける。1行が複数のキーに属してよい。
  - **url**: `row.url` をそのまま使う（空文字の行は対象外）。
  - **domain**: `row.domain?.trim().toLowerCase()`。空文字・null・undefined の行は対象外。
  - **tag**: `parseTagsForDisplay(row.tags)` の各要素。空配列なら対象外。
- 内部のキー文字列は `${kind}\u0000${key}` にする。こうすると種別が違えば同じ文字列でも衝突しない。
- ローカル日のキーは `dayKey(ts) = formatBucketDate(startOfLocalDay(ts))`。

#### 境界（すべて epoch ms）

- `recentStart = now - recentDays * DAY_MS`
- `dormantBoundary = now - dormantFromDays * DAY_MS`
- 直近: `created_at >= recentStart`
- 中間: `dormantBoundary <= created_at < recentStart`
- 過去: `created_at < dormantBoundary`

#### loops（何度も調べているテーマ）

キーごとに、次の3つを数える。

- `recentDays`: 直近に入る行の `dayKey` の異なり数
- `middleCount`: 中間に入る行の件数
- `pastCount`: 過去に入る行の件数

採用の条件は種別で異なる。

| 種別 | 条件 |
|---|---|
| domain / tag | `recentDays >= loopMinRecentDays && pastCount >= 1 && middleCount === 0` |
| url | `recentDays >= 1 && pastCount >= 1 && middleCount === 0` |

`middleCount === 0` の条件で、毎日使うサイトを除く（「しばらく空いてから再び」の形だけを拾う）。

並び順は次の優先度で決める。

1. `recentDays` の降順
2. `pastCount` の降順
3. `kind` の昇順（`'domain' < 'tag' < 'url'`）
4. `key` の昇順（`localeCompare` は使わず、`<` で比較する。ロケールによって順序が変わらないようにするため）

上位 `topN` 件まで残す。`visits` には、そのキーの全行を `created_at` の降順（同じなら id の降順）に並べ、先頭から `visitsPerItemMax` 件を入れる。`title` は `row.title ?? null` とする。

#### ranking（よく再訪するページ）

- 対象は url キーだけで、全期間の行を使う。
- `distinctDays` は `dayKey` の異なり数。`lastAt` は最大の `created_at`。
- `title` は `lastAt` の行の `title ?? null`。
- `distinctDays >= 2` のものだけ残す。
- 並び順は `distinctDays` の降順、`lastAt` の降順、`url` の昇順。
- 上位 `topN` 件まで残す。

#### dormant（最近触れていないテーマ）

- 対象は domain と tag キー。
- 窓は `windowStart = now - dormantWindowStartDays * DAY_MS`、`windowEnd = now - dormantWindowEndDays * DAY_MS` で、半開区間 `[windowStart, windowEnd)`。
- `windowCount` は、この窓に入る行の件数。
- 直近（`created_at >= recentStart`）の行が1件でもあれば対象外にする。
- `windowCount >= dormantMinCount` のものだけ残す。
- `lastAt` は、そのキーの全行の中で最大の `created_at`。
- 並び順は `windowCount` の降順、`kind` の昇順、`key` の昇順。
- 上位 `topN` 件まで残す。

#### capsule（1年前の今週）

- `rangeStart = startOfLocalWeek(now - capsuleOffsetDays * DAY_MS)`
- `rangeEnd = nextBucketStart(rangeStart, 'week')`
- 対象は半開区間 `[rangeStart, rangeEnd)` に入る行。
- `topTags` と `topDomains` は件数の降順、同じ件数なら名前の昇順。それぞれ上位 `capsuleTopN` 件まで。
- `visits` は `created_at` の降順で、先頭から `capsuleTopN` 件。

#### `formatLoopVisitsMarkdown(item)`

```text
## {key}

- {YYYY-MM-DD} [{linkText}]({target})
- ...
```

- 見出しの `{key}` は `sanitizeForMarkdownLinkText(item.key)`。
- 見出しと一覧の間は空行を1つ空ける。行末には改行 `\n` を付け、最終行の後にも改行を1つ付ける。
- 日付は `formatBucketDate(startOfLocalDay(v.created_at))`。
- `linkText` は `sanitizeForMarkdownLinkText(v.title || v.url)`。
- `target` は `sanitizeUrlForMarkdownTarget(v.url)`。

### 4. パネル（`src/dashboard/panels/asyncData/revisitInsightsPanel.ts`）

`createDomainAnalysisPanel()` の骨格を写す。共通の仕組みは次のとおり。

- `PanelNotices`
- `let loadSeq = 0` と `seq !== loadSeq` による古い結果の破棄
- `mount` / `load` / `destroy`

期間フィルタは**作らない**。

```ts
export function createRevisitInsightsPanel(): PanelLifecycle
// id: 'panel-revisit-insights', category: 'async-data'
```

**mount(container)**

- 下の HTML にある id の要素を `querySelector` で取得する。
- `notices.register('empty', emptyEl, { i18nKey: 'revisitInsights_empty', fallbackText: 'No records.' })`
- `notices.register('rowCap', rowCapEl, { fetchScoped: true })`

**reload()**

1. `const seq = ++loadSeq; const now = Date.now();`
2. 4つの描画先（`#revisitInsightsLoopsBody`、`#revisitInsightsRankingBody`、`#revisitInsightsDormantBody`、`#revisitInsightsCapsule`）を `innerHTML = ''` で空にする。`innerHTML` を使うのはクリアのときだけ。
3. `notices.reset()`
4. `const { rows, capped } = await fetchAllPeriodRows({ since: now - REVISIT_CONFIG.fetchLookbackDays * DAY_MS, pageSize: REVISIT_INSIGHTS_PAGE_SIZE, maxRows: MAX_REVISIT_INSIGHTS_ROWS, label: 'revisitInsights' })`
5. `if (seq !== loadSeq) return;`
6. `rows.length === 0` なら `notices.showEmpty()` を呼んで終わる。
7. `const insights = aggregateRevisitInsights(rows, now)` で集計し、4つの区分を描画する。
8. `capped` なら、`notices.setMessage('rowCap', msg('revisitInsights_rowCap', { shown: rows.length }, 'Aggregated only the newest {shown} records; older counts may be understated.'))` のあと `notices.show('rowCap')`。
9. 例外は `catch` で受ける。`console.error` を出し、古い結果の判定をしたうえで `notices.showError('revisitInsightsError', 'Failed to load revisit data.')` を呼ぶ。

**描画の規則**

- DOM はすべて `document.createElement` と `textContent` で組み立てる。
- 区分の行が0件のときは、`<tr><td colspan="列数">` に `revisitInsights_sectionEmpty` を入れる。

**loops の表**（1行の列）

1. 種別（`revisitInsights_kindUrl` / `_kindDomain` / `_kindTag`）
2. 対象（`<th scope="row">`）。url のときは、`isSecureUrl(key)` が真なら `<a href target="_blank" rel="noopener noreferrer">` を置き、偽なら `<span>` にする。
3. `recentDays`
4. `pastCount`
5. 操作。`<div class="revisit-insights-actions">` の中に2つのボタンを置く。
   - `<button type="button" class="data-table-link-btn">` に `revisitInsights_copyMarkdown` を表示する。押したら `copyTextToClipboard(formatLoopVisitsMarkdown(item))` を呼ぶ。
     - 成功したら文言を `_copied` に、失敗したら `_copyFailed` に変え、`COPY_FEEDBACK_RESET_MS` の後に元の文言へ戻す。
     - タイマー id は保持しておき、`destroy` で `clearTimeout` する。
   - 「履歴で見る」ボタン（`revisitInsights_openHistory`）。url 種別には置かない（対象セルのリンクで足りるため）。
     - domain: `tryNavigateTyped('panel-sqlite-history', { searchDomain: key })`
     - tag: `navigateToHistoryWithTag(key)`

**ranking の表**

- 列はページ、訪問日数、最終訪問の3つ。
- ページ列の表示文字列は `title || url`。url は `isSecureUrl` で判定したリンクにする。
- 最終訪問は `new Date(lastAt).toLocaleDateString()`。

**dormant の表**

- 列は種別、対象、件数（`windowCount`）、最終訪問、操作（履歴で見る）の5つ。

**capsule**

- `<p>` に `msg('revisitInsights_capsuleRange', { start, end })` を入れる。
  - `start` は `toLocaleDateString(rangeStart)`。
  - `end` は `toLocaleDateString(rangeEnd - 1)`。
- 続けて、小さな `.data-table` を2つ（タグ / ドメイン。列は名前と件数）と、訪問リストの `<ul>`（日付 ＋ リンク）を置く。
- 3つとも空なら、`revisitInsights_sectionEmpty` を1行だけ表示する。

**destroy()**

1. `loadSeq += 1`
2. 保持しているコピー文言のタイマーをすべて `clearTimeout` する。
3. 要素への参照をすべて null にする。
4. `notices.clear()`

2回呼ばれても安全であること。

import 元の一覧を示す。パスは実装時にエディタで確認する。

- `msg`: `getMessageWithSubstitutions as msg`（`src/utils/i18n.ts`）
- `copyTextToClipboard`: `src/utils/clipboard.ts`
- `COPY_FEEDBACK_RESET_MS`: `src/utils/copyMarkdownButton.ts`（export 済み）
- `isSecureUrl`: `src/utils/urlUtils.ts`
- `tryNavigateTyped`: `../registryContext.js`
- `navigateToHistoryWithTag`: `../navigateToHistory.js`
- `PanelNotices`: `../PanelNotices.js`
- `fetchAllPeriodRows`: `../fetchPeriodRows.js`

### 5. カタログと factory

`panelCatalog.ts` の `panel-domain-analysis` の行の直後に、次の1行を追加する。

```ts
{ id: 'panel-revisit-insights', sidebarSection: 'data', sidebarI18nKey: 'revisitInsightsTab', deepLinkSections: [] },
```

`panelFactories.ts` の `DIRECT_FACTORIES` に `'panel-revisit-insights': createRevisitInsightsPanel` を追加し、あわせて import を追加する。

### 6. HTML（`entrypoints/options/index.html`）

サイドバーのボタンは、`data-panel="panel-domain-analysis"` のボタンの直後に置く。

```html
<button class="sidebar-nav-btn" role="tab" aria-controls="panel-revisit-insights" aria-selected="false" data-panel="panel-revisit-insights">
  <svg class="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 3-6.7"/>
    <polyline points="3 3 3 9 9 9"/>
    <polyline points="12 7 12 12 15 14"/>
  </svg>
  <span data-i18n="revisitInsightsTab">Revisits &amp; Time Capsule</span>
</button>
```

section は、`<section id="panel-domain-analysis" ...>` の閉じタグの直後に置く。

```html
<!-- Revisit Insights Panel -->
<section id="panel-revisit-insights" class="panel" role="tabpanel" aria-labelledby="panel-revisit-insights-title">
  <h2 id="panel-revisit-insights-title" class="panel-title" data-i18n="revisitInsights_title">Revisits &amp; Time Capsule</h2>
  <p class="panel-description" data-i18n="revisitInsights_description">Compares the last 30 days with records older than 90 days to show topics you keep re-researching and topics you have not revisited lately.</p>
  <p class="data-table-notice is-muted" data-i18n="revisitInsights_utcNote">Same-day revisits are not recorded (days are split in UTC).</p>
  <div id="revisitInsightsEmptyState" data-i18n="revisitInsights_empty" hidden>No records.</div>
  <div id="revisitInsightsRowCap" class="data-table-notice is-warning" hidden></div>

  <h3 class="data-table-heading" data-i18n="revisitInsights_loopsTitle">Topics you keep re-researching</h3>
  <p class="data-table-notice is-muted" data-i18n="revisitInsights_loopsHint">Collecting these into one note saves you the next search.</p>
  <table id="revisitInsightsLoopsTable" class="data-table">
    <thead><tr>
      <th scope="col" data-i18n="revisitInsights_kindColumn">Kind</th>
      <th scope="col" data-i18n="revisitInsights_targetColumn">Target</th>
      <th scope="col" data-i18n="revisitInsights_recentDaysColumn">Days in last 30</th>
      <th scope="col" data-i18n="revisitInsights_pastCountColumn">Records 90+ days ago</th>
      <th scope="col" data-i18n="revisitInsights_actionsColumn">Actions</th>
    </tr></thead>
    <tbody id="revisitInsightsLoopsBody"></tbody>
  </table>

  <h3 class="data-table-heading" data-i18n="revisitInsights_rankingTitle">Frequently revisited pages</h3>
  <table id="revisitInsightsRankingTable" class="data-table">
    <thead><tr>
      <th scope="col" data-i18n="revisitInsights_targetColumn">Target</th>
      <th scope="col" data-i18n="revisitInsights_daysColumn">Days visited</th>
      <th scope="col" data-i18n="revisitInsights_lastVisitColumn">Last visit</th>
    </tr></thead>
    <tbody id="revisitInsightsRankingBody"></tbody>
  </table>

  <h3 class="data-table-heading" data-i18n="revisitInsights_dormantTitle">Topics you have not revisited</h3>
  <p class="data-table-notice is-muted" data-i18n="revisitInsights_dormantHint">Frequent 2–4 months ago, but no records in the last 30 days.</p>
  <table id="revisitInsightsDormantTable" class="data-table">
    <thead><tr>
      <th scope="col" data-i18n="revisitInsights_kindColumn">Kind</th>
      <th scope="col" data-i18n="revisitInsights_targetColumn">Target</th>
      <th scope="col" data-i18n="revisitInsights_countColumn">Count</th>
      <th scope="col" data-i18n="revisitInsights_lastVisitColumn">Last visit</th>
      <th scope="col" data-i18n="revisitInsights_actionsColumn">Actions</th>
    </tr></thead>
    <tbody id="revisitInsightsDormantBody"></tbody>
  </table>

  <h3 class="data-table-heading" data-i18n="revisitInsights_capsuleTitle">This week, one year ago</h3>
  <div id="revisitInsightsCapsule"></div>
</section>
```

### 7. CSS（`entrypoints/options/dashboard.css`）

`.data-table-notice` の定義ブロックの直後に追加する。

```css
.revisit-insights-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
```

### 8. i18n（`public/_locales/ja/messages.json` と `public/_locales/en/messages.json`）

- 形式は `"key": { "message": "...", "description": "..." }`。`description` は英語で書く。
- 置換変数は `{name}` の形にする（プロジェクト独自の置換方式で、Chrome の `$1` ではない）。
- 追加位置は、両ファイルとも `domainAnalysisError` の直後。

| キー | ja | en | description |
|---|---|---|---|
| `revisitInsightsTab` | 再訪とタイムカプセル | Revisits & Time Capsule | Sidebar tab for the revisit insights panel |
| `revisitInsights_title` | 再訪とタイムカプセル | Revisits & Time Capsule | Revisit insights panel title |
| `revisitInsights_description` | 直近30日と90日以上前の記録を比べ、何度も調べ直しているテーマと、しばらく触れていないテーマを示します。 | Compares the last 30 days with records older than 90 days to show topics you keep re-researching and topics you have not revisited lately. | Revisit insights panel description |
| `revisitInsights_utcNote` | 同じページの同日再訪は記録されません（日付の区切りはUTC）。 | Same-day revisits are not recorded (days are split in UTC). | Note about UTC same-day dedup |
| `revisitInsights_empty` | 記録がありません。 | No records. | Empty state |
| `revisitInsights_rowCap` | 記録が多いため新しい {shown} 件だけで集計しました。古い記録の件数は実際より少なく出ます。 | Aggregated only the newest {shown} records; older counts may be understated. | Row cap notice |
| `revisitInsights_sectionEmpty` | 該当なし | None | Empty section row |
| `revisitInsights_loopsTitle` | 何度も調べているテーマ | Topics you keep re-researching | Loop section heading |
| `revisitInsights_loopsHint` | まとめてノートにしておくと、次に調べる手間を省けます。 | Collecting these into one note saves you the next search. | Loop section hint |
| `revisitInsights_kindColumn` | 種別 | Kind | Column header |
| `revisitInsights_targetColumn` | 対象 | Target | Column header |
| `revisitInsights_recentDaysColumn` | 直近30日の日数 | Days in last 30 | Column header |
| `revisitInsights_pastCountColumn` | 90日以上前の件数 | Records 90+ days ago | Column header |
| `revisitInsights_actionsColumn` | 操作 | Actions | Column header |
| `revisitInsights_countColumn` | 件数 | Count | Column header |
| `revisitInsights_daysColumn` | 訪問日数 | Days visited | Column header |
| `revisitInsights_lastVisitColumn` | 最終訪問 | Last visit | Column header |
| `revisitInsights_kindUrl` | ページ | Page | Kind label |
| `revisitInsights_kindDomain` | ドメイン | Domain | Kind label |
| `revisitInsights_kindTag` | タグ | Tag | Kind label |
| `revisitInsights_copyMarkdown` | Markdownでコピー | Copy as Markdown | Copy button |
| `revisitInsights_copied` | コピーしました | Copied | Copy success feedback |
| `revisitInsights_copyFailed` | コピーに失敗しました | Copy failed | Copy failure feedback |
| `revisitInsights_openHistory` | 履歴で見る | View in history | Navigate to history button |
| `revisitInsights_rankingTitle` | よく再訪するページ | Frequently revisited pages | Ranking heading |
| `revisitInsights_dormantTitle` | 最近触れていないテーマ | Topics you have not revisited | Dormant heading |
| `revisitInsights_dormantHint` | 2〜4か月前によく見ていたが、直近30日は記録がありません。 | Frequent 2–4 months ago, but no records in the last 30 days. | Dormant hint |
| `revisitInsights_capsuleTitle` | 1年前の今週 | This week, one year ago | Capsule heading |
| `revisitInsights_capsuleRange` | {start} 〜 {end} | {start} – {end} | Capsule date range |
| `revisitInsightsError` | 再訪データの読み込みに失敗しました。 | Failed to load revisit data. | Load error |

### 9. ドキュメント

- **`docs/DATA_ANALYTICS_GUIDE.md`**
  - 日本語側の「### ドメイン分析 / Domain Analysis」の後に「### 再訪とタイムカプセル / Revisits & Time Capsule」を追加する。英語側は「### Domain Analysis」の後に「### Revisits & Time Capsule」を追加する。書く内容は次のとおり。
    - 4区分それぞれの判定（30日 / 90日 / 60〜120日 / 52週前の週）
    - Markdown コピー
    - 上限 50000 行
    - UTC 日の注記
  - 「共通の操作」にある既定期間の表に、「再訪とタイムカプセル: 期間フィルタなし（固定窓）」の行を追加する。英語側にも同じ行を追加する。
- **`README.md`**: 339 行付近のパネル一覧に追加する。
- **`docs/guides.html`**: 169〜172 行付近のカード文に追加する。
- **`CHANGELOG.md`**: Unreleased に `feat` として1行追加する。

## 実装手順（Outside-In TDD）

1. `main` からブランチ `feature/revisit-insights` を切る。
2. `fetchPeriodRows.test.ts` に `fetchAllPeriodRows` のテストを書く（Red）。
3. `fetchAllPeriodRows` を移設し、`domainAnalysisPanel` を置き換える（Green）。`npx vitest run src/dashboard/panels` で、既存の domain analysis のテストも通ることを確認する。
4. `revisitInsightsAggregate.test.ts` の 12 ケースを書く（Red）。
5. 集計を実装する（Green）。
6. `revisitInsightsPanel.lifecycle.test.ts` を書く（Red）。
7. パネル、カタログ、factory、HTML、CSS、i18n を実装する（Green）。
8. `panelCatalog.test.ts` を更新する。
9. ドキュメントと CHANGELOG を更新する。
10. `npm run validate` と `npm run build` を実行する。`dist/chromium-mv3` を Chrome に読み込み、パネルが表示されることを目で確認する。

## テスト戦略

### 単体: `src/dashboard/panels/asyncData/__tests__/revisitInsightsAggregate.test.ts`（node 環境）

- `now` は固定値にする（例: `new Date(2026, 8, 26, 12, 0, 0).getTime()`）。
- 行は `row({ id, url, domain, tags, daysAgo })` のようなヘルパーで作る。`created_at = now - daysAgo * DAY_MS`。

| # | ケース | 期待 |
|---|---|---|
| 1 | 空配列 | `loops` / `ranking` / `dormant` が空で、`capsule` の3配列も空 |
| 2 | ドメイン a.dev: 100日前に1件、直近の異なる3日（1・5・10日前）に1件ずつ | `loops` に `{ kind: 'domain', key: 'a.dev', recentDays: 3, pastCount: 1 }` がある |
| 3 | #2 に 60日前の1件を足す | a.dev は `loops` に入らない |
| 4 | ドメイン b.dev: 100日前に1件、直近は同じ日に3件 | domain の b.dev は入らない（`recentDays = 1`） |
| 5 | URL u1: 100日前に1件、直近に1件 | `loops` に `{ kind: 'url', key: u1 }` がある |
| 6 | 境界: `created_at === recentStart` と `created_at === dormantBoundary` | 前者は直近、後者は中間に数えられ、そのキーはループにならない |
| 7 | domain が null・空文字・空白だけの行 | domain キーに入らない。url キーには入る |
| 8 | `tags: '#a #b'` と `tags: null` | タグ a と b がそれぞれキーになる。null の行はタグキーに入らない |
| 9 | ランキング: 異なり日数3・2・1の URL と、25件の2日 URL | 日数1は除外され、降順に並び、`topN = 20` 件で切られる |
| 10 | 休眠: ドメイン c.dev が 70・80・90日前に1件ずつ、直近0件 | `dormant` に `windowCount: 3` で入る。直近に1件足すと入らない |
| 11 | タイムカプセル: 364日前の週の内側・外側に行を置く | 内側の行だけが `visits` と `topDomains` に入る。`rangeStart` はローカルの日曜 0:00 |
| 12 | `formatLoopVisitsMarkdown`: title `a[b](c)`、url `javascript:alert(1)` | リンク文字列の `[]()` がエスケープされ、target が `about:blank` になる。1行目が `## {key}` |

### 統合: `src/dashboard/panels/__tests__/fetchPeriodRows.test.ts`（追記）

- `queryLogs` をモックしてページを返させる。
  - 1ページ目は `pageSize` 件、2ページ目は `pageSize - 1` 件にする → 2回呼んで止まる。
- ページ境界に同じ `id` を置く → 重複せずに数えられる。
- 合計が `maxRows` を超える → `capped: true`、`rows.length === maxRows`。
- 2回目以降の呼び出しの `until` が、前のページの最後の `created_at` になっている。

### 統合: `src/dashboard/panels/asyncData/__tests__/revisitInsightsPanel.lifecycle.test.ts`（jsdom）

- 冒頭に `// @vitest-environment jsdom` を書く。
- `domainAnalysisPanel.lifecycle.test.ts` のモック構成（`dashboardSqliteService.js`、`utils/retry.js`、`registryContext.js`）をそのまま写す。
- `mountPanel()` は、上の section HTML を container に入れる。

ケース:

1. id と category が正しい。
2. `mount` の前に `load` を呼んでも例外にならない。
3. ループ・ランキング・休眠・タイムカプセルの行が描画される。
4. 0件のとき、空状態が表示される。
5. SQLite が未初期化のときはエラー表示になり、初期化後に `load` し直すと表が表示される。
6. コピーボタンを押すと `navigator.clipboard.writeText` が Markdown 文字列で呼ばれ、文言が `Copied` に変わる（`vi.useFakeTimers` で 2000ms 進めると元に戻る）。
7. domain 行の「履歴で見る」を押すと、`tryNavigateTyped` が `('panel-sqlite-history', { searchDomain })` で呼ばれる。
8. `destroy()` を2回呼んでも安全。

### 回帰

- `panelCatalog.test.ts` の固定 id リストと件数（25）。
- `scripts/__tests__/localeParity.test.ts` が通ること（ja / en のキーが対称）。

### E2E

分析パネルの E2E は、今のところ1本もない。今回も追加しない。jsdom の lifecycle テストで BDD シナリオを自動化する。

## 落とし穴（実装者向け）

- import は `.js` 拡張子で書く（`.ts` のソースを指す場合も同じ）。
- `any` と `unknown` を使わない。テストの中だけは例外として許容する。
- 数値や日数は `REVISIT_CONFIG` と `computeLimits.ts` の定数から参照し、コードに直接書かない。
- `panelCatalog.test.ts` は、サイドバーのボタンの順序がカタログの順序と一致することを検証する。HTML とカタログの両方で、同じ位置（ドメイン分析の直後）に入れる。
- ja と en のキーが揃っていないと、`localeParity` のテストが失敗する。
- `msg(...)` や `showError('key')` の形で使うキーは、`check-i18n` が存在を検査しない。キー名の打ち間違いは自分で確認する。
- `innerHTML` は要素のクリアにだけ使う。値を差し込むときは `textContent` を使う。

## 見積もり

3 SP（`fetchAllPeriodRows` の移設 0.5 ＋ 集計 1 ＋ パネル・HTML・i18n 1 ＋ ドキュメント・テスト仕上げ 0.5）

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run validate` と `npm run build` が通る
- [ ] コードレビュー完了
- [ ] `docs/DATA_ANALYTICS_GUIDE.md`（ja / en）・README・guides.html・CHANGELOG を更新済み
- [ ] `pbi/00-INDEX.md` を更新し、この PBI を `dev-docs/archived/pbi/` へ移動済み
