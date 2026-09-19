# ツールバーバッジガイド / Toolbar Badge Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

Yasumaro は、ポップアップを開かなくても現在の状態が分かるよう、拡張機能アイコンに小さなバッジ（色付きの記号・文字）を表示します。バッジの色と記号の組み合わせで、以下のことを確認できます。

### バッジ一覧

| バッジ | 色 | 意味 |
|-------|-----|------|
| **◎** | 青 | 現在のページが自動保存されました（タブごとに表示。タブを切り替えても維持され、ページ遷移・タブを閉じると消えます） |
| **C{件数}** | 緑 | AI Summary Cleansingでクレンジングされた要素数（例: `C12`）。タイマーによる自動消去はなく、ページ遷移などタブの状態が変わるまで表示され続けます |
| **●** | 緑 | 記録可能・監視中（タブ切替時に表示） |
| **!** | オレンジ | プライベートページとして検出されました（銀行・メールなど）。または、プライバシー同意が未取得の状態です |
| **∉** | 緑 | ドメインフィルターの設定により、現在のページは記録対象外です（許可リスト外、またはブロックリスト該当。タブごとに表示） |

### 「∉」バッジについて

緑の「∉」バッジは、ドメインフィルター設定（許可リスト / ブロックリスト / uBlock 形式ルール）によって現在のドメインが記録対象から除外されていることを示します。数学記号の「∉」（属さない）にちなんでいます。意図せず記録が止まっている場合は、ダッシュボードの「ドメインフィルター」設定を確認してください。なお、この判定が一時的に行えなかった場合はバッジを表示しません。

### 「!」バッジの2つの意味に注意

オレンジの「!」バッジは、状況によって意味が異なります。

1. **プライベートページ検出時**: 次のいずれかでプライベートページと判定された場合に表示されます（タブごとに表示され、ページ遷移で消えます）。`Cache-Control: private` 単独、`Cache-Control: no-store`＋`Set-Cookie`、`Set-Cookie`＋`Vary: Cookie`、`Authorization` ヘッダー
2. **プライバシー同意が未取得の場合**: 拡張機能全体がまだデータ収集への同意を得ていない状態（初回起動時に同意を拒否した場合など）。この場合はどのページを開いてもバッジが表示され続けます。同意すると消えます

どちらの意味かを見分ける目安は表示範囲です。特定のページでのみ表示される場合は1つ目、常に表示されている場合は2つ目です。常に表示されている場合はプライバシー同意の確認が必要です。ポップアップの「⚙」アイコンからダッシュボードを開き、プライバシー同意の状態を確認してください。

### 用途

ポップアップを開かなくても、ツールバーを見るだけで次のことが分かります。

- このページはちゃんと保存されたか
- クレンジングでどれだけ削減されたか
- このタブは記録可能・監視中か
- このページは記録前に確認が必要か
- このページはドメインフィルターで記録対象外になっているか

---

## English

### Overview

Yasumaro displays a small badge (colored symbol or text) on the extension icon so you can check the current status without opening the popup. The badge's color and symbol tell you the following.

### Badge Reference

| Badge | Color | Meaning |
|-------|-------|---------|
| **◎** | Blue | The current page was auto-saved (shown per tab; persists across tab switches and clears on navigation or tab close) |
| **C{count}** | Green | Number of elements removed by AI Summary Cleansing (e.g., `C12`). No timed auto-clear; persists until the tab's next state transition such as navigation |
| **●** | Green | Recording is possible / monitoring (shown on tab activation) |
| **!** | Orange | The page was detected as private (banking, email, etc.), OR privacy consent has not yet been granted |
| **∉** | Green | The current page is excluded from recording by your domain filter settings (not in the allowlist, or matched by the blocklist; shown per tab) |

### About the "∉" Badge

The green "∉" badge indicates that the current domain is excluded from recording by your domain filter settings (allowlist / blocklist / uBlock-format rules). It uses the mathematical "not an element of" symbol. If recording has stopped unexpectedly, check the "Domain Filter" settings in the dashboard. The badge is not shown if this check could not be performed.

### The Two Meanings of "!"

The orange "!" badge means different things depending on context.

1. **Private page detected**: The page was detected as private via one of the following (shown per tab; clears on navigation): `Cache-Control: private` alone, `Cache-Control: no-store` + `Set-Cookie`, `Set-Cookie` + `Vary: Cookie`, or the `Authorization` header
2. **Privacy consent not granted**: The extension as a whole has not yet received consent for data collection (e.g., if you declined the consent prompt on first launch). In this case, the badge persists no matter which page you open. It clears once you grant consent

The easiest way to tell which case applies is whether the badge appears only on a specific page or persists everywhere. If it's always present, check your privacy consent status by opening the dashboard via the "⚙" icon in the popup.

### Use Cases

Without opening the popup, a glance at the toolbar tells you whether the current page was properly saved, how much cleansing reduced the content, and whether the page needs review before recording.
