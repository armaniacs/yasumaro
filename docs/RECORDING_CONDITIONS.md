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

タブを開いたままバックグラウンドに置いているだけのページや、目次だけ見てすぐ離脱したページを記録から除外するためです。滞在時間だけを見ると、「開きっぱなしで放置していたタブ」を誤検出します。スクロール深度だけを見ても、「一瞬でページ最下部までスクロールして離脱した」ケースを誤検出します。つまり、どちらか一方だけでは不十分です。両方を組み合わせることで、実際に内容を読んだと考えられるページに絞り込みます。

> **注意**: 滞在時間はページを開いてからの経過時間で判定されるため、バックグラウンドに置いていた時間も含まれます。

### 設定方法

ダッシュボードの **Recording Conditions** パネルで、以下の項目を調整できます。

| 設定項目 | 範囲 | デフォルト |
|---------|------|-----------|
| **Min Visit Duration**（最小滞在時間） | 1秒以上 | 5秒 |
| **Min Scroll Depth**（最小スクロール深度） | 0〜100% | 50% |
| **Max Tokens Per Prompt** | 10〜16,000 | 1,000 |
| **AI Timeout**（AIタイムアウト秒数） | 10〜600秒、空欄で自動 | 自動 |
| **Max Monthly Tokens**（月間トークン上限） | 0以上（上限なし、0=無制限） | 1,000,000 |
| **AI Rate Limit**（1分間のAIリクエスト数上限） | 1〜60 | 10 |
| **OpenAI Max Content Characters** | 1,000〜100,000 | 10,000 |
| **Gemini Max Content Characters** | 1,000〜100,000 | 30,000 |
| **Obsidian Host** | Obsidian REST APIのホスト名 | 127.0.0.1 |
| **Gemini API Version** | Gemini APIのバージョン | v1beta |

条件を厳しくする（滞在時間を長く、スクロール深度を高く）と誤検出が減りますが、記録漏れが増える可能性があります。逆に条件を緩めると多くのページが記録される一方、流し読みしたページも記録対象になりやすくなります。

### メディア別の判定（記事・動画・PDF・コード）

ページの種類によって読み方が違うため、記事以外のページは専用の条件で判定します。種別は読み込み時に1回だけ判定し、判定不能なページは記事の条件に倒します。

| 種別 | 条件（既定） | 変更 |
|------|-------------|------|
| 記事 | 滞在5秒＋スクロール50% | 上の Min Visit Duration / Min Scroll Depth |
| 動画 | 30秒視聴 | Recording Conditions の動画しきい値 |
| PDF | 滞在15秒＋2ページ | Recording Conditions のPDFしきい値 |
| コード | 滞在15秒＋1コピー | Recording Conditions のコードしきい値 |

空欄・負値・数値以外の設定は既定値のままになります。非表示タブでは定期判定が止まるため、バックグラウンド放置は記録されません。

### 対応範囲と対象外

- 記録できるもの: 記事頁の自動記録、SPA遅延コンテンツの再スキャン（上限2回・1頁分相当の増加で再記録。スクロール事象なしの自動追記は対象外）
- 計画中（未対応）: PDFビューワの本文抽出、動画字幕の取込み
- 記録しないもの: file:// 頁、認証裏頁、ペイウォール頁、キャンバス描画頁
- 記録できない理由はダッシュボードの診断パネル「取り込み状態」に理由コードと時刻で表示されます（本文・URL・題名は保存しません）

### 直近のskip理由をポップアップで見る

記録が skip された直近の理由は、ポップアップの「直近に記録されなかった理由」パネルに理由種別と連続回数で表示されます。

| 理由種別 | 意味 |
|---------|------|
| 条件未達 | 滞在時間・スクロールがしきい値未満（記事の2指標とメディア別の専用条件の両方） |
| 同日重複 | 同じURLを同日に複数回記録しようとした |
| プライベートページ | プライベートページとして拒否された |
| パイプラインエラー | パイプラインの終端処理に失敗した |

