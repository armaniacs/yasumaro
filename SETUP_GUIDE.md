# 完全セットアップガイド / Complete Setup Guide - Obsidian Weave

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
    - OpenAI互換のAPIキー (Groq, OpenAI, Anthropic, Together AIなど)
    - Google アカウント (Gemini API用)
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
- 右上の「⚙」アイコンをクリックしてダッシュボード（設定画面）を開きます

#### 手動記録機能
- 自動記録の条件を満たさなくても、任意のタイミングでページを記録できます
- 重複チェックがないため、同じページを何度でも記録可能です
- 記録されるとChrome通知とステータスメッセージで確認できます

#### ダッシュボードへのアクセス
右上の「⚙」アイコンをクリックすると、新しいタブでダッシュボードが開きます。ダッシュボードには以下のタブがあります：

- **一般 (General)**: Obsidian接続設定、AIプロバイダー設定
- **ドメインフィルター (Domain Filter)**: ホワイトリスト/ブラックリストの管理
- **AIプロンプト (AI Prompt)**: カスタムプロンプトの作成・管理
- **プライバシー (Privacy)**: PIIマスク設定、プライベートページ検出の動作設定、マスターパスワード保護
- **履歴 (History)**: 記録済みURLの一覧確認・管理

#### 1. Obsidian設定
*   **Obsidian API Key**: ステップ1でコピーしたキーを入力。
*   **Protocol/Port**: デフォルト (`https`, `27124`) のままで通常はOKです。
*   **Daily Note Path**: デイリーノートが保存されているフォルダパスを指定します（例: `092.Daily` や `Journal`）。日付ファイル（`YYYY-MM-DD.md`）がこのフォルダ直下に作成/追記されます。

#### 2. AIプロバイダー設定
「AI Provider」のプルダウンから使用するサービスを選択します。

**A. OpenAI Compatible (Groq, OpenAI, Anthropicなど・推奨)**
*   **Base URL**: APIのエンドポイントURL。
    *   Groq: `https://api.groq.com/openai/v1`
    *   OpenAI: `https://api.openai.com/v1`
    *   Anthropic: `https://api.anthropic.com/v1`
*   **API Key**: 各サービスのAPIキー。
*   **Model Name**: 使用するモデル名（例: `llama-3.3-70b-versatile`, `gpt-4o-mini`）。

**B. Google Gemini**
*   **API Key**: GeminiのAPIキーを入力。
*   **Model Name**: `gemini-1.5-flash` (推奨) など。

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

#### 💡 ローカルLLM (LM Studio / Ollama) の設定

ローカルLLMを使用する場合、AIプロバイダーには「OpenAI Compatible 2」を選択してください。

**LM Studio の場合:**
*   **Base URL**: `http://localhost:1234/v1`
*   **API Key**: 不要（空欄）
*   **Model Name**: LM StudioのModelsタブで確認（例: `llama3.2`）
*   サーバーを起動後、ダッシュボードの「LM Studio」プリセットボタンをクリックで自動入力可能

**Ollama の場合:**
*   **Base URL**: `http://localhost:11434/v1`
*   **API Key**: 不要（空欄）
*   **Model Name**: `ollama list` で確認（例: `llama3.2`, `mistral`）
*   サーバーを起動: `ollama serve`
*   ダッシュボードの「Ollama」プリセットボタンをクリックで自動入力可能

詳しいセットアップ手順:
```bash
# Ollama インストール（macOS）
brew install ollama

# サーバー起動
ollama serve

# モデルの取得と確認
ollama pull llama3.2
ollama list
```

---

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

- **エクスポート**: 現在の全設定をJSONファイルとしてダウンロードします。ファイル名には日時が含まれます（例: `obsidian-weave-settings-20240101-120000.json`）。
  - **⚠️ 注意**: APIキー（Obsidian API Key、各AIプロバイダーのAPI Key）はセキュリティ上の理由からエクスポートに含まれません。
- **インポート**: エクスポートしたJSONファイルを選択すると、設定内容のプレビューが表示されます。確認後「インポート」をクリックすると、現在の設定が上書きされます。
  - APIキーは上書きされず、既存の設定が保持されます。

端末の移行やバックアップにご活用ください（APIキーは別途再入力が必要です）。

#### 5. プライバシー設定
「プライバシー」タブで、プライバシーに関する詳細な動作を設定できます。

**自動保存時のプライバシー動作** (`Dashboard → Privacy → Confirmation Settings`):
- **save（デフォルト）**: プライベートページを通常通り保存します
- **skip**: プライベートページを保存せず「スキップ済み」として履歴に残します。後から手動で保存することも可能です
- **confirm**: プライベートページ検出時にChrome通知で確認を求めます（「保存」または「スキップ」を選択）

**手動記録時のマスキング確認**: 手動保存時に、AIへの送信前にPIIマスキング結果を確認するダイアログを表示するかどうかを設定できます。

**マスターパスワード保護** (`Dashboard → Privacy → Master Password Protection`):
- 「マスターパスワード保護を有効にする」をオンにするとパスワード設定画面が表示されます
- 設定後、設定のエクスポート/インポート時にAES-GCMでファイルが暗号化されます
- APIキーなどの機密情報を含む設定を安全に移行・バックアップする際に使用してください
- パスワード強度は設定時にリアルタイム表示（Weak / Medium / Strong）で確認できます

#### 6. ダッシュボード（履歴管理）
`Dashboard → History` タブで、記録されたURLの履歴を確認・管理できます。

**フィルター**:
- **All**: 全ての記録を表示
- **Auto**: 自動記録されたページのみ表示
- **Manual**: 手動記録されたページのみ表示
- **Skipped**: プライバシー検出によりスキップされたページを表示。「今すぐ記録」ボタンで手動保存が可能
- **🔒 Masked**: PIIマスキングが行われた記録のみ表示

