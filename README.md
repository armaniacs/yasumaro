# スマートな履歴管理 / Obsidian Smart History

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要
ブラウザの閲覧履歴を、AIによる要約付きでObsidianのデイリーノートに自動保存するChrome拡張機能です。

### オリジナルの紹介
オリジナルは https://note.com/izuru_tcnkc/n/nd0a758483901 で紹介されている記事です。

オリジナルからの変更点として、OpenAI互換APIをサポートするようになりました。つまり、GroqやOllamaなども使えるようになりました。

### 特徴
- 🤖 **AIによる要約**: Gemini API または Open AI Compatible APIを使用して、ウェブページの内容を簡潔に要約します。
- 📝 **Obsidian連携**: 閲覧履歴を直接Obsidianのデイリーノートに保存します。
- 🎯 **スマート検出**: 実際に読んだページのみを保存します（滞在時間とスクロール深度に基づきます）。
- 📂 **整理された保存**: デイリーノート内に専用の「ブラウザ閲覧履歴」セクションを自動作成し、管理します。
- ⚙️ **カスタマイズ可能**: 最小滞在時間、スクロール深度、API設定などを自由に構成できます。
- 🖱️ **手動記録機能**: 「今すぐ記録」ボタンで現在のページを即座に記録できます。重複チェックなしで同じページを複数回記録可能です。
- 📱 **改良されたUI**: メイン画面と設定画面を分離し、ハンバーガーメニューから簡単にアクセスできます。
- 🌐 **ドメインフィルター**: ホワイトリスト/ブラックリストで記録するドメインを制御できます。ワイルドカードパターンに対応。
- 🚫 **uBlock Origin形式フィルター**: EasyListなどの既存のuBlockフィルターリストを直接インポートして使用できます。
- ✏️ **AIプロンプトカスタマイズ**: AIへの要約指示プロンプトを自由に編集・保存できます。プロバイダーごとに異なるプロンプトを設定可能。
- 🔒 **プライバシー保護**: 4つのプライバシーモードを選択し、個人情報をマスクしてからAIに送信可能。プライベートページ（銀行・メール等）を自動検出し、誤った記録を防止。詳細は [PRIVACY.md](PRIVACY.md) を参照。

