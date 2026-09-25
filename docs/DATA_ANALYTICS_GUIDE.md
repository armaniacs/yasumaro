# データ分析ガイド / Data Analytics Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

ダッシュボードの「データ」セクションには、記録した閲覧履歴をダッシュボード上で分析するパネルが揃っています。曜日×時間帯のヒートマップ、ドメイン/URL の件数集計、タグの期間推移、タグ共起ペア表、キーワードクラスタ、前後半のタグクラスタ比較、SQLite の直接検索など、履歴データを複数の視点から振り返れます。

すべての計算はブラウザ内のローカル SQLite（OPFS + FTS5）に対して行われ、履歴データが外部に送信されることはありません。分析に使えるのは、記録済みの履歴（タグ・ドメイン・作成日時を含む）だけです。分析パネル群の初版の詳細は [CHANGELOG.md](../CHANGELOG.md) の [6.9.22] を参照してください。

### 共通の操作（期間フィルタ）

多くの分析パネルには、共有の期間フィルタが付いています。ボタンには下表の文言がそのまま表示されます。

| プリセット | 対象期間 |
|------|------|
| **今日** | 本日 0 時以降 |
| **過去7日間** | 過去 7 日間 |
| **過去30日間** | 過去 30 日間 |
| **過去90日間** | 過去 90 日間 |
| **全期間** | 記録されている全件 |
| **カスタム** | 日付を手動指定 |

期間を変更すると選択中のパネルが再集計されます。初期値はパネルごとに異なります。

| パネル | 既定の期間 |
|------|------|
| タグクラスタ / ワードクラスタ | 過去7日間 |
| 曜日×時間帯ヒートマップ | 過去90日間 |
| ドメイン分析 / タグ推移 | 過去30日間 |
| タグ共起ペア | 全期間 |
| 再訪とタイムカプセル | 期間フィルタなし（固定窓） |
| リサーチ・セッション | 過去7日間 |

### 時間帯ヒートマップ / Time Heatmap

曜日（7）×時間帯（24）のマスに記録数を色の濃さで表示します。自分の閲覧習慣（どの曜日・どの時間帯に記録が集中しているか）を一目で把握できます。

- 表示は最大 10,000 件の履歴を対象に集計します

### ドメイン分析 / Domain Analysis

タグ（任意）と期間を指定して、ドメイン別の集計 top 20 と URL 別の集計 top 20 を件数順の表で表示します。「#トラベル タグの記録はどのサイトで見ているか」のような質問に直接答えます。

- 対象は最大 50,000 件の履歴です

### 再訪とタイムカプセル / Revisits & Time Capsule

自動記録はデイリーノートへ日ごとに分かれて書き出されるため、同じテーマの訪問が複数日に散らばります。このパネルは「また調べ直しているもの」を 4 つの区分で示し、散らばった訪問を 1 枚のノートにまとめる手掛かりを作ります。

- **何度も調べているテーマ**: 31〜89 日のあいだ記録がなく、直近 30 日に戻ってきたドメイン・タグ・ページ。同じテーマを「しばらく空いてから調べ直す」形だけを拾うので、毎日使っているサイトは対象になりません
- **よく再訪するページ**: 訪れた日付が 2 日以上ある URL の上位
- **最近触れていないテーマ**: 60〜120 日前は複数回記録されているが、直近 30 日の記録がないドメイン・タグ
- **1 年前の今週**: 52 週前の同じ週（曜日をそろえた範囲）に記録されていた内容

「Markdownでコピー」を押すと、そのテーマの訪問一覧が `## ドメイン名` と `- YYYY-MM-DD [タイトル](URL)` の形でクリップボードに入ります。日付はローカル日基準です。

- 対象は固定 400 日間で、期間フィルタはありません
- 記録側は UTC 日で同日再訪を弾くため、表示側のローカル日集計とずれることがあります。パネル上部の注記を参照してください
- 集計は最大 50,000 件で打ち切られます。上限に達すると通知が表示され、古い件数が実際より少なく出ます

### リサーチ・セッション / Research Sessions

記録どうしの間隔が一定時間以内のものを、ひとつの「調べもの」としてまとめます。ページ単位の集計では見えない「この日、何をどの順で調べていたか」を、時刻の近い記録の連なりとして示します。