- 表示は理由種別と連続回数のみで、URL・題名・本文は保存しません（軸3「収集を増やさない」整合）
- 状態は chrome.storage.session に置かれるため、ブラウザのセッション中は service worker の再起動をまたいで保持されます
- バッジ通知（記録成功の青◎、プライベート検出のオレンジ!）と矛盾しない表示です。パネルはステータス面であり、記録成功扱いの見た目にはなりません
- 条件未達はページを離脱した時点で記録されます。閲覧中に条件を満たせば通常どおり記録されます

### 手動記録との関係

スマート検出の条件を満たさなかったページでも、ポップアップの **「今すぐ記録」** ボタンで手動記録できます。手動記録はスマート検出の条件（滞在時間・スクロール深度）を経由しないため、開いた直後のページでも即座に記録可能です。

ただし、通常の手動記録ではドメインフィルター・プライバシーヘッダー判定・信頼ドメイン判定が適用されます。ブロックされた場合に表示される2段階目の「Record Anyway」（強制記録）では、これら3つの判定がバイパスされます。

手動記録は重複チェックをスキップします。右クリックのコンテキストメニューからも手動記録できます。

### よくある質問

**Q. 記録されるはずのページが記録されない**

以下を確認してください。

- ページの滞在時間が「Min Visit Duration」以上か
- スクロール深度が「Min Scroll Depth」以上か（ページが短くスクロール不要な場合、条件を満たせないことがあります）
- ドメインフィルターでブロックされていないか
- プライベートページとして検出されていないか（銀行・メールなど）
- ポップアップの「直近に記録されなかった理由」パネルに、直近のskip理由と連続回数が表示されます

**Q. スクロールが不要なほど短いページを記録したい**

スマート検出の条件を満たしにくいページ（1画面に収まる短いページなど）は、ポップアップの「今すぐ記録」で手動記録するのが確実です。スクロールが発生しないページでは「Min Scroll Depth」を0に設定すると自動記録の対象になります。

### 一時停止する（しばらく記録を止める）

残したくない調べものをするときは、ポップアップの「⏸」ボタンで自動保存を一時停止できます。手動記録は停止中も使えます。

- 押すたびに30分延長されます（1回で約30分、2回で約60分、上限120分）。残り分数はポップアップの表示とツールバーの赤い数字バッジで分かります
- 期限が来ると自動で記録に戻ります。途中で戻したいときは「▶」ボタンを押します
- ブラウザを再起動しても、期限までは停止が続きます

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

### Per-media conditions (article / video / PDF / code)

Different media are read differently, so non-article pages use dedicated conditions. The kind is classified once at load; unclassifiable pages fall back to the article condition.

| Kind | Condition (default) | Where to change |
|------|--------------------|-----------------|
| Article | 5s stay + 50% scroll | Min Visit Duration / Min Scroll Depth above |
| Video | 30s watched | Video threshold in Recording Conditions |
| PDF | 15s stay + 2 pages | PDF thresholds in Recording Conditions |
| Code | 15s stay + 1 copy | Code thresholds in Recording Conditions |

Blank, negative, or non-numeric settings keep the defaults. Periodic checks stop in hidden tabs, so background-idle pages are not recorded.

### Coverage and exclusions

- Recorded: article auto-capture, SPA late-content re-scan (up to 2 times, re-records on about a page of growth; auto-append without scroll events is out of scope)
- Planned (not yet): PDF viewer text extraction, video caption ingestion
- Never recorded: file:// pages, auth-walled pages, paywalled pages, canvas-rendered pages
- Unrecordable reasons appear in the dashboard diagnostics panel under capture status as reason code + time (no body, URL, or title is stored)

### Seeing the recent skip reason in the popup

The most recent reason a recording was skipped appears in the popup's "Why the last page was not recorded" panel as a reason type plus its consecutive count.

