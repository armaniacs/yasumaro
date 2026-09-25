# PBI: リサーチ・セッション（間隔で区切った「ひとつの調べもの」単位の一覧）

種別: feat

## ユーザーストーリー

調べものの過程を振り返りたいユーザーとして、時刻の近い記録を「ひとつの調べもの（セッション）」にまとめた一覧で見たい。ページ単位の集計では見えない「この日、何をどの順で調べていたか」が分かれば、同じ調査をするときの近道になるから。

## ビジネス価値

- 既存の分析パネルは点（ページ・ドメイン・タグ）の集計だけで、線（ひと続きの調べもの）は見えなかった。このパネルは記録を時系列でまとめ、テーマと範囲をセッション単位で示す。
- 既存カラムだけで作れる。記録経路・権限・プライバシーポリシーには手を入れない。
- 03（遷移記録）と 04（探索パス・検索→解決指標）の表示先になる。

## 優先度

- 順位: 02 / 4
- RICEスコア: 0.75（Reach=3 / Impact=1 / Confidence=50% / Effort=2 SP）
- 根拠:
  - Confidence を 50% にした理由: 記録はゲート（5秒以上かつスクロール50%以上）を通ったページだけで、同日の再訪はスキップされる。そのため記録の間隔が疎で、セッションの切れ方がどれだけ役立つかは実データで確かめていない。
  - 03 と 04 の表示先でもあるため、提案2の一連の作業の中では最初に着手する。

## BDD受け入れシナリオ

```gherkin
Scenario: 近い時刻の記録がひとつのセッションにまとまる
  Given 今日 10:00・10:20・10:45 に記録があり、次の記録は 12:00 である
  And セッション間隔は既定の 30 分である
  When ユーザーが「リサーチ・セッション」パネルを開く
  Then 10:00〜10:45 の 3 件がひとつのセッション「3ページ・45分」として表示される
  And 12:00 の 1 件はセッションとして表示されず、「単独ページ 1 件」に数えられる

Scenario: セッション間隔を変えると再取得せずにまとめ直す
  Given パネルに今日の記録が表示されている
  When ユーザーがセッション間隔を 15 分に変える
  Then 10:20 と 10:45 の間（25分）でセッションが分かれる
  And 記録の再取得は行われない

Scenario: 期間を変えると取り直す
  Given パネルが既定の「過去7日間」で表示されている
  When ユーザーが「過去30日間」を選ぶ
  Then 過去30日の記録を取り直してセッションが表示される

Scenario: セッションがないとき
  Given 選んだ期間の記録がすべて 30 分以上離れている
  When ユーザーがパネルを開く
  Then セッション一覧は空で、「0 件のセッション・単独ページ N 件」と表示される

Scenario: 読み込みに失敗したとき
  Given SQLite が初期化されていない
  When ユーザーがパネルを開く
  Then 「セッションの読み込みに失敗しました。」が表示される
```

## 受け入れ基準

- [x] サイドバーの「データ」区分で、「再訪とタイムカプセル」の直後に「リサーチ・セッション」が並ぶ
- [x] 期間フィルタは既定が「過去7日間」で、ボタンを押すとすぐ取り直す（自動適用）
- [x] セッション間隔は 5 / 15 / 30 / 60 分から選べ、既定は 30 分。変えても再取得しない
- [x] 間隔がちょうど設定値のときは同じセッションになり、1ms でも超えれば分かれる
- [x] 記録が 2 件以上のセッションだけを新しい順に表示し、1 件だけのものは「単独ページ」の件数に数える
- [x] 表示は最大 100 セッションまで。超えたら「新しい 100 件のセッションを表示」と通知する
- [x] 各セッションは `<details>` で折りたたみ、次を表示する
  - 見出し: 開始日時・ページ数・分数・上位タグ（タグがなければ上位ドメイン）
  - 展開部: 時刻・タイトルのリンク・ドメイン・スターの有無
- [x] 分数は最初と最後の記録の間隔で、実際の閲覧時間とは異なる。そのことを説明文に書く
- [x] 取得行数が上限（10000）に達したら、上限通知を出す
- [x] ja / en の全文言を i18n 経由で表示する
- [x] `npm run validate` と `npm run build` が通る