- セッションの区切りは 5 / 15 / 30 / 60 分から選べます（既定は 30 分）。区切りを変えても再取得はせず、手元の記録をまとめ直します
- 間隔がちょうど設定値と同じ場合は同じセッションです。1ms でも超えると分かれます
- 記録が 2 件以上のセッションだけを新しい順に表示し、1 件だけのものは件数として「単独ページ」に数えます
- 節には開始日時・ページ数・分数・上位タグ（タグがなければ上位ドメイン）が並びます。時間は最初と最後の記録の間隔であり、実際の閲覧時間ではありません
- 既定の期間は「過去7日間」で、期間ボタンを押すとすぐ取り直します
- 対象は最大 10,000 件、表示は最大 100 セッションです。上限に達すると通知が表示されます

#### 遷移記録（セッションの「検索」「流入元」）

リサーチ・セッションの各行に「検索: …」「流入元: …」を出すために使う、任意の機能です。記録経路そのものは変更しません。ダッシュボードの Privacy タブで確認ダイアログに同意したときだけ有効になり、既定は無効です。

- 同じタブで直前に開いていたページのURLを、フラグメント（`#` 以降）を除いて記録します
- 流入元が検索エンジン（Google・Bing・DuckDuckGo・Yahoo! Japan・Yahoo!・Brave・Ecosia）なら、検索語も記録します（PII マスク済み・最大200文字）
- 流入元がドメイン除外リストに一致する場合は、URL全体ではなくオリジンのみ記録します
- AI への送信内容・Obsidian の Markdown・エクスポートには含まれません
- プライバシー同意そのものを撤回すると、本機能は自動的に無効になります

#### 探索パスと「迷いやすいトピック」

遷移記録が有効なとき、セッションの展開部は平坦な一覧ではなく**経路**として表示されます。どのページからどのページへ移ったかを復元し、冒頭の検索語をその上に1行だけ出します。

- 親の判定は「同じセッション内で自分より前にあり、流入元が自分の URL と一致する記録のうち最も新しいもの」。同じ URL を再訪した場合は最初の訪問ではなく直近の訪問が親になります
- 記録は必ず前の記録より後にしか親になれないため、循環は起きません
- 遷移記録がオフのセッションは、従来と同じ平坦な一覧で表示されます

さらに「迷子になりやすいトピック」の表を出す。検索エンジンから始まったセッションを、**最後に見たページのタグ**ごとに集計し、セッション数・平均ページ数・平均分を示します。

- 1セッションだけのタグは「偶然の足取り」にすぎないので、2セッション以上のタグだけを表示します
- 最後のページにタグがない場合は「(タグなし)」として集計します。表から消さない
- 集計対象は画面に表示しているセッション（最大100件）と同じ範囲です。切り詰められている場合は上部の通知と同じ範囲になります
- 最後のページを「到達点」とみなすのは推測です。セッションという一連続した活動の終点、という意味であり、利用者が理解したかを測ったものではありません

### タグクラスタ / Tag Cluster

タグ同士の共起関係をグラフで可視化します。詳細は [タグの関連グラフ表示ガイド](TAG_CLUSTER_GUIDE.md) を参照してください。

- 出現回数の多い上位 50 タグが対象（1 レコード最大 50 タグ、履歴は最大 10,000 件）
- 既定の期間は「過去7日間」です

### タグ推移 / Tag Timeline

期間内で出現数の多い上位タグ（既定 10 件）について、週次/月次の記録数推移を積み上げ折れ線グラフで表示します。タグごとの興味の変遷を数字で追えます。

- 表示単位は週次/月次を切り替えられます（対象は最大 10,000 件）

### タグ共起ペア / Tag Pairs

タグ共起ペアの上位 20 件を表形式で表示します。「タグクラスタ」グラフと同じ共起計算の別表現で、グラフが苦手な場合でも数字でタグ間のつながりを確認できます。

- 表の各行はペア（2 タグ）と共起回数です。クリックで履歴を絞り込めます

### ワードクラスタ / Word Cluster