| Reason type | Meaning |
|-------------|---------|
| Condition not met | Stay or scroll below the threshold (both the article pair and the per-media conditions) |
| Duplicate | The same URL was recorded more than once on the same day |
| Private page | Refused as a private page |
| Pipeline error | A terminal pipeline step failed |

- The record carries the reason type and the count only; no URL, title, or body is stored (aligned with axis 3 "collect nothing extra")
- The state lives in chrome.storage.session, so it survives a service-worker restart within the browser session
- The panel is a status surface and never renders like a successful recording, so it does not contradict the badge notices (blue ◎ for recorded, orange ! for private)
- Condition-not-met is recorded when the page view ends. Meeting the conditions while reading records the page as usual

### Why these two signals

This combination excludes tabs left open in the background and pages where you scrolled straight to the bottom and left without reading. Looking at visit duration alone would misclassify tabs left open and forgotten as "read." Looking at scroll depth alone would misclassify a quick scroll-to-bottom-and-leave as "read." Combining both narrows detection down to pages you likely actually read.

> **Note**: Visit duration is measured as elapsed time since the page was opened, so time spent in the background counts toward it.

### Configuration

Adjust the following in the dashboard's **Recording Conditions** panel:

| Setting | Range | Default |
|---------|-------|---------|
| **Min Visit Duration** | 1 second or more | 5 seconds |
| **Min Scroll Depth** | 0-100% | 50% |
| **Max Tokens Per Prompt** | 10-16,000 | 1,000 |
| **AI Timeout** | 10-600 seconds, blank for auto | Auto |
| **Max Monthly Tokens** | 0 or more (no upper limit; 0 = unlimited) | 1,000,000 |
| **AI Rate Limit** (requests/min) | 1-60 | 10 |
| **OpenAI Max Content Characters** | 1,000-100,000 | 10,000 |
| **Gemini Max Content Characters** | 1,000-100,000 | 30,000 |
| **Obsidian Host** | Obsidian REST API hostname | 127.0.0.1 |
| **Gemini API Version** | Gemini API version string | v1beta |

Stricter conditions (longer visit duration, higher scroll depth) reduce false positives but may cause more pages to go unrecorded. Looser conditions record more pages, including ones you only skimmed.

### Relationship to Manual Recording

Even if a page doesn't meet the Smart Detection conditions, you can still record it manually using the **"Record Now"** button in the popup. Manual recording bypasses the Smart Detection thresholds (visit duration, scroll depth) entirely, so you can record a page immediately after opening it.

Normal manual recording still passes the domain filter, privacy header, and trust-domain checks. The second-step "Record Anyway" force path shown when blocked bypasses all three checks.

Manual recording skips duplicate checks. You can also record manually from the right-click context menu.

### FAQ

**Q. A page I expected to be recorded wasn't recorded**

Check the following:

- Whether the visit duration meets or exceeds "Min Visit Duration"
- Whether scroll depth meets or exceeds "Min Scroll Depth" (short pages that don't require scrolling may never satisfy this)
- Whether the domain is blocked by a domain filter
- Whether the page was detected as private (banking, email, etc.)
- The popup's "Why the last page was not recorded" panel shows the recent skip reason with its consecutive count

**Q. I want to record a short page that doesn't require scrolling**

For pages unlikely to satisfy Smart Detection (e.g., short pages that fit on one screen), use the "Record Now" button in the popup for reliable manual recording. Setting "Min Scroll Depth" to 0 makes pages without scrolling eligible for automatic recording.

### Pausing (stopping recording for a while)

When you browse something you don't want kept, press the "⏸" button in the popup to pause auto-save. Manual recording still works while paused.

- Each press extends the pause by 30 minutes (about 30 on the first press, about 60 on the second, capped at 120). The remaining minutes show in the popup and as a red number badge on the toolbar
- Recording resumes automatically at expiry. Press "▶" to resume early
- The pause survives a browser restart until its deadline