## 詳細設計

### 前提

01（`2026-09-26-01-feat-revisit-loop-time-capsule.md`）で `NameCount` 型が `src/dashboard/revisitInsightsAggregate.ts` から export される。01 より先に着手する場合は、`NameCount` の定義をこの PBI の集計ファイルに置き、01 でそちらから import するように変える。

### 変更・新規ファイル一覧

| # | ファイル | 種別 | 内容 |
|---|---|---|---|
| 1 | `src/utils/computeLimits.ts` | 変更 | `MAX_RESEARCH_SESSION_ROWS` を追加 |
| 2 | `src/dashboard/researchSessionAggregate.ts` | 新規 | 純粋な集計関数 |
| 3 | `src/dashboard/panels/asyncData/researchSessionsPanel.ts` | 新規 | パネル |
| 4 | `src/dashboard/panels/panelCatalog.ts` / `panelFactories.ts` | 変更 | 登録 |
| 5 | `entrypoints/options/index.html` | 変更 | サイドバーのボタンと section |
| 6 | `entrypoints/options/dashboard.css` | 変更 | `.research-sessions-*` を追加 |
| 7 | `public/_locales/{ja,en}/messages.json` | 変更 | i18n |
| 8 | `src/dashboard/panels/__tests__/panelCatalog.test.ts` | 変更 | 固定 id リストと件数（01 の後なら 25 から 26） |
| 9 | テスト（新規 2） | — | 下の「テスト戦略」を参照 |
| 10 | `docs/DATA_ANALYTICS_GUIDE.md` / `README.md` / `docs/guides.html` / `CHANGELOG.md` | 変更 | ドキュメント |

### 1. 定数（`src/utils/computeLimits.ts`）

```ts
export const MAX_RESEARCH_SESSION_ROWS = QUERY_CAPS.plain;
```

置き場所は `MAX_TIME_HEATMAP_ROWS` の隣。1回の `fetchPeriodRows` で取れる上限をそのまま使う。

### 2. 集計（`src/dashboard/researchSessionAggregate.ts`）

```ts
import { parseTagsForDisplay } from '../utils/tagUtils.js';
import type { NameCount } from './revisitInsightsAggregate.js';

export const SESSION_GAP_OPTIONS_MIN = [5, 15, 30, 60] as const;
export type SessionGapMinutes = (typeof SESSION_GAP_OPTIONS_MIN)[number];
export const DEFAULT_SESSION_GAP_MIN: SessionGapMinutes = 30;
export const MIN_SESSION_RECORDS = 2;
export const MAX_DISPLAY_SESSIONS = 100;
export const SESSION_TOP_TAGS = 5;
export const SESSION_TOP_DOMAINS = 3;
const MINUTE_MS = 60_000;

export interface SessionInput {
  id: number;
  url: string;
  title?: string | null;
  domain?: string | null;
  tags?: string | null;
  created_at: number;
  is_starred?: number | null;
  // Populated once the navigation trail columns exist (PBI 2026-09-26-03).
  nav_source_url?: string | null;
  search_query?: string | null;
}
export interface ResearchSession {
  startAt: number;
  endAt: number;
  durationMs: number;
  records: SessionInput[];      // ascending by created_at, then id
  topTags: NameCount[];
  topDomains: NameCount[];
  starredCount: number;
}
export interface SessionAggregate {
  sessions: ResearchSession[];  // newest first, only records.length >= MIN_SESSION_RECORDS
  singleCount: number;          // sessions with fewer than MIN_SESSION_RECORDS records
  totalSessions: number;        // multi-record sessions before truncation
  truncated: boolean;
}

export function groupResearchSessions(rows: readonly SessionInput[], gapMinutes: number): SessionAggregate
export function sessionDurationMinutes(durationMs: number): number   // Math.max(1, Math.round(durationMs / MINUTE_MS))
```

#### アルゴリズム

