# Permissions Justification / パーミッション正当化

**Purpose**: This document provides detailed justifications for each permission requested by Yasumaro in its `manifest.json`. It is intended for the Chrome Web Store review process to demonstrate that each permission is necessary and used appropriately.

**目的**: このドキュメントは Yasumaro の `manifest.json` で要求する各パーミッションの正当化理由を記載します。Chrome Web Store 審査プロセスにおいて、各パーミッションが必要かつ適切に使用されていることを示すことを目的としています。

**Last Updated / 最終更新日**: 2026-07-12
**Target Version / 対象バージョン**: v6.5.24

---

## Summary / サマリー

| Permission | Type | Used In | Required? |
|-----------|------|---------|-----------|

| `storage` | required | `src/utils/storage.ts` (settings, encrypted API keys) | Yes |
| `scripting` | required | `src/content/` (content script injection) | Yes |
| `notifications` | required | `src/background/notificationHelper.ts` | Yes |
| `offscreen` | required | `src/background/` (wa-sqlite worker host) | Yes |
| `unlimitedStorage` | required | OPFS + chrome.storage.local backup | Yes |
| `webRequest` | required | `src/background/headerDetector.ts` (privacy header detection) | Yes |
| `alarms` | required | `src/background/sessionAlarmsManager.ts` (session timeout) | Yes |
| `activeTab` | required | Popup "Record Now" + manual content fetch | Yes |
| `favicon` | required | Popup current page + dashboard/history favicon display | Yes |
| `contextMenus` | required | `src/background/service-worker.ts` (manual record trigger) | Yes |
| `downloads` | required | `src/background/pipeline/steps/saveLocalMarkdownStep.ts` (local Markdown export) | Yes |

---

## Required Permissions / 必須パーミッション

> **Note on content_scripts / コンテンツスクリプトについて**: This extension declares `content_scripts` with `matches: ['<all_urls>']` to detect page visits, track engagement (scroll depth, visit duration), and optionally extract page content when recording conditions are met. The content script is the entry point — it first checks domain filters, and only activates the full extractor on allowed domains. This design ensures automatic browsing log recording works on any page the user visits, which is the extension's core feature. No content is extracted or transmitted without passing through domain allowlist/blocklist checks and user-configured thresholds.
>
> **コンテンツスクリプトについて**: 本拡張機能は `content_scripts` に `matches: ['<all_urls>']` を宣言しています。これはページ訪問の検出、エンゲージメント（スクロール深度、滞在時間）の追跡、記録条件が満たされた場合のコンテンツ抽出のために必要です。コンテンツスクリプトは入口として機能し、まずドメインフィルタをチェックし、許可されたドメインでのみフルの抽出機能を有効化します。この設計により、拡張機能の核心機能である自動ブラウジングログ記録がユーザーの訪問先すべてで動作します。コンテンツの抽出や送信は、ドメインの許可リスト/拒否リストとユーザー設定の閾値を通過した場合のみ行われます。

### 1. `storage`
### 2. `scripting`
### 3. `notifications`
### 4. `offscreen`
### 5. `unlimitedStorage`
### 6. `webRequest`
### 7. `alarms`
### 8. `activeTab`
### 9. `favicon` (required)

**Why we need it / なぜ必要か**

- ポップアップの現在ページ表示およびダッシュボードの履歴一覧で、各サイトの favicon を表示するために使用
- 視覚的に記録対象ページを識別しやすくするため

**What it enables / 有効化される機能**

- `chrome-extension://_favicon/` 経由でファビコン画像を取得
- ポップアップ、ダッシュボードの各履歴項目でサイトアイコンを表示

**Privacy safeguards / プライバシー保護**

- ファビコン取得以外の用途には使用しない
- 取得した画像は UI 表示にのみ使用し、外部に送信しない

**Code references / コード参照**

- `src/popup/recordCurrentPage.ts` (popup favicon)
- `src/dashboard/sqliteHistoryPanel.ts` (history favicon display)

---

## 10. `contextMenus`

**用途**: ユーザーが Web ページ上で右クリックしたときに、「Yasumaro でこのページを記録」メニューを表示し、手動記録を実行できるようにする。