タグを付けていないユーザー向けのパネルです。記録したページの要約文とタイトルから `Intl.Segmenter` でキーワードを抽出し、キーワード同士の共起クラスタをグラフで表示します。

- 既定の期間は「過去7日間」です
- キーワードは英数字のみで構成され、既存のタグ共起パイプラインを流用するため「#キーワード」のような擬似タグとして動作します
- タグクラスタと同じ操作（クリックで履歴絞り込み、ズーム、パン）が使えます

### タグクラスタ比較 / Tag Cluster Compare

指定した期間の前半と後半のタグクラスタを左右に並べて比較します。

- 前半と後半で出現したタグの差分一覧も表示されます（新しく出現したタグ・消えたタグ）
- タグごとの配色は FNV-1a ハッシュで安定しているため、左右で同じタグは同じ色になります
- 関心の移り変わりと継続しているテーマを把握できます

### 履歴 / History

SQLite データベースを直接検索・閲覧するパネルです。FTS5 による日本語全文検索（3 文字未満のクエリは LIKE 検索にフォールバック）に対応しています。

### データとプライバシー

分析対象はすべて端末内のローカル SQLite データベースです。分析のために履歴・タグが外部サービスに送信されることはありません。プライバシー設計の詳細は [PRIVACY.md](PRIVACY.md) を参照してください。

---

## English

### Overview

The "Data" section of the dashboard contains panels for analyzing your recorded browsing history in place: a day-of-week × time-of-day heatmap, domain/URL count tables, tag timelines, a tag co-occurrence pair table, keyword clusters, side-by-side tag-cluster comparison, and direct SQLite search.

All computations run against the local SQLite database (OPFS + FTS5) inside your browser; no history data is ever sent anywhere. Analytics only use what you have already recorded (tags, timestamps, domains). See [CHANGELOG.md](../CHANGELOG.md) → [6.9.22] for the first version of the panel set.

### Common Controls (Period Filter)

Most analytics panels include a period filter.

| Preset | Range |
|------|------|
| **Today** | Since midnight today |
| **Last 7 days** | Past 7 days |
| **Last 30 days** | Past 30 days |
| **Last 90 days** | Past 90 days |
| **All time** | Every record |
| **Custom** | Manually specified dates |

Changing the period re-aggregates the current panel. Each panel starts on a different period:

| Panel | Default period |
|------|------|
| Tag Cluster / Word Cluster | Last 7 days |
| Time Heatmap | Last 90 days |
| Domain Analysis / Tag Timeline | Last 30 days |
| Tag Pairs | All time |
| Revisits & Time Capsule | No period filter (fixed window) |
| Research Sessions | Last 7 days |

### Time Heatmap

Shows the number of records in a 7-day-of-week × 24-hour grid, colored by density. It gives you an at-a-glance view of when you tend to browse.

- Aggregated over up to 10,000 history rows

### Domain Analysis

Specify an optional tag and a period to see top-20 domain counts and top-20 URL counts as tables — a direct answer to questions like "which sites do my #travel reads come from?"

- Analyzes up to 50,000 history rows

### Revisits & Time Capsule

Automatic recording already streams every visit into a daily note, so one topic ends up scattered across many days. This panel surfaces what you keep re-researching in four sections, and gives you a way to gather the scattered visits into a single note.

- **Topics you keep re-researching**: domains, tags and pages with no record for 31–89 days that came back in the last 30 days. Only the "quiet, then back" shape counts, so a site you use every day never shows up
- **Frequently revisited pages**: URLs visited on 2 or more distinct days
- **Topics you have not revisited**: domains and tags that were frequent 60–120 days ago with no record in the last 30 days
- **This week, one year ago**: what you recorded during the same local week 52 weeks ago

"Copy as Markdown" puts that topic's visits on the clipboard as `## domain` plus `- YYYY-MM-DD [title](URL)` lines, dated by local day.

- Covers a fixed 400-day window; there is no period filter
- The recorder skips same-day revisits in UTC, so the local-day counts shown here can drift from it. See the note at the top of the panel
- Aggregation stops at 50,000 rows. When the cap is reached a notice appears and older counts are understated

### Research Sessions

