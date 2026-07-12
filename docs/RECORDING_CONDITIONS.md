# スマート検出（記録条件） / Smart Detection (Recording Conditions)

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

Yasumaro は、ページを開いただけでは記録しません。**実際に読んだと判断できるページのみ**を自動記録します。この判定を「スマート検出」と呼びます。

判定には以下の2つの指標を使用します。

| 指標 | 説明 | デフォルト値 |
|------|------|------------|
| **最小滞在時間** | ページを開いてからの経過時間 | 5秒 |
| **最小スクロール深度** | ページ内をどれだけスクロールしたか | 50% |

両方の条件を満たしたページのみが自動記録の対象になります。どちらか一方でも下回っている場合は記録されません。

### なぜこの2指標なのか

タブを開いたままバックグラウンドに置いているだけのページや、目次だけ見てすぐ離脱したページを記録から除外するためです。滞在時間だけを見ると「開きっぱなしで放置していたタブ」を誤検出してしまい、スクロール深度だけを見ると「一瞬でページ最下部までスクロールして離脱した」ケースを誤検出してしまいます。両方を組み合わせることで、実際に内容を読んだと考えられるページに絞り込みます。

> **注意**: ウィンドウが非アクティブ（バックグラウンド）の間は滞在時間としてカウントされません。

### 設定方法

ダッシュボードの **Recording Conditions** パネルで、以下の項目を調整できます。

| 設定項目 | 範囲 | デフォルト |
|---------|------|-----------|
| **Min Visit Duration**（最小滞在時間） | 1秒以上 | 5秒 |
| **Min Scroll Depth**（最小スクロール深度） | 0〜100% | 50% |
| **Max Tokens Per Prompt** | 10〜16,000 | 1,000 |
| **AI Timeout**（AIタイムアウト秒数） | 10〜600秒、空欄で自動 | 自動 |

条件を厳しくする（滞在時間を長く、スクロール深度を高く）と誤検出が減りますが、記録漏れが増える可能性があります。逆に条件を緩めると多くのページが記録される一方、流し読みしたページも記録対象になりやすくなります。

### 手動記録との関係

スマート検出の条件を満たさなかったページでも、ポップアップの **「今すぐ記録」** ボタンで手動記録できます。手動記録はスマート検出の条件（滞在時間・スクロール深度）を経由しないため、開いた直後のページでも即座に記録可能です。

ただし、ドメインフィルターやプライバレートページ検出（銀行・メールなど）は手動記録時にも適用されます。

### よくある質問

**Q. 記録されるはずのページが記録されない**

以下を確認してください。

- ページの滞在時間が「Min Visit Duration」を超えているか
- スクロール深度が「Min Scroll Depth」を超えているか（ページが短くスクロール不要な場合、条件を満たせないことがあります）
- ドメインフィルターでブロックされていないか
- プライベートページとして検出されていないか（銀行・メールなど）

**Q. スクロールが不要なほど短いページを記録したい**

スマート検出の条件を満たしにくいページ（1画面に収まる短いページなど）は、ポップアップの「今すぐ記録」で手動記録するのが確実です。

---

## English

### Overview

Yasumaro does not record a page just because you opened it. It only automatically records pages you can reasonably be said to have **actually read**. This judgment is called Smart Detection.

Two signals are used for the decision:

| Signal | Description | Default |
|--------|-------------|---------|
| **Minimum Visit Duration** | Elapsed time since the page was opened | 5 seconds |
| **Minimum Scroll Depth** | How far down the page you scrolled | 50% |

Only pages that satisfy both conditions are automatically recorded. If either falls short, the page is not recorded.

### Why these two signals

This combination excludes tabs left open in the background and pages where you scrolled straight to the bottom and left without reading. Looking at visit duration alone would misclassify tabs left open and forgotten as "read." Looking at scroll depth alone would misclassify a quick scroll-to-bottom-and-leave as "read." Combining both narrows detection down to pages you likely actually read.

> **Note**: Time does not accumulate while the window is inactive (in the background).

### Configuration

Adjust the following in the dashboard's **Recording Conditions** panel:

| Setting | Range | Default |
|---------|-------|---------|
| **Min Visit Duration** | 1 second or more | 5 seconds |
| **Min Scroll Depth** | 0–100% | 50% |
| **Max Tokens Per Prompt** | 10–16,000 | 1,000 |
| **AI Timeout** | 10–600 seconds, blank for auto | Auto |

Stricter conditions (longer visit duration, higher scroll depth) reduce false positives but may cause more pages to go unrecorded. Looser conditions record more pages, including ones you only skimmed.

### Relationship to Manual Recording

Even if a page doesn't meet the Smart Detection conditions, you can still record it manually using the **"Record Now"** button in the popup. Manual recording bypasses the Smart Detection thresholds (visit duration, scroll depth) entirely, so you can record a page immediately after opening it.

Domain filters and private page detection (banking, email, etc.) still apply during manual recording.

### FAQ

**Q. A page I expected to be recorded wasn't recorded**

Check the following:

- Whether the visit duration exceeded "Min Visit Duration"
- Whether scroll depth exceeded "Min Scroll Depth" (short pages that don't require scrolling may never satisfy this)
- Whether the domain is blocked by a domain filter
- Whether the page was detected as private (banking, email, etc.)

**Q. I want to record a short page that doesn't require scrolling**

For pages unlikely to satisfy Smart Detection (e.g., short pages that fit on one screen), use the "Record Now" button in the popup for reliable manual recording.
