# Permissions Justification / パーミッション正当化

**Purpose**: This document provides detailed justifications for each permission requested by Yasumaro in its `manifest.json`. It is intended for the Chrome Web Store review process to demonstrate that each permission is necessary and used appropriately.

**目的**: このドキュメントは Yasumaro の `manifest.json` で要求する各パーミッションの正当化理由を記載します。Chrome Web Store 審査プロセスにおいて、各パーミッションが必要かつ適切に使用されていることを示すことを目的としています。

**Last Updated / 最終更新日**: 2026-06-17
**Target Version / 対象バージョン**: v6.0.0 (Chrome Web Store 初回公開)

---

## Summary / サマリー

| Permission | Type | Used In | Required? |
|-----------|------|---------|-----------|
| `tabs` | required | `src/background/` (URL & title capture) | Yes |
| `storage` | required | `src/utils/storage.ts` (settings, encrypted API keys) | Yes |
| `scripting` | required | `src/content/` (content script injection) | Yes |
| `notifications` | required | `src/background/notificationHelper.ts` | Yes |
| `offscreen` | required | `src/background/` (wa-sqlite worker host) | Yes |
| `unlimitedStorage` | required | OPFS + chrome.storage.local backup | Yes |
| `webRequest` | required | `src/background/headerDetector.ts` (privacy header detection) | Yes |
| `alarms` | required | `src/background/sessionAlarmsManager.ts` (session timeout) | Yes |
| `favicon` | optional | User opt-in via settings | No |

---

## Required Permissions / 必須パーミッション

### 1. `tabs`

**Why we need it / なぜ必要か**

- アクティブタブの URL とタイトルを取得して、AI 要約の対象とするため
- タブの更新・アクティブ化イベントを監視して、滞在時間とスクロール深度を追跡するため
- 新しいタブで開いたページの自動記録を開始するため

**What it enables / 有効化される機能**

- `chrome.tabs.onUpdated` — タブ URL の変更を検知し、記録パイプラインを起動
- `chrome.tabs.onActivated` — アクティブタブ切り替え時の状態更新
- `chrome.tabs.query({ active: true, currentWindow: true })` — ポップアップ UI に現在のタブ情報を表示

**Privacy safeguards / プライバシー保護**

- すべての URL はユーザー設定（ドメインフィルタ）でフィルタリング
- プライベート IP / localhost は除外
- ユーザーの明示的オプトインがない限り、プライベートページ（Cache-Control: private, Set-Cookie 等）は自動記録されない

**Code references / コード参照**

- `src/background/service-worker.ts` (message handlers)
- `src/background/recordingTriggerManager.ts`
- `src/background/recordingLogic.ts`

---

### 2. `storage`

**Why we need it / なぜ必要か**

- ユーザー設定（API プロバイダー、ドメインフィルタ、閾値等）を `chrome.storage.local` に保存
- API キーを PBKDF2 + AES-GCM で暗号化して保存
- 同期が必要な設定は `chrome.storage.sync` で複数デバイス共有

**What it enables / 有効化される機能**

- 拡張機能オプション（テーマ、言語、ショートカット）
- 暗号化済み API キー（Gemini / OpenAI / Anthropic 等）
- SQLite データベースのメタ情報（スキーマバージョン、最終パージ日時等）
- プライバシーポリシー同意フラグ

**Privacy safeguards / プライバシー保護**

- API キーは保存前に PBKDF2 (310,000 iterations) + AES-GCM で暗号化
- ユーザーが「マスターパスワード保護」を有効化した場合、API キーはユーザー固有のパスワードで暗号化
- 設定のエクスポート/インポート時に HMAC 署名検証を実施

**Code references / コード参照**

- `src/utils/storage.ts`
- `src/utils/crypto.ts`
- `src/utils/settings.ts`

---

### 3. `scripting`

**Why we need it / なぜ必要か**

- コンテンツスクリプトを `chrome.scripting.executeScript` で動的に注入
- Service Worker からの要求に応じてページ本文を抽出
- 一部のユーザー操作（「Record Now」ボタン）で即座にコンテンツ取得

**What it enables / 有効化される機能**

- 自動記録時のページコンテンツ抽出
- 手動記録時の即座のコンテンツ取得
- ダッシュボードから「現在のページを保存」操作

**Privacy safeguards / プライバシー保護**

- コンテンツスクリプトはハードコードされた URL のみに注入（`<all_urls>` は host_permissions 側で制御）
- 抽出したコンテンツはメモリ内のみで扱い、永続化前にユーザーが指定した AI プロバイダーに送信
- 抽出されたコンテンツには PII（個人情報）マスキングが適用される場合あり

**Code references / コード参照**

- `src/content/extractor.ts` (content script)
- `src/background/recordingLogic.ts` (injection call site)

---

### 4. `notifications`

**Why we need it / なぜ必要か**

- SQLite 障害発生時のアラート
- プライバシー懸念（Set-Cookie, Cache-Control: private）が検出されたページの手動確認
- 記録の成功/失敗フィードバック
- 「Pending Pages」セクションで保留中のページを通知

**What it enables / 有効化される機能**

- 通知ボタンで「保存 / スキップ」の二択確認
- 失敗時のエラーメッセージ表示
- 長期バックグラウンド処理の完了通知

**Privacy safeguards / プライバシー保護**

- 通知には URL タイトルと検出理由のみを含める（ページ本文は含めない）
- 通知タイプを限定（`basic` のみ、`image` や `list` は使用しない）

**Code references / コード参照**

- `src/background/notificationHelper.ts`
- `src/background/sqliteAlert.ts`
- `src/background/handlers/notificationHandlers.ts`