### 必要なもの
- [Obsidian](https://obsidian.md/) と [Local REST API プラグイン](https://github.com/coddingtonbear/obsidian-local-rest-api)
- 好きなAIプロバイダー（お好きのものをどうぞ）
   - [Google Gemini API キー](https://aistudio.google.com/app/apikey)（無料枠あり）
   - [Groq](https://console.groq.com/keys)（無料枠あり）
   - [OpenAI](https://platform.openai.com/api-keys)（無料枠あり）
   - ollamaも多分動きます。


### インストール方法
ビルド済みの拡張機能をインストールするには、以下の手順に従ってください。

1. このリポジトリをクローンまたはダウンロードします:
   ```bash
   git clone https://github.com/izuru-tcnkc/obsidian-smart-history.git
   cd obsidian-smart-history
   ```

2. 依存パッケージをインストールします:
   ```bash
   npm install
   ```

3. 拡張機能をビルドします:
   ```bash
   npm run build
   ```

4. Chromeを開き、`chrome://extensions` にアクセスします。

5. 右上の「デベロッパーモード」を有効にします。

6. 「パッケージ化されていない拡張機能を読み込む」をクリックし、**`dist` フォルダ**を選択します。

### 使い方

#### 自動記録
- ウェブページを5秒以上閲覧し、50%以上スクロールすると自動的に記録されます
- 重複URLは記録されません（同じページは1日1回のみ）

#### 手動記録
1. ツールバーの拡張機能アイコンをクリックしてメイン画面を開きます
2. 現在のページ情報が表示されます
3. 「📝 今すぐ記録」ボタンをクリックすると、即座に現在のページが記録されます
4. 手動記録では重複チェックがないため、同じページを何度でも記録できます

### 設定
1. ツールバーの拡張機能アイコンをクリックします。
2. メイン画面の右上にある「☰」メニューボタンをクリックして設定画面を開きます。
3. 以下の設定を入力してください：
   - **Obsidian API Key**: ObsidianのLocal REST API設定で取得したキー
   - **Protocol/Port**: Obsidian Local REST APIのプロトコルとポート（通常はhttps/27123）
   - **Daily Notes Path**: デイリーノートの保存先フォルダ（例: `092.Daily`）
   - **AI Provider**: 使用するAIサービスを選択（Gemini、OpenAI互換など）
   - **各AIプロバイダーのAPIキーとモデル設定**
4. 「Save & Test Connection」をクリックし、「Test Connection」で接続を確認してください。

#### ドメインフィルター設定
設定画面の「ドメインフィルター」タブで、記録するドメインを制御できます：

- **無効**: すべてのドメインを記録します
- **ホワイトリスト**: 指定したドメインのみ記録します
- **ブラックリスト**: 指定したドメインを除外して記録します

ドメインリストではワイルドカードも使用できます（例: `*.example.com`）。「現在のページドメインを追加」ボタンで簡単にドメインを追加できます。

#### AIプロンプトのカスタマイズ

設定画面の「AIプロンプト」タブで、AI要約時のプロンプトをカスタマイズできます。プロバイダーごとに異なるプロンプトを設定したり、複数のプロンプトを保存して切り替えたりすることができます。

デフォルトのプロンプト、各設定項目の説明、カスタマイズ例は [USER-GUIDE-AI-PROMPT.md](USER-GUIDE-AI-PROMPT.md) を参照してください。

#### uBlock Origin形式フィルターの使用
設定画面の「ドメインフィルター」タブで、「フィルター形式」を「uBlock Origin 形式」に切り替えることで、uBlock Origin形式のフィルターリストを使用できます。

フィルターの入力方法:
- テキストエリアに直接uBlock形式のフィルターを貼り付ける
- ローカルの.txtファイルから読み込む
- ドラッグ＆ドロップでファイルを読み込む
- URLからフィルターリストをダウンロードする

詳細な使い方は [USER-GUIDE-UBLOCK-IMPORT.md](USER-GUIDE-UBLOCK-IMPORT.md) を参照してください。


### Obsidianへの追加の仕組みは以下のようになっています（src/background/obsidianClient.js）。

仕組み: Read-Modify-Write (読み込み -> 加工 -> 書き込み)

保存先の特定:
設定された「Daily Note Path」と現在の日付から、保存すべきファイルパス（例: 092.Daily/2026-01-15.md）を特定します。
既存ノートの読み込み (GET):
Obsidian Local REST APIを使用して、そのファイルの現在の内容をテキストとして取得します。
内容の追記:
ファイル内に # 🌐 ブラウザ閲覧履歴 という見出しがあるか探します。
ある場合: そのセクションの末尾（次の見出しの手前）に新しい要約を挿入します。
ない場合: ファイルの末尾に新しい見出しを作成し、そこに追記します。
ノートの更新 (PUT):
加工した全体の内容でファイルを上書き保存します。
補足:

ファイル全体を取得して書き直す方式のため、Obsidian側でまさにその瞬間に同じファイルを編集していると、競合などで更新内容が失われるリスクがわずかにあります（通常の使用では稀です）。
現在は「セクションの末尾」に追加されます。


---

## English

### Overview
A Chrome extension that automatically saves your browsing history to Obsidian with AI-generated summaries.

### Features
- 🤖 **AI-Powered Summaries**: Automatically generates concise summaries of web pages using Google's Gemini API or OpenAI-compatible APIs
- 📝 **Obsidian Integration**: Saves browsing history directly to your Obsidian daily notes
- 🎯 **Smart Detection**: Only saves pages you actually read (based on scroll depth and time spent)
- 📂 **Organized Storage**: Automatically creates and maintains a dedicated "Browser History" section in your daily notes
- ⚙️ **Customizable**: Configure minimum visit duration, scroll depth, and API settings
- 🖱️ **Manual Recording**: Record any page instantly with the "Record Now" button. No duplicate URL restrictions - record the same page multiple times.
- 📱 **Improved UI**: Separated main screen and settings with easy hamburger menu access.
- 🌐 **Domain Filtering**: Control which domains to record with whitelist/blacklist support. Wildcard patterns supported.
- 🚫 **uBlock Origin Format Filters**: Import and use existing uBlock filter lists like EasyList directly.
- ✏️ **AI Prompt Customization**: Edit and save custom AI summarization prompts. Configure different prompts per provider.
- 🔒 **Privacy Protection**: Select from 4 privacy modes and mask PII before sending to AI. Automatically detects private pages (banking, email, etc.) to prevent accidental recording. See [PRIVACY.md](PRIVACY.md) for details.

### Requirements
- [Obsidian](https://obsidian.md/) with [Local REST API plugin](https://github.com/coddingtonbear/obsidian-local-rest-api)
- [Google Gemini API key](https://aistudio.google.com/app/apikey) (free tier available)

### Installation
To install the extension, follow these steps:

1. Clone or download this repository:
   ```bash
   git clone https://github.com/izuru-tcnkc/obsidian-smart-history.git
   cd obsidian-smart-history
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Open Chrome and navigate to `chrome://extensions`

5. Enable "Developer mode" in the top right

6. Click "Load unpacked" and select the **`dist` folder**

### Usage

#### Automatic Recording
- Pages are automatically recorded when you browse for 5+ seconds and scroll 50%+ of the page
- Duplicate URLs are not recorded (same page only once per day)

#### Manual Recording
1. Click the extension icon to open the main screen
2. Current page information will be displayed
3. Click the "📝 Record Now" button to instantly record the current page
4. Manual recording has no duplicate restrictions - record the same page multiple times

### Setup
1. Click the extension icon in your toolbar
2. Click the "☰" menu button in the top right to open settings
3. Configure settings:
   - **Obsidian API Key**: Key from Obsidian's Local REST API settings
   - **Protocol/Port**: Obsidian Local REST API protocol and port (usually https/27123)
   - **Daily Notes Path**: Folder path for daily notes (e.g., `092.Daily`)
   - **AI Provider**: Select your preferred AI service (Gemini, OpenAI Compatible, etc.)
   - **API keys and model settings for each AI provider**
4. Click "Save & Test Connection" to verify connectivity.

#### Domain Filter Settings
In the "Domain Filter" tab of the settings screen, you can control which domains to record:

- **Disabled**: Record all domains
- **Whitelist**: Only record specified domains
- **Blacklist**: Record all domains except those specified

You can use wildcards in the domain list (e.g., `*.example.com`). Use the "Add Current Domain" button to easily add domains.

#### Customizing AI Prompts

In the "AI Prompt" tab of the settings screen, you can customize the prompts used for AI summarization. Configure different prompts per provider or save multiple prompts to switch between them as needed.

For default prompt values, field descriptions, and customization examples, see [USER-GUIDE-AI-PROMPT.md](USER-GUIDE-AI-PROMPT.md).

#### Using uBlock Origin Format Filters
In the "Domain Filter" tab of the settings screen, switch the "Filter Format" to "uBlock Origin Format" to use uBlock Origin format filter lists.

Ways to input filters:
- Paste uBlock format filters directly into the text area
- Load from a local .txt file
- Drag and drop a file to load
- Download a filter list from a URL

For detailed usage instructions, please refer to [USER-GUIDE-UBLOCK-IMPORT.md](USER-GUIDE-UBLOCK-IMPORT.md).

---

## Privacy / プライバシー
データはすべてローカルに保存されます。詳細は [PRIVACY.md](PRIVACY.md) を参照してください。

All data is stored locally. See [PRIVACY.md](PRIVACY.md) for details.

## License / ライセンス
MIT License