**保持ポリシー**: 過去7日間の記録（最大10,000件）が保持されます。

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
    - OpenAI Compatible Provider (Groq, OpenAI, Anthropic, etc.)
    - Google Account (for Gemini)
    - Local LLM (Ollama, LM Studio, etc.)

### Step 1: Obsidian Setup
1. **Install Local REST API Plugin**
   - Settings → Community Plugins → Browse → Search "Local REST API", install and enable.
2. **Copy API Key**
   - Settings → Local REST API → Copy the "API Key".

### Step 2: Get AI API Key
*   **Groq (Recommended)**: https://console.groq.com/keys
*   **OpenAI**: https://platform.openai.com/api-keys
*   **Anthropic**: https://console.anthropic.com/
*   **Google Gemini**: https://aistudio.google.com/
*   **Local LLM**: No API key needed (start your server, e.g., `ollama serve`)

### Step 3: Install Chrome Extension
1. Open `chrome://extensions`.
2. Enable "Developer mode" (top right).
3. Click "Load unpacked" and select the extension folder.

### Step 4: Configure Settings
Click the extension icon to open the main screen.

#### Main Screen
- Current page title and URL are displayed
- "📝 Record Now" button allows manual recording
- Click the "⚙" icon in the top right to open the Dashboard (settings)

#### Manual Recording Feature
- Record any page at any time, regardless of automatic recording conditions
- No duplicate URL restrictions - record the same page multiple times
- Chrome notifications and status messages confirm successful recording

#### Accessing the Dashboard
Click the "⚙" icon in the top right to open the Dashboard in a new tab. The Dashboard has the following tabs:

- **General**: Obsidian connection settings and AI provider settings
- **Domain Filter**: Manage whitelist/blacklist rules
- **AI Prompt**: Create and manage custom prompts
- **Privacy**: PII masking settings, private page detection behavior, and master password protection
- **History**: View and manage recorded URL history

#### 1. Obsidian Settings
*   **Obsidian API Key**: Paste the key from Step 1.
*   **Daily Note Path**: Enter the folder path where your daily notes are stored (e.g., `092.Daily`).

#### 2. AI Provider Settings
Select your preferred provider from the dropdown.

*   **OpenAI Compatible (Recommended)**: Supports Groq, OpenAI, Anthropic, and more.
    *   **Base URL**: e.g., `https://api.groq.com/openai/v1`
    *   **API Key**: Your provider's key.
    *   **Model Name**: e.g., `llama-3.3-70b-versatile`, `gpt-4o-mini`.
*   **Google Gemini**: Enter API Key and Model (e.g., `gemini-1.5-flash`).
*   **OpenAI Compatible 2**: Use this for a secondary provider like a local LLM (`http://localhost:11434/v1`).

#### 💡 Local LLM (LM Studio / Ollama) Setup

To use a local LLM, select "OpenAI Compatible 2" as your AI provider.

**LM Studio:**
*   **Base URL**: `http://localhost:1234/v1`
*   **API Key**: Not required (leave empty)
*   **Model Name**: Check in LM Studio's Models tab (e.g., `llama3.2`)
*   After starting the server, click the "LM Studio" preset button in the dashboard for auto-fill

**Ollama:**
*   **Base URL**: `http://localhost:11434/v1`
*   **API Key**: Not required (leave empty)
*   **Model Name**: Check with `ollama list` (e.g., `llama3.2`, `mistral`)
*   Start server: `ollama serve`
*   Click the "Ollama" preset button in the dashboard for auto-fill

Setup instructions:
```bash
# Install Ollama (macOS)
brew install ollama

# Start server
ollama serve

# Pull and list models
ollama pull llama3.2
ollama list
```

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

- **Export**: Downloads all current settings as a JSON file. The filename includes a timestamp (e.g., `obsidian-weave-settings-20240101-120000.json`).
  - **⚠️ Note**: For security reasons, API keys (Obsidian API Key and AI provider API keys) are NOT included in the export.
- **Import**: Select a previously exported JSON file. A preview of the settings is shown before applying. Click "Import" to overwrite the current settings.
  - API keys are NOT overwritten - existing settings are preserved.

Useful for migrating settings to another device or creating backups (you will need to re-enter API keys).

#### 5. Privacy Settings
In the "Privacy" tab, you can configure detailed privacy behavior.

**Auto-save Privacy Behavior** (`Dashboard → Privacy → Confirmation Settings`):
- **save (default)**: Saves private pages as usual
- **skip**: Does not save private pages; they appear as "Skipped" in history for later manual save
- **confirm**: Shows a Chrome notification asking for confirmation (Save or Skip) when a private page is detected

**Manual Recording Masking Confirmation**: Configure whether to show a dialog to review PII masking results before sending to AI during manual saves.

**Master Password Protection** (`Dashboard → Privacy → Master Password Protection`):
- Enable "Master Password Protection" to set a password for encrypting exported settings files
- Once configured, settings exports/imports are automatically encrypted with AES-GCM
- Use this when migrating or backing up settings that include API keys and other sensitive data
- Password strength is shown in real time during setup (Weak / Medium / Strong)

#### 6. Dashboard (History Management)
In the `Dashboard → History` tab, you can view and manage your recording history.

**Filters**:
- **All**: Shows all records
- **Auto**: Shows only automatically recorded pages
- **Manual**: Shows only manually recorded pages
- **Skipped**: Shows pages skipped by privacy detection. Use "Record Now" to manually save them
- **🔒 Masked**: Shows only records where PII masking was applied

**Retention Policy**: Records from the past 7 days (up to 10,000 entries) are retained.
