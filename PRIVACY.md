# プライバシーポリシー / Privacy Policy

**最終更新日: 2026年2月23日 / Last Updated: February 23, 2026**

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要
Obsidian Smart History（以下「本拡張機能」）は、ユーザーのプライバシー保護に努めています。本ポリシーでは、収集されるデータ、その使用方法、およびユーザーの権利について説明します。

### データの収集
本拡張機能は、以下のデータを**ユーザーのデバイス上のみ（ローカル）**で収集します。

1. **閲覧履歴データ**:
   - 訪問したページのURL
   - ページのタイトル
   - 滞在時間
   - スクロール深度
   - ページ内容（AI要約生成用）

2. **構成データ**:
   - Obsidian API キー
   - Obsidian サーバー設定（プロトコル、ポート、パス）
   - AI プロバイダーの API キー（Google Gemini、OpenAI互換API等）
   - 設定情報（最小滞在時間、スクロール深度など）

### データの保存場所
- すべての設定データは、デバイス上の **Chrome ローカルストレージ** に保存されます。
- 閲覧履歴は、ユーザー自身の **ローカル Obsidian Vault** に保存されます。また、直近7日分（最大10,000件）のメタデータ（URL・タイトル・記録種別等）が **Chrome ローカルストレージ** にも保存され、拡張機能のダッシュボードから確認できます。
- **いかなるデータも開発者のサーバーには保存されません。** 開発者はサーバーを運営していません。

### データの使用方法
1. **ページ内容**: 要約を作成するために、ユーザーが選択した AI プロバイダー API（Google Gemini、OpenAI互換API等）に送信されます。
2. **閲覧履歴**: Local REST API を通じて Obsidian Vault に保存されます。また、直近7日分のメタデータ（URL・タイトル・記録種別・PIIマスク件数等）が Chrome ローカルストレージに保存され、拡張機能のダッシュボード（履歴タブ）で確認・管理できます。
3. **設定**: Obsidian および AI プロバイダー API への接続に使用されます。

### プライベートページ保護機能

#### プライベートページ自動検出
本拡張機能は以下のHTTPヘッダーを分析し、プライベートページを自動的に検出します：
- `Cache-Control: private` ヘッダー
- `Cache-Control: no-store` + `Set-Cookie` ヘッダーの組み合わせ
- `Set-Cookie` + `Vary: Cookie` ヘッダーの組み合わせ
- `Authorization` ヘッダー

> [!NOTE]
> `Cache-Control: no-cache` は検出対象に含まれません。これはニュースサイトなどでもよく使用されるディレクティブであり、必ずしもプライベートなコンテンツを示すものではありません。

##### プライバシーステータスコード

プライベートページ検出時に割り当てられるステータスコードは以下の通りです：

| コード | 説明 | 検出対象 |
|------|------|----------|
| PSH-1001 | `Cache-Control: private` または `no-store` + `Set-Cookie` 検出 | HTTPレスポンスヘッダー |
| PSH-2001 | `Set-Cookie` + `Vary: Cookie` 検出 | HTTPレスポンスヘッダー |
| PSH-3001 | `Authorization` ヘッダー検出 | HTTPリクエストヘッダー |
| PSH-9001 | 不明な理由 | その他のプライベート判定 |

> [!NOTE]
> PSH-1001 は `Cache-Control: private` 単独、または `Cache-Control: no-store` と `Set-Cookie` の組み合わせを検出します。`no-store` 単独ではプライベート判定されません。

検出されたページは、以下の方法で保護されます：

1. **手動記録時**:
   - 確認ダイアログが表示され、以下の選択肢が提供されます
     - キャンセル
     - 今回のみ保存（強制保存）
     - ドメイン全体を許可して保存（ホワイトリスト追加）
     - このパスのみ許可して保存（パスホワイトリスト追加）

2. **自動記録時**:
   - プライベートページは「保留中のページ」として一時保存されます
   - 後からポップアップUIで一括処理が可能：
     - 選択したページを保存
     - 選択したドメインをホワイトリストに追加して保存
     - 選択したページを破棄
   - 保留中のページは24時間後に自動的に期限切れとなります