1. `rows` をコピーしてから並べ替える（引数は書き換えない）。キーは `created_at` の昇順、同じなら `id` の昇順。
2. `gapMs = gapMinutes * MINUTE_MS` とする。
3. 先頭から順に見る。現在のセッションが空か、`row.created_at - 直前の行の created_at > gapMs` のとき、新しいセッションを始める。差が `gapMs` と**等しい**ときは同じセッションに入れる。
4. 閉じた各セッションについて次を計算する。
   - `startAt = records[0].created_at`
   - `endAt = records[last].created_at`
   - `durationMs = endAt - startAt`
   - `starredCount`: `is_starred === 1` の件数
   - `topTags`: 全記録の `parseTagsForDisplay(tags)` を数え、件数の降順・同数なら名前の昇順（`<` で比較）で並べ、上位 `SESSION_TOP_TAGS` 件
   - `topDomains`: `domain?.trim().toLowerCase()`（空は除外）を、`topTags` と同じ規則で数え、上位 `SESSION_TOP_DOMAINS` 件
5. `records.length < MIN_SESSION_RECORDS` のセッションは、`singleCount` に 1 を足して結果から外す。
6. 残りを `startAt` の降順（同じなら先頭記録の `id` の降順）に並べ、`totalSessions` にその件数を入れる。
7. 先頭から `MAX_DISPLAY_SESSIONS` 件だけ残す。`totalSessions > MAX_DISPLAY_SESSIONS` なら `truncated = true` にする。

### 3. パネル（`src/dashboard/panels/asyncData/researchSessionsPanel.ts`）

骨格は `timeHeatmapPanel.ts`（期間フィルタの自動適用方式）に合わせる。

```ts
export function createResearchSessionsPanel(): PanelLifecycle
// id: 'panel-research-sessions', category: 'async-data'
```

- **状態**: `loadSeq`、`filterHandle`、`lastRows: SessionInput[] | null`、`gapMinutes: number = DEFAULT_SESSION_GAP_MIN`、`notices = new PanelNotices()`
- **mount(container)**
  1. 下の HTML の id を取得する。
  2. `filterHandle = createPeriodFilter({ initialPreset: 'last7', onChange: () => { void reload(); } })` を作り、`#researchSessionsFilter` に `appendChild` する。
  3. `#researchSessionsGap` の `<select>` に `SESSION_GAP_OPTIONS_MIN` から option を作る。
     - `value = String(n)`
     - `textContent = msg('researchSessions_gapOption', { n }, '{n} min')`
     - 初期値は `DEFAULT_SESSION_GAP_MIN`
  4. `change` イベントでは `gapMinutes = Number(select.value)` にしてから `render()` を呼ぶ（再取得しない）。
  5. notices を登録する。
     - `'empty'`: `{ i18nKey: 'researchSessions_empty', fallbackText: 'No records in this period.' }`
     - `'rowCap'` / `'truncated'`: `{ fetchScoped: true }`
- **reload()**
  1. `const seq = ++loadSeq`
  2. `const range = filterHandle ? filterHandle.getRange() : presetToRange('last7', Date.now())`
  3. `notices.reset()`
  4. `const res = await fetchPeriodRows({ ...range, limit: MAX_RESEARCH_SESSION_ROWS, label: 'researchSessions' })`
  5. `if (seq !== loadSeq) return;`
  6. `lastRows = res.rows`
  7. `res.capped` なら `rowCap` に `msg('researchSessions_rowCap', { shown: res.rows.length }, ...)` を入れて表示する。
  8. `lastRows.length === 0` なら一覧を空にし、`notices.showEmpty()` を呼んで終える。
  9. そうでなければ `render()` を呼ぶ。
  10. 例外が出たら、`console.error` と古い結果の判定をしてから `notices.showError('researchSessionsError', 'Failed to load sessions.')` を呼ぶ。
