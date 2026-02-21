# プライバシーポリシー / Privacy Policy

**最終更新日: 2025年12月27日 / Last Updated: December 27, 2025**

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
   - Google Gemini API キー
   - 設定情報（最小滞在時間、スクロール深度など）

### データの保存場所
- すべての設定データは、デバイス上の **Chrome ローカルストレージ** に保存されます。
- 閲覧履歴は、ユーザー自身の **ローカル Obsidian Vault** に保存されます。
- **いかなるデータも開発者のサーバーには保存されません。** 開発者はサーバーを運営していません。

### データの使用方法
1. **ページ内容**: 要約を作成するために Google Gemini API、またはユーザーが指定した OpenAI 互換 API (Groq, OpenAI, Local LLM等) に送信されます。
2. **閲覧履歴**: Local REST API を通じて Obsidian Vault に保存されます。
3. **設定**: Obsidian および Gemini API への接続に使用されます。

### 第三者サービス
本拡張機能は、以下の第三者サービスと通信します：

1. **Google Gemini API**: ページ内容の要約を生成するため。データはGoogleのプライバシーポリシーに従って処理されます。
2. **ユーザー指定のAIプロバイダー (OpenAI互換API)**: ユーザーが設定した場合、要約生成のために使用されます（Groq, OpenAI, Ollama等）。データの処理は各プロバイダーのポリシー、またはローカル環境の仕様に従います。
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
   - Google Gemini APIへの接続
   - ユーザーが設定したOpenAI互換APIへの接続
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
- Browsing history entries are saved to **your local Obsidian vault**.
- **No data is stored on our servers.**

### Third-Party Services
1. **Google Gemini API**: Used to generate summaries. Data is sent according to Google's privacy policy.
2. **User-Specified AI Provider (OpenAI Compatible API)**: If configured (e.g., Groq, OpenAI, Ollama), content is sent to generate summaries. Data handling is subject to the respective provider's policy or your local environment.
2. **Your Local Obsidian Instance**: Used to save history. This is your own local server.

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
   - Connection to Google Gemini API
   - Connection to user-configured OpenAI-compatible APIs
   - Connection to user-specified custom API endpoints

**Important**: All data processing is based on your explicit configuration. The developer does not collect any data.

---

## 権利 / Rights
すべてのデータはローカルに保存されており、拡張機能のアンインストールやObsidian内のノート削除によっていつでも破棄できます。

All data is stored locally and can be deleted by uninstalling the extension or manually deleting notes in Obsidian.
