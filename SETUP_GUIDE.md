# 完全セットアップガイド / Complete Setup Guide - Obsidian Smart History

[日本語](#日本語) | [English](#english)

---

## 日本語

### 📋 目次
1. [必要なもの](#必要なもの)
2. [ステップ1: Obsidianのセットアップ](#ステップ1-obsidianのセットアップ)
3. [ステップ2: AI APIキーの取得](#ステップ2-ai-apiキーの取得)
4. [ステップ3: Chrome拡張機能のインストール](#ステップ3-chrome拡張機能のインストール)
5. [ステップ4: 拡張機能の設定](#ステップ4-拡張機能の設定)

### 必要なもの
- **Obsidian**: https://obsidian.md/
- **Google Chrome** ブラウザ
- **AIプロバイダー** (以下のいずれか、または複数)
    - Google アカウント (Gemini API用)
    - OpenAI互換のAPIキー (Groq, OpenAI, Together AIなど)
    - ローカルLLM (Ollama, LM Studioなど)

### ステップ1: Obsidianのセットアップ
1. **Local REST APIプラグインのインストール**
   - 設定 → コミュニティプラグイン → 閲覧 → 「Local REST API」を検索してインストール・有効化。
2. **APIキーをコピー**
   - 設定 → Local REST API → 「API Key」をコピーして控えておきます。

### ステップ2: AI APIキーの取得
使用したいAIに合わせてAPIキーを取得してください。

*   **Google Gemini**: https://aistudio.google.com/ から取得。
*   **Groq (OpenAI互換)**: https://console.groq.com/keys から取得。
*   **OpenAI**: https://platform.openai.com/api-keys から取得。
*   **ローカルLLM**: キー不要の場合が多いですが、サーバーを起動しておく必要があります（例: `ollama serve`）。

### ステップ3: Chrome拡張機能のインストール
1. `chrome://extensions` を開きます。
2. 右上の「デベロッパーモード」をオンにします。
3. 「パッケージ化されていない拡張機能を読み込む」からフォルダを選択します。

### ステップ4: 拡張機能の設定
拡張機能のアイコンをクリックしてメイン画面を開きます。

#### メイン画面
- 現在開いているページのタイトルとURLが表示されます
- 「📝 今すぐ記録」ボタンで手動記録ができます
- 右上の「☰」メニューボタンから設定画面にアクセスします

#### 手動記録機能
- 自動記録の条件を満たさなくても、任意のタイミングでページを記録できます
- 重複チェックがないため、同じページを何度でも記録可能です
- 記録されるとChrome通知とステータスメッセージで確認できます

#### 設定画面
右上の「☰」メニューボタンをクリックして設定画面を開きます。

#### 1. Obsidian設定
*   **Obsidian API Key**: ステップ1でコピーしたキーを入力。
*   **Protocol/Port**: デフォルト (`http`, `27123`) のままで通常はOKです。
*   **Daily Note Path**: デイリーノートが保存されているフォルダパスを指定します（例: `092.Daily` や `Journal`）。日付ファイル（`YYYY-MM-DD.md`）がこのフォルダ直下に作成/追記されます。

#### 2. AIプロバイダー設定
「AI Provider」のプルダウンから使用するサービスを選択します。

**A. Google Gemini (デフォルト)**
*   **API Key**: GeminiのAPIキーを入力。
*   **Model Name**: `gemini-1.5-flash` (推奨) など。

**B. OpenAI Compatible (Groq, OpenAIなど)**
*   **Base URL**: APIのエンドポイントURL。
    *   Groq: `https://api.groq.com/openai/v1`
    *   OpenAI: `https://api.openai.com/v1`
*   **API Key**: 各サービスのAPIキー。
*   **Model Name**: 使用するモデル名（例: `openai/gpt-oss-20b`, `gpt-3.5-turbo`）。

**C. OpenAI Compatible 2 (サブ設定)**
*   ローカルLLMなどを2つ目の設定として保存できます。
*   **Base URL**: 例 `http://127.0.0.1:11434/v1` (Ollama)
*   **Model Name**: 例 `llama3`

---

#### 💡 サポートされているAIプロバイダー
セキュリティ上の理由から、以下のドメインのみが公式にサポートされています。これら以外のドメインを「Base URL」に設定すると、通信がブロックされます。

| プロバイダー | 許可ドメイン |
| :--- | :--- |
| **Google Gemini** | `generativelanguage.googleapis.com` |
| **OpenAI (公式)** | `api.openai.com` |
| **Anthropic (Claude)** | `api.anthropic.com` |
| **Groq** | `api.groq.com` |
| **Mistral AI** | `mistral.ai` |
| **OpenRouter** | `openrouter.ai`, `api.openrouter.ai` |
| **Hugging Face** | `api-inference.huggingface.co` |
| **DeepSeek** | `deepseek.com` |
| **Perplexity AI** | `perplexity.ai` |
| **Sakuraクラウド (AI API)** | `api.ai.sakura.ad.jp` |
| **その他 (LiteLLM対応)** | `deepinfra.com`, `cerebras.ai`, `sambanova.ai` 等 |
| **ローカル環境** | `localhost`, `127.0.0.1` |

---

設定を入力したら、**「Save & Test Connection」**をクリックして接続を確認してください。

#### 3. ドメインフィルター設定
「ドメインフィルター」タブで、記録するドメインを制御できます。

**フィルターモードの選択**:
- **無効**: すべてのドメインを記録します
- **ホワイトリスト**: 指定したドメインのみ記録します
- **ブラックリスト**: 指定したドメインを除外して記録します

**ドメインリストの管理**:
- 1行に1ドメインを入力します
- ワイルドカードも使用できます（例: `*.example.com`）
- 「現在のページドメインを追加」ボタンで、現在開いているページのドメインを簡単に追加できます
- wwwなどのサブドメインは自動的に除去されます（www.example.com → example.com）

**初期設定**:
- デフォルトはブラックリストモードで、一般的なサイト（Amazon、Google、Facebookなど）があらかじめ設定されています

#### 4. 設定のエクスポート・インポート
設定画面の右上にある「⋮」（三点メニュー）ボタンをクリックすると、ドロップダウンメニューが表示されます。

- **エクスポート**: 現在の全設定をJSONファイルとしてダウンロードします。ファイル名には日時が含まれます（例: `obsidian-smart-history-settings-20240101-120000.json`）。
- **インポート**: エクスポートしたJSONファイルを選択すると、設定内容のプレビューが表示されます。確認後「インポート」をクリックすると、現在の設定が上書きされます。

端末の移行やバックアップにご活用ください。

---

## English

### 📋 Table of Contents
1. [Prerequisites](#prerequisites)
2. [Step 1: Obsidian Setup](#step-1-obsidian-setup)
3. [Step 2: Get AI API Key](#step-2-get-ai-api-key)
4. [Step 3: Install Chrome Extension](#step-3-install-chrome-extension)
5. [Step 4: Configure Settings](#step-4-configure-settings)

### Prerequisites
- **Obsidian**: https://obsidian.md/
- **Google Chrome** Browser
- **AI Provider** (Any of the following)
    - Google Account (for Gemini)
    - OpenAI Compatible Provider (Groq, OpenAI, etc.)
    - Local LLM (Ollama, etc.)

### Step 1: Obsidian Setup
1. **Install Local REST API Plugin**
   - Settings → Community Plugins → Browse → Search "Local REST API", install and enable.
2. **Copy API Key**
   - Settings → Local REST API → Copy the "API Key".

### Step 2: Get AI API Key
*   **Google Gemini**: https://aistudio.google.com/
*   **Groq**: https://console.groq.com/keys
*   **OpenAI**: https://platform.openai.com/api-keys

### Step 3: Install Chrome Extension
1. Open `chrome://extensions`.
2. Enable "Developer mode" (top right).
3. Click "Load unpacked" and select the extension folder.

### Step 4: Configure Settings
Click the extension icon to open the main screen.

#### Main Screen
- Current page title and URL are displayed
- "📝 Record Now" button allows manual recording
- Click the "☰" menu button in the top right to access settings

#### Manual Recording Feature
- Record any page at any time, regardless of automatic recording conditions
- No duplicate URL restrictions - record the same page multiple times
- Chrome notifications and status messages confirm successful recording

#### Settings Screen
Click the "☰" menu button in the top right to open settings.

#### 1. Obsidian Settings
*   **Obsidian API Key**: Paste the key from Step 1.
*   **Daily Note Path**: Enter the folder path where your daily notes are stored (e.g., `092.Daily`).

#### 2. AI Provider Settings
Select your preferred provider from the dropdown.

*   **Google Gemini**: Enter API Key and Model (e.g., `gemini-1.5-flash`).
*   **OpenAI Compatible**:
    *   **Base URL**: e.g., `https://api.groq.com/openai/v1`
    *   **API Key**: Your provider's key.
    *   **Model Name**: e.g., `openai/gpt-oss-20b`.
*   **OpenAI Compatible 2**: Use this for a secondary provider like a local LLM (`http://localhost:11434/v1`).

---

#### 💡 Supported AI Providers
For security reasons, only the following domains are officially supported. Connections to other domains will be blocked.

| Provider | Allowed Domain |
| :--- | :--- |
| **Google Gemini** | `generativelanguage.googleapis.com` |
| **OpenAI (Official)** | `api.openai.com` |
| **Anthropic (Claude)** | `api.anthropic.com` |
| **Groq** | `api.groq.com` |
| **Mistral AI** | `mistral.ai` |
| **OpenRouter** | `openrouter.ai`, `api.openrouter.ai` |
| **Hugging Face** | `api-inference.huggingface.co` |
| **DeepSeek** | `deepseek.com` |
| **Perplexity AI** | `perplexity.ai` |
| **Sakura Cloud (AI API)** | `api.ai.sakura.ad.jp` |
| **Local Environments** | `localhost`, `127.0.0.1` |

---

Click **"Save & Test Connection"** to verify.

#### 3. Domain Filter Settings
In the "Domain Filter" tab, you can control which domains to record.

**Filter Mode Selection**:
- **Disabled**: Record all domains
- **Whitelist**: Only record specified domains
- **Blacklist**: Record all domains except those specified

**Domain List Management**:
- Enter one domain per line
- Wildcards are supported (e.g., `*.example.com`)
- Use the "Add Current Domain" button to easily add the domain of the currently open page
- Subdomains like www are automatically removed (www.example.com → example.com)

**Initial Settings**:
- Default is blacklist mode with common sites (Amazon, Google, Facebook, etc.) pre-configured

#### 4. Export / Import Settings
Click the "⋮" (three-dot menu) button in the top right corner of the settings screen to reveal a dropdown menu.

- **Export**: Downloads all current settings as a JSON file. The filename includes a timestamp (e.g., `obsidian-smart-history-settings-20240101-120000.json`).
- **Import**: Select a previously exported JSON file. A preview of the settings is shown before applying. Click "Import" to overwrite the current settings.

Useful for migrating settings to another device or creating backups.