**理由**: 拡張機能アイコンのクリック以外にも、ページ閲覧中に手動で要約・保存をトリガーする手段を提供するため。

**プライバシー保護**: コンテキストメニューはユーザーが明示的に右クリックしたときのみ表示される。自動で記録は行われない。

---

## 11. `downloads`

**Why we need it / なぜ必要か**

- Obsidian を使わずに閲覧履歴を利用できる「ローカル Markdown 書き出し」機能のため。閲覧記録を日次の Markdown ファイルとしてブラウザのダウンロードフォルダ（デフォルト: `~/Downloads/Yasumaro/`）に保存する
- ダッシュボードの「初期設定」→「ローカル Markdown 書き出し」で ON にしたユーザーのみが対象。デフォルトは OFF

**What it enables / 有効化される機能**

- `chrome.downloads.download()` による日次 Markdown ファイル（`YYYY-MM-DD.md`）の書き出し（`conflictAction: 'overwrite'`）
- 書き出しタイミングは「手動のみ / 即時 / アイドル時・30分ごと / 日付が変わったとき」から選択可能
- ダッシュボードの「履歴」「ログをエキスポート」パネルからの手動 Markdown エクスポート

**Privacy safeguards / プライバシー保護**

- 機能自体がオプトイン（デフォルト OFF）
- ダウンロード先はユーザーのローカルファイルシステムのみで、外部送信は行わない
- ダウンロードしたファイル一覧の読み取りや、他の拡張機能・サイトが行ったダウンロードへのアクセスは行わない

**Code references / コード参照**

- `src/background/pipeline/steps/saveLocalMarkdownStep.ts`
- `src/background/localMarkdownIdleFlusher.ts`
- `docs/MARKDOWN_DOWNLOAD.md`（ユーザー向けガイド）

---

## Permissions We Do NOT Request / 要求しないパーミッション

以下は明示的に要求**しない**パーミッションです。透明性のため記載します:

| Permission | Why we don't need it |
|-----------|---------------------|
| `cookies` | セッション管理は外部サービス（AI / Obsidian）が担当。当拡張は Cookie にアクセスしない |
| `history` | 閲覧履歴の記録は独自 SQLite で完結。`chrome.history` API は使用しない |
| `bookmarks` | ブックマーク機能なし |
| `geolocation` | 地理位置情報は一切使用しない |
| `clipboardRead` / `clipboardWrite` | クリップボード操作は限定的なエクスポート機能のみ（`navigator.clipboard.writeText` で Web API 経由） |
| `nativeMessaging` | 外部アプリとの連携なし（Obsidian は REST API） |
| `proxy` | プロキシ設定の変更なし |
| `vpnProvider` | VPN 機能は提供しない |
| `debugger` | DevTools への干渉なし |
| `pageCapture` / `tabCapture` | ページ全体のキャプチャなし |
| `<all_urls>` host_permission | host_permissions で個別ドメインのみ宣言 |

---

## Reviewer Notes for Chrome Web Store / 審査担当者向け注記

1. **本拡張機能は Manifest V3 のみを使用**しています。MV2 への後方互換は提供しません。
2. **データ送信先は 2 種類のみ**: ユーザーが選択した AI プロバイダー（要約生成時）と、ユーザーが設定した Obsidian Local REST API（デイリーノート保存時）。開発者のサーバーには一切送信しません。
3. **すべての主要機能はローカル完結**で、AI 要約を無効化しても閲覧ログの SQLite 保存は可能です。
4. **ソースコードは公開リポジトリ**で管理: <https://github.com/armaniacs/yasumaro>
5. **プライバシーポリシー**: <https://armaniacs.github.io/yasumaro/PRIVACY.md>
6. **問い合わせ先**: GitHub Issues（リポジトリ参照）

---

## Update History / 更新履歴

- **2026-07-12**: `downloads` パーミッションを追加（ローカル Markdown 書き出し機能、v6.5.14）。実装との乖離を修正
- **2026-06-17**: 初版作成（v6.0.0 Chrome Web Store 初回公開向け）