- **render()**
  1. `lastRows` が null なら何もしない。
  2. `notices.resetForReaggregate()`
  3. `const agg = groupResearchSessions(lastRows, gapMinutes)`
  4. 要約: `#researchSessionsSummary.textContent = msg('researchSessions_summary', { sessions: agg.totalSessions, singles: agg.singleCount }, ...)`
  5. `agg.truncated` なら、`'truncated'` に `msg('researchSessions_truncated', { shown: MAX_DISPLAY_SESSIONS }, ...)` を入れて表示する。
  6. `#researchSessionsList` を空にする（`innerHTML = ''`。クリア専用）。
  7. 各セッションについて `renderSession(session)` を呼び、返ってきた `<li>` を追加する。
- **renderSession(session): HTMLLIElement**
  - 構造: `<li class="research-sessions-item"><details><summary>…</summary><ol class="research-sessions-records">…</ol></details></li>`
  - summary の文字列は、次の各部分を `' · '` でつなぐ。
    1. `new Date(startAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })`
    2. `msg('researchSessions_pages', { n: records.length }, '{n} pages')`
    3. `msg('researchSessions_minutes', { n: sessionDurationMinutes(durationMs) }, '{n} min')`
    4. `topTags` の `name` を `', '` でつないだもの（空なら `topDomains` の `name`、それも空なら省略）
  - 記録ごとに `renderRecord(record)` を呼んで `<li>` を作る。
- **renderRecord(record): HTMLLIElement**（03 の最小表示と 04 のツリー表示でも使い回すため、関数に分けておく）
  - `<li>` の中に、次の要素を順に置く。
    1. `<time>`: `new Date(created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })`
    2. タイトル: `isSecureUrl(url)` が真なら `<a href={url} target="_blank" rel="noopener noreferrer">`、偽なら `<span>`。文字列は `title || url`。
    3. ドメイン: `<span class="research-sessions-domain">`
    4. `is_starred === 1` なら `<span class="research-sessions-starred">` に `msg('researchSessions_starred', {}, 'Starred')` を入れる。
  - 値はすべて `textContent` で入れる。
- **destroy()**: `loadSeq += 1`、`filterHandle?.destroy()`、`lastRows = null`、参照を null にする、`notices.clear()`。2回呼んでも安全であること。

import 元の一覧:

| 名前 | import 元 |
|---|---|
| `createPeriodFilter`、`presetToRange` | `../../components/periodFilter.js` |
| `fetchPeriodRows` | `../fetchPeriodRows.js` |
| `PanelNotices` | `../PanelNotices.js` |
| `msg`（`getMessageWithSubstitutions` の別名） | `../../../utils/i18n.js` |
| `isSecureUrl` | `../../../utils/urlUtils.js` |
| `MAX_RESEARCH_SESSION_ROWS` | `../../../utils/computeLimits.js` |

相対パスは、実際のファイル位置から数えて確認すること。

### 4. カタログと factory

`panel-revisit-insights` の行の直後に次の1行を加える（01 が未着手なら `panel-domain-analysis` の直後）。

```ts
{ id: 'panel-research-sessions', sidebarSection: 'data', sidebarI18nKey: 'researchSessionsTab', deepLinkSections: [] },
```

`DIRECT_FACTORIES` に `'panel-research-sessions': createResearchSessionsPanel` を加え、import も追加する。

### 5. HTML（`entrypoints/options/index.html`）

サイドバーのボタンは、`panel-revisit-insights` のボタンの直後に置く。

```html
<button class="sidebar-nav-btn" role="tab" aria-controls="panel-research-sessions" aria-selected="false" data-panel="panel-research-sessions">
  <svg class="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <circle cx="5" cy="6" r="2"/>
    <circle cx="12" cy="12" r="2"/>
    <circle cx="19" cy="18" r="2"/>
    <path d="M6.5 7.5l4 3M13.5 13.5l4 3"/>
  </svg>
  <span data-i18n="researchSessionsTab">Research Sessions</span>
</button>
```

section は、`panel-revisit-insights` の section の直後に置く。