#### 保留ページデータ
プライベート判定されたページを一時保存するために、以下のデータがローカルストレージに保存されます：
- ページURL
- ページタイトル
- 検出理由（cache-control / set-cookie / authorization）
- 検出されたヘッダー値（1024文字まで）
- タイムスタンプ
- 有効期限（24時間後）

### マスターパスワード保護

設定のエクスポート/インポート時に、**マスターパスワード**でファイルを暗号化することができます。

- **有効にする方法**: ダッシュボード → Privacy タブ → 「マスターパスワード保護を有効にする」をオンにして、パスワードを設定します
- **暗号化方式**: AES-GCM（業界標準）+ PBKDF2による鍵導出（100,000回反復）
- **適用範囲**: エクスポートされたJSONファイルに含まれるすべての設定（APIキーを含む）
- **注意**: パスワードを忘れた場合、暗号化されたエクスポートファイルを復号することはできません

通常の使用（拡張機能内でのAPIキー保存）には、マスターパスワードとは別の自動暗号化機構が使用されており、ユーザーの操作は不要です。

### 第三者サービス
本拡張機能は、以下の第三者サービスと通信します：

1. **AI プロバイダー (ユーザーが選択)**: ページ内容の要約を生成するため。以下のいずれかが使用されます:
   - **Google Gemini API**: データはGoogleのプライバシーポリシーに従って処理されます。
   - **OpenAI互換API** (Groq, OpenAI, Anthropic等): データは各プロバイダーのポリシーに従って処理されます。
   - **ローカルLLM** (Ollama, LM Studio等): データはユーザーのローカル環境内でのみ処理されます。
2. **ユーザーのローカル Obsidian**: デイリーノートに履歴を保存するため。これはユーザー自身のローカルサーバーです。

### 拡張機能の権限について
本拡張機能は以下の権限を必要とします：

1. **全Webサイトへのアクセス権限 (`<all_urls>`)**:
   - 訪問したページのコンテンツを抽出するために必要です
   - ページのタイトル、URL、本文テキストを取得します
   - このデータはAI要約生成とObsidianへの保存にのみ使用されます

2. **Webリクエスト監視権限 (`webRequest`)**:
   - HTTPレスポンスヘッダーを解析し、プライベートページを自動検出するために必要です
   - `Cache-Control: no-store`、`Set-Cookie`、`Authorization` ヘッダーを検出します
   - プライベートページ（銀行、メール等）での誤った記録を防ぐために使用されます
   - **重要**: リクエストの内容は変更・ブロックしません（読み取りのみ）

3. **ネットワーク接続権限 (`connect-src`)**:
   - Obsidian Local REST API（ローカルサーバー）への接続
   - ユーザーが選択したAIプロバイダーAPIへの接続（Google Gemini API、OpenAI互換API等）
   - ユーザーが指定するカスタムAPIエンドポイントへの接続

**重要**: すべてのデータ処理はユーザーの明示的な設定に基づいて行われます。開発者はいかなるデータも収集しません。

---

## English

### Overview
Obsidian Smart History ("the Extension") is committed to protecting your privacy. This policy explains what data we collect, how we use it, and your rights.

### Data Collection
The Extension collects the following data **locally on your device**:
- Browsing history data (URLs, titles, duration, scroll depth, content)
- Configuration data (API keys, connection settings)

### Storage
- All configuration data is stored in **Chrome's local storage** on your device.
- Browsing history entries are saved to **your local Obsidian vault**. Additionally, metadata for recent entries (last 7 days, up to 10,000 entries — URL, title, record type, etc.) is also stored in **Chrome's local storage** and viewable in the extension's Dashboard.
- **No data is stored on our servers.**

### How Data Is Used
1. **Page content**: Sent to the AI provider API selected by the user (Google Gemini, OpenAI-compatible APIs, etc.) to generate summaries.
2. **Browsing history**: Saved to your Obsidian vault via the Local REST API. Metadata for the last 7 days (URL, title, record type, PII mask count, etc.) is also stored in Chrome's local storage and can be viewed and managed in the extension's Dashboard (History tab).
3. **Settings**: Used to connect to Obsidian and the AI provider API.