---

### 5. `offscreen`

**Why we need it / なぜ必要か**

- Manifest V3 の Service Worker には DOM API と永続的な Worker がない
- wa-sqlite（OPFS + FTS5）を実行するには、専用 Worker + DOM API（OPFS 同期ハンドル用）が必要
- Offscreen Document は Service Worker 内で DOM API を使う唯一の方法

**What it enables / 有効化される機能**

- SQLite WASM の実行コンテキスト
- OPFS 経由でのデータベース永続化
- FTS5 trigram トークナイザによる全文検索

**Privacy safeguards / プライバシー保護**

- Offscreen Document は Service Worker からメッセージで起動・停止を制御
- 不要時は直ちに `chrome.offscreen.closeDocument()` で閉じる
- メッセージパッシング経由のみでデータアクセス

**Code references / コード参照**

- `src/offscreen/offscreen.ts`
- `src/background/sqliteClient.ts` (orchestration)

---

### 6. `unlimitedStorage`

**Why we need it / なぜ必要か**

- ユーザーの閲覧履歴を無制限にローカル保存
- OPFS の quota を超えるサイズの SQLite データベース
- 長期間（数ヶ月〜数年）の蓄積に対応

**What it enables / 有効化される機能**

- 10MB 以上の `chrome.storage.local` 使用
- 数万〜数十万件の閲覧ログ保存
- 7 日以上前のログの保持（デフォルト保持期間）

**Privacy safeguards / プライバシー保護**

- すべてのデータはユーザー端末のみに保存（外部送信なし）
- ユーザーが手動でデータ削除・拡張機能アンインストールで完全消去可能
- データ量に応じた自動パージ（90 日経過分の古いログ）

**Code references / コード参照**

- `wxt.config.ts` (manifest declaration)
- `src/background/sqliteClient.ts` (storage layer)
- `dist/chromium-mv3/data/models-dev-openai-compatible.json` (bundled data)

---

### 7. `webRequest`

**Why we need it / なぜ必要か**

- HTTP レスポンスヘッダーを読み取り、プライベートページを検出
- 以下のヘッダーを監視: `Cache-Control: private`, `Set-Cookie`, `Authorization`
- プライベートページが検出された場合は自動記録をスキップし、ユーザーに手動確認を促す

**What it enables / 有効化される機能**

- 銀行サイト・ログインページ等の自動スキップ判定
- プライバシー保護（機密情報を含むページの不注意な記録を防止）
- 「Pending Pages」セクションでの手動保存フロー

**Privacy safeguards / プライバシー保護**

- **読み取り専用** — ネットワークリクエストのブロック・改変は一切行わない（`chrome.webRequest.onHeadersReceived` のオブザーバーパターンのみ）
- ヘッダー値そのものは保存せず、検出フラグ（boolean）のみ保持
- ユーザーは設定でこの機能を完全に無効化可能

**Code references / コード参照**

- `src/background/headerDetector.ts` (event listener registration)
- `src/utils/privacyChecker.ts` (header analysis)
- `src/background/privacyPipeline.ts` (integration)

---

### 8. `alarms`

**Why we need it / なぜ必要か**

- セッションタイムアウト管理（Service Worker が idle で terminate されても、指定時刻に復帰）
- 日次のログパージ（24 時間ごと）
- アイドル時の自動クリーンアップ

**What it enables / 有効化される機能**

- `chrome.alarms.create('check_session_timeout')` — 5 分ごとに発火し、セッションタイムアウトを判定
- `chrome.alarms.create('yasumaro-daily-purge', { periodInMinutes: 1440 })` — 日次で古いログを削除
- Service Worker の keep-alive（chrome.alarms は永続イベントソース）

**Privacy safeguards / プライバシー保護**

- アラーム発火時の処理は純粋に内部状態管理のみ（外部通信なし）
- ユーザーデータの操作は限定的（古いログの削除・パージのみ）

**Code references / コード参照**

- `src/background/sessionAlarmsManager.ts`
- `src/background/service-worker.ts:100` (`yasumaro-daily-purge`)
- `src/background/recordingTriggerManager.ts`

---

## Optional Permissions / オプショナルパーミッション

### 9. `favicon` (optional)

**Why we need it / なぜ必要か**

- ユーザーがオプションで有効化した場合のみ、アクセス中サイトの favicon を取得
- ダッシュボードのログ一覧を視覚的にリッチ化

**What it enables / 有効化される機能**

- ホスト権限を動的に要求（`chrome.permissions.request`）
- `chrome://favicon/<url>` 経由でファビコン画像を取得

**Privacy safeguards / プライバシー保護**

- デフォルトでは無効（ユーザーが明示的にオプトイン）
- 設定でいつでも無効化可能
- ファビコン取得以外の用途には使用しない

**Code references / コード参照**

- `src/background/handlers/faviconHandlers.ts` (planned)
- `src/utils/permissionManager.ts` (dynamic permission flow)

---

## Permissions We Do NOT Request / 要求しないパーミッション

以下は明示的に要求**しない**パーミッションです。透明性のため記載します:

| Permission | Why we don't need it |
|-----------|---------------------|
| `cookies` | セッション管理は外部サービス（AI / Obsidian）が担当。当拡張は Cookie にアクセスしない |
| `history` | 閲覧履歴の記録は独自 SQLite で完結。`chrome.history` API は使用しない |
| `bookmarks` | ブックマーク機能なし |
| `downloads` | ファイルのダウンロード操作は行わない（エクスポートは `chrome.runtime.getURL` 経由） |
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

- **2026-06-17**: 初版作成（v6.0.0 Chrome Web Store 初回公開向け）