Groups records that fall within a chosen time gap of each other into one "research session". The point aggregates answer "how many"; this panel answers "what did I look at, in what order, on that day" by showing the run of records as a timeline.

- The gap is 5, 15, 30 or 60 minutes (default 30). Changing it re-groups the rows already fetched — no refetch
- A gap of exactly the threshold stays in one session; one millisecond more splits it
- Only sessions of 2 or more records are listed, newest first. Single records are counted separately as "single pages"
- Each section shows the start time, page count, minutes and the top tags (or top domains when tagging is off). The minutes are the span from the first to the last record, not actual reading time
- The default period is "Last 7 days"; picking a period refetches immediately
- Analyzes up to 10,000 records and displays at most 100 sessions, with a notice at either cap

#### Navigation Trail (the "Search" and "From" fields in a session)

What fills the "Search: …" and "From: …" fields on each research-session row. It is opt-in and does not change the recording path itself: turn it on from the dashboard Privacy tab by confirming the dialog, and it is off by default.

- Records the URL of the page previously open in the same tab, with the fragment (everything from `#`) removed
- Also records the search term when the referrer is a search engine (Google, Bing, DuckDuckGo, Yahoo! Japan, Yahoo!, Brave, Ecosia), PII-masked and capped at 200 characters
- When the referrer matches the domain exclusion list, stores only the origin instead of the full URL
- Never included in what is sent to AI providers, in the Markdown written to Obsidian, or in exports
- Turning it off, or withdrawing privacy consent itself, stops collection and clears the tracked tab state

#### Path and "topics that take the longest to resolve"

With the navigation trail on, a session's expanded body is no longer a flat list — it is the **path** that was taken, recovered from the referrer column, with the leading search term printed once above it.

- A record's parent is "the most recent earlier record in the same session whose URL matches this record's referrer". When a URL is revisited, the most recent visit becomes the parent rather than the first
- A parent is always an earlier record, so a cycle cannot form
- Sessions recorded while the trail is off keep the flat list

A "Topics that take the longest to resolve" table is shown as well. It groups search-started sessions by the tags of their **last page** and reports the session count, average pages and average minutes.

- A tag seen in only one session is an anecdote, so only tags with 2 or more sessions appear
- A last page with no tag still gets a row, labelled "(untagged)" — it is not dropped
- The table covers exactly the sessions on screen (at most 100), the same window as the truncation notice
- Treating the last page as the resolution is a heuristic: it is where one burst of activity ended, not a measurement of whether the user understood it

### Tag Cluster

Visualizes tag co-occurrence as a graph. See the [Tag Cluster Guide](TAG_CLUSTER_GUIDE.md) for details.

- Uses the top 50 tags by frequency (up to 50 tags per record, 10,000 history rows)
- Defaults to the "Last 7 days" period

### Tag Timeline

For the top tags in a period (default 10), shows stacked weekly/monthly record counts as a line chart. Useful for tracking how your interests shift over time.

- Weekly/monthly granularity is switchable (up to 10,000 rows analyzed)

### Tag Pairs

Shows the top 20 tag co-occurrence pairs as a table — the same computation as the Tag Cluster graph, presented numerically for people who prefer tables over graphs.

- Each row is a tag pair with its co-occurrence count. Clicking a row filters history

### Word Cluster

A panel for users who do not tag their records. Keywords are extracted from page summaries and titles with `Intl.Segmenter`, then their co-occurrence clusters are rendered as a graph.

- Defaults to the "Last 7 days" period
- Keywords are letters/digits only and flow through the tag co-occurrence pipeline as "#keyword" pseudo-tags
- The same controls as Tag Cluster work here (click-to-filter, zoom, pan)

### Tag Cluster Compare

Compares the tag clusters of the first and second half of a selected period, side by side.

- A diff list shows tags that appeared or disappeared between halves
- Tag colors are derived from an FNV-1a hash, so the same tag keeps the same color on both sides

### History

A panel for searching and browsing the SQLite database directly, including FTS5 full-text search for Japanese (queries shorter than 3 characters fall back to LIKE search).

### Data and Privacy

Everything is computed from the on-device SQLite database. No history or tags are sent to any service for analysis. See [PRIVACY.md](PRIVACY.md) for the privacy design.