### Master Password Protection

You can encrypt exported settings files with a **master password**.

- **How to enable**: Dashboard → Privacy tab → Enable "Master Password Protection" and set a password
- **Encryption**: AES-GCM (industry standard) + PBKDF2 key derivation (100,000 iterations)
- **Scope**: All settings in the exported JSON file, including API keys
- **Note**: If you forget your password, encrypted export files cannot be decrypted

For regular use (storing API keys within the extension), a separate auto-encryption mechanism is used that requires no user action.

### Third-Party Services
1. **AI Provider (User-Selected)**: Used to generate summaries. The following options are available:
   - **Google Gemini API**: Data is processed according to Google's privacy policy.
   - **OpenAI-Compatible APIs** (Groq, OpenAI, Anthropic, etc.): Data is processed according to each provider's policy.
   - **Local LLMs** (Ollama, LM Studio, etc.): Data is processed entirely within your local environment.
2. **Your Local Obsidian Instance**: Used to save history. This is your own local server.

### Private Page Protection

#### Automatic Private Page Detection
The extension analyzes the following HTTP headers to automatically detect private pages:
- `Cache-Control: private` header
- `Cache-Control: no-store` + `Set-Cookie` header combination
- `Set-Cookie` + `Vary: Cookie` header combination
- `Authorization` header

> [!NOTE]
> `Cache-Control: no-cache` is not included in the detection criteria. This directive is commonly used on news sites and does not necessarily indicate private content.

##### Privacy Status Codes

The following status codes are assigned when private pages are detected:

| Code | Description | Detection Target |
|------|-------------|------------------|
| PSH-1001 | `Cache-Control: private` or `no-store` + `Set-Cookie` detected | HTTP response header |
| PSH-2001 | `Set-Cookie` + `Vary: Cookie` detected | HTTP response header |
| PSH-3001 | `Authorization` header detected | HTTP request header |
| PSH-9001 | Unknown reason | Other private detection |

> [!NOTE]
> PSH-1001 detects `Cache-Control: private` standalone, or `Cache-Control: no-store` combined with `Set-Cookie`. `no-store` alone does not trigger private detection.

Detected pages are protected as follows:

1. **Manual Recording**:
   - A confirmation dialog is displayed with the following options:
     - Cancel
     - Save once (force save)
     - Save and allow entire domain (add to whitelist)
     - Save and allow this path only (add path to whitelist)

2. **Auto Recording**:
   - Private pages are temporarily saved as "Pending Pages"
   - Later you can batch-process from the popup UI:
     - Save selected pages
     - Add selected domains to whitelist and save
     - Discard selected pages
   - Pending pages automatically expire after 24 hours

#### Pending Page Data
The following data is temporarily stored locally for pages detected as private:
- Page URL
- Page title
- Detection reason (cache-control / set-cookie / authorization)
- Detected header value (up to 1024 characters)
- Timestamp
- Expiration time (24 hours later)

### Extension Permissions
This extension requires the following permissions:

1. **Access to All Websites (`<all_urls>`)**:
   - Required to extract content from visited pages
   - Collects page titles, URLs, and body text
   - Data is used solely for AI summarization and saving to Obsidian

2. **Web Request Monitoring (`webRequest`)**:
   - Required to analyze HTTP response headers for automatic private page detection
   - Detects `Cache-Control: no-store`, `Set-Cookie`, and `Authorization` headers
   - Used to prevent accidental recording of private pages (banking, email, etc.)
   - **Important**: Does not modify or block requests (read-only)

3. **Network Connection Permissions (`connect-src`)**:
   - Connection to Obsidian Local REST API (local server)
   - Connection to user-selected AI provider APIs (Google Gemini, OpenAI-compatible APIs, etc.)
   - Connection to user-specified custom API endpoints

**Important**: All data processing is based on your explicit configuration. The developer does not collect any data.

---

## 権利 / Rights
すべてのデータはローカルに保存されており、拡張機能のアンインストールやObsidian内のノート削除によっていつでも破棄できます。

All data is stored locally and can be deleted by uninstalling the extension or manually deleting notes in Obsidian.