```html
<!-- Research Sessions Panel -->
<section id="panel-research-sessions" class="panel" role="tabpanel" aria-labelledby="panel-research-sessions-title">
  <h2 id="panel-research-sessions-title" class="panel-title" data-i18n="researchSessions_title">Research Sessions</h2>
  <p class="panel-description" data-i18n="researchSessions_description">Groups pages recorded within the selected gap of each other into one research session. The duration is the time between the first and last record, not actual reading time.</p>
  <div id="researchSessionsFilter"></div>
  <div class="form-group">
    <label for="researchSessionsGap" data-i18n="researchSessions_gapLabel">Session gap</label>
    <select id="researchSessionsGap"></select>
  </div>
  <div id="researchSessionsEmptyState" data-i18n="researchSessions_empty" hidden>No records in this period.</div>
  <div id="researchSessionsRowCap" class="data-table-notice is-warning" hidden></div>
  <p id="researchSessionsSummary" aria-live="polite"></p>
  <div id="researchSessionsTruncated" class="data-table-notice is-warning" hidden></div>
  <ol id="researchSessionsList" class="research-sessions-list"></ol>
</section>
```

### 6. CSS（`entrypoints/options/dashboard.css`）

`.revisit-insights-actions` の直後（01 が未着手なら `.data-table-notice` の後）に追加する。

```css
.research-sessions-list,
.research-sessions-records {
  list-style: none;
  margin: 0;
  padding: 0;
}
.research-sessions-item {
  border-bottom: 1px solid var(--ym-color-border, #e2e8f0);
  padding: var(--ym-space-2, 8px) 0;
}
.research-sessions-item summary {
  cursor: pointer;
}
.research-sessions-records li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ym-space-2, 8px);
  padding: var(--ym-space-1, 4px) 0 var(--ym-space-1, 4px) var(--ym-space-3, 12px);
}
.research-sessions-domain,
.research-sessions-starred {
  color: var(--ym-color-sumi-muted, #7a7060);
}
```

トークンは `.data-table*`（`dashboard.css` 4952〜5011 行付近）と同じものを使う。フォールバック値も同じにする。

### 7. i18n（ja / en）

追加位置は `revisitInsightsError` の直後（01 が未着手なら `domainAnalysisError` の直後）。`description` は英語で書く。

| キー | ja | en |
|---|---|---|
| `researchSessionsTab` | リサーチ・セッション | Research Sessions |
| `researchSessions_title` | リサーチ・セッション | Research Sessions |
| `researchSessions_description` | 記録どうしの間隔が選択した時間以内のページを、ひとつの調べものとしてまとめます。時間は最初と最後の記録の間隔で、実際の閲覧時間とは異なります。 | Groups pages recorded within the selected gap of each other into one research session. The duration is the time between the first and last record, not actual reading time. |
| `researchSessions_gapLabel` | セッションの区切り | Session gap |
| `researchSessions_gapOption` | {n}分 | {n} min |
| `researchSessions_summary` | {sessions} 件のセッション・単独ページ {singles} 件 | {sessions} sessions · {singles} single pages |
| `researchSessions_pages` | {n}ページ | {n} pages |
| `researchSessions_minutes` | {n}分 | {n} min |
| `researchSessions_starred` | スター付き | Starred |
| `researchSessions_truncated` | 新しい {shown} 件のセッションを表示しています。 | Showing the newest {shown} sessions. |
| `researchSessions_rowCap` | 記録が多いため新しい {shown} 件だけでまとめました。期間を短くすると全件を対象にできます。 | Grouped only the newest {shown} records. Shorten the period to include all records. |
| `researchSessions_empty` | この期間の記録がありません。 | No records in this period. |
| `researchSessionsError` | セッションの読み込みに失敗しました。 | Failed to load sessions. |

### 8. ドキュメント

- `docs/DATA_ANALYTICS_GUIDE.md`（ja / en）: 「再訪とタイムカプセル」の後に「リサーチ・セッション / Research Sessions」の節を追加する。書く内容は次のとおり。
  - 区切りの規則（ちょうど等しい間隔は同じセッション）
  - 単独ページの扱い
  - 分数の意味
  - 最大 100 件
  - 上限 10000 行
- 既定期間の表に「リサーチ・セッション: 過去7日間」を追加する。
- README の 339 行付近と `docs/guides.html` の 169〜172 行付近にあるパネル列挙に加える。
- CHANGELOG の Unreleased に追記する。

## 実装手順（Outside-In TDD）

1. main からブランチ `feature/research-sessions` を切る。
2. `researchSessionAggregate.test.ts` を書く（Red）。
3. 集計を実装する（Green）。
4. `researchSessionsPanel.lifecycle.test.ts` を書く（Red）。
5. パネル、カタログ、factory、HTML、CSS、i18n を実装する（Green）。
6. `panelCatalog.test.ts` を更新する。
7. ドキュメントと CHANGELOG を更新する。
8. `npm run validate` と `npm run build` を実行し、Chrome に読み込んで目視で確認する。

## テスト戦略

### 単体: `src/dashboard/panels/asyncData/__tests__/researchSessionAggregate.test.ts`（node 環境）

`row(id, minutesFromBase, extra?)` のようなヘルパーで行を作る。`created_at = base + minutes * 60000`。

| # | ケース | 期待 |
|---|---|---|
| 1 | 空配列 | `sessions: []`、`singleCount: 0`、`totalSessions: 0`、`truncated: false` |
| 2 | 0・30分（gap 30） | 1 セッション、2 件（等しい間隔は同じセッション） |
| 3 | 0・30分＋1ms（gap 30） | 分割される。2 件とも単独になり `singleCount: 2` |
| 4 | 入力の順序が逆 | 昇順に並べ直した結果と同じ |
| 5 | 0・10・20・200分 | セッション 1 件（3 件）と `singleCount: 1` |
| 6 | 101 セッション（2 件ずつ、間隔 2 時間） | `sessions.length === 100`、`totalSessions === 101`、`truncated: true`。先頭は最新のセッション |
| 7 | タグ `#b` 2件・`#a` 2件・`#c` 1件 | `topTags` は `[{a,2},{b,2},{c,1}]`（同数は名前の昇順） |
| 8 | 同じデータを gap 5 と gap 60 で集計 | セッション数が変わる |
| 9 | `is_starred: 1` を 2 件含む | `starredCount: 2` |
| 10 | `sessionDurationMinutes(0)` と `sessionDurationMinutes(89_000)` | `1` と `1`。`sessionDurationMinutes(91_000)` は `2` |

### 統合: `src/dashboard/panels/asyncData/__tests__/researchSessionsPanel.lifecycle.test.ts`（jsdom）

`timeHeatmapPanel.lifecycle.test.ts` のモック構成を写す。

1. id が `'panel-research-sessions'`、category が `'async-data'` である。
2. `mount` の前に `load` を呼んでも安全である。
3. 初回の `load` で、`queryLogs` が `since`（7 日前）と `limit: 10000` を付けて呼ばれる。
4. セッションが `<details>` として描画され、要約の文言が出る。
5. `#researchSessionsGap` を `'5'` に変えて `change` を発火させても、`queryLogs` の呼び出し回数は増えない。一方でセッション数は変わる。
6. `button[data-preset="last30"]` をクリックすると、`queryLogs` がもう一度呼ばれる。
7. 0 件のときは空状態が表示される。
8. SQLite が未初期化ならエラー表示になる。
9. `destroy()` を 2 回呼んでも安全である。

### 回帰

- `panelCatalog.test.ts`
- `localeParity.test.ts`

### E2E

追加しない（分析パネルの E2E は既存に無く、jsdom のテストで BDD を自動化する）。

## 落とし穴（実装者向け）

- 分割の判定は「`>` で超えたら分割」。`>=` にすると、テスト #2 が失敗する。
- 間隔を変えるときは `render()` だけを呼び、`reload()` は呼ばない（テスト #5）。
- `renderRecord` は独立した関数にしておく。03 と 04 がこれを拡張する。
- import は `.js` 拡張子を付ける。`any` と `unknown` は使わない。定数は直接書かない。`innerHTML` は要素の中身を消すときだけ使う。

## 見積もり

2 SP

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `npm run validate` と `npm run build` が通る
- [ ] コードレビュー完了（未実施 — ユーザー作業）
- [x] ドキュメント更新済み（ガイド ja / en、README、guides.html、CHANGELOG）
- [x] `pbi/00-INDEX.md` を更新し、アーカイブ済み
