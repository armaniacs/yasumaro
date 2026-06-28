# Obsidian 連携ガイド / Obsidian Integration Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

Yasumaro が Obsidian に Web ページの情報を自動保存するには、Obsidian 側で Local REST API プラグインをセットアップし、Yasumaro ダッシュボードに API キーを登録する必要があります。このガイドでは、その手順をスクリーンショット付きで解説します。

**所要時間**: 約5〜10分

### 前提条件

- [Obsidian](https://obsidian.md/) がインストール済みであること
- Obsidian Vault が作成済みであること（Obsidian 初回起動時に作成されます）
- [Yasumaro Chrome 拡張機能](https://chromewebstore.google.com/detail/yasumaro-ai-browsing-logg/cpeammcnmfpmlkidciiobmnjnhfkmjlc) がインストール済みであること
- Google Chrome ブラウザを使用していること

---

### 1. Local REST API プラグインのインストール

Obsidian のコミュニティプラグインストアから Local REST API プラグインをインストールします。

1. Obsidian を開き、左下の **設定 ⚙️** をクリックします。
2. 左サイドバーから **コミュニティプラグイン** → **閲覧** をクリックします。
3. 検索バーに `Local REST API` と入力します。

   ![プラグイン検索画面のスクリーンショット](images/obsidian-plugin-install.png)

4. 「Local REST API」プラグインの **インストール** をクリックします。
5. インストール完了後、**有効化** をクリックします。

---

### 2. API キーのコピー

プラグインが生成する API キーをコピーします。このキーは Yasumaro と Obsidian の間の認証に使われます。

1. Obsidian 設定の左サイドバーに **Local REST API** が追加されていることを確認します。
2. **Local REST API** をクリックします。
3. **API Key** フィールドの値をコピーします（Bearer から始まる文字列。"Bearer" 自体は含みません）。

   ![APIキー表示画面のスクリーンショット](images/obsidian-api-key.png)

> **注意**: API キーは機密情報です。第三者と共有しないでください。キーが漏洩した場合は、プラグイン設定画面の **Regenerate API Key** ボタンで再生成できます。

---

### 3. プロトコルとポートの確認

デフォルトの設定でほとんどの場合問題なく動作します。以下のデフォルト値を確認してください。

| 項目 | デフォルト値 | 備考 |
|------|------------|------|
| **Protocol** | `https` | セキュリティのため https 推奨 |
| **Port** | `27124` | https のデフォルトポート |
| **HTTP Port** | `27123` | http 使用時のみ |

**設定変更が必要なケース**:
- ポート `27124` が他のアプリケーションと競合している場合のみ変更してください
- ほとんどの環境ではデフォルトのまま使用できます

---

### 4. Daily Note Path の設定

Yasumaro が Web ページの記録を保存する場所を設定します。

1. Obsidian 設定 → **Local REST API** を開きます。
2. **Daily Note Path** フィールドに、あなたの Vault 内の日次ノート（Daily Note）のパスを入力します。

例:

| Vault 構成 | Daily Note Path の値 |
|-----------|-------------------|
| 標準の Daily Notes（`DailyNotes/2026-06-29.md`） | `DailyNotes` |
| `Journal` フォルダに日付形式で保存 | `Journal` |
| `092.Daily` フォルダ | `092.Daily` |

パスの形式は、あなたの Daily Note プラグインの設定に合わせてください。Obsidian 標準の Daily Note プラグインを使用している場合、設定画面で「新建作成場所」に指定したフォルダ名を入力します。

---

### 5. Yasumaro ダッシュボードへの入力と接続テスト

1. Chrome で Yasumaro 拡張機能のアイコンを右クリック → **オプション** を選択してダッシュボードを開きます。
2. 「初期設定」パネルで **Obsidian を使う** チェックボックスをオンにします。
3. 以下の項目を入力します:

   | フィールド | 値 |
   |----------|-----|
   | **Obsidian の URL** | `https://127.0.0.1:27124`（デフォルト） |
   | **Obsidian API Key** | 手順2でコピーした API キー |
   | **Daily Note Path** | 手順4で設定したパス（例: `DailyNotes`） |

4. **接続テスト** ボタンをクリックします。
5. ✓ 接続成功と表示されれば完了です。

---

### トラブルシューティング

#### 証明書エラー（self-signed certificate）

Local REST API プラグインはデフォルトで自己署名証明書を使用するため、初回接続時に Chrome が証明書を警告することがあります。

**対処手順（macOS / Windows 共通）**:

1. Chrome で `https://127.0.0.1:27124` を開きます。
2. 「この接続ではプライバシーが保護されません」という警告画面が表示されます。
3. **「詳細設定」** をクリックします。
4. **「127.0.0.1 にアクセスする（安全でない）」** をクリックします。

これで Chrome がこのローカル証明書を記憶し、以降の Yasumaro からの接続が許可されます。

> **重要**: この操作は Obsidian Local REST API というローカル環境限定のツールに対するものです。インターネット上の一般 Web サイトの証明書警告を無視することは**絶対にしないでください**。

**どうしても証明書エラーが解消しない場合**:
- Yasumaro ダッシュボードでプロトコルを `http` に変更し、ポートを `27123` に切り替えてください（http は証明書検証を行いません）
- ただし http 通信は暗号化されないため、ローカルネットワークのセキュリティに注意してください

#### 接続タイムアウト

`接続テスト` でタイムアウトする場合:

1. Obsidian が起動していることを確認してください。
2. Local REST API プラグインが有効化されていることを確認してください。
3. URL とポート番号が正しいことを確認してください（デフォルト: `https://127.0.0.1:27124`）。
4. ファイアウォールがポート `27124` をブロックしていないか確認してください。

#### Daily Note Path が正しく認識されない

1. Obsidian の Daily Note プラグイン設定で「新建作成場所」を確認してください。
2. Vault のルートからの相対パスであることを確認してください（先頭の `/` は不要です）。
3. 日本語のフォルダ名を使用している場合、フォルダ名が正しいか確認してください。

---

### 参考リンク

- [Local REST API プラグイン（GitHub）](https://github.com/coddingtonbear/obsidian-local-rest-api)
- [Yasumaro Chrome Web Store ページ](https://chromewebstore.google.com/detail/yasumaro-ai-browsing-logg/cpeammcnmfpmlkidciiobmnjnhfkmjlc)
- [Yasumaro GitHub リポジトリ](https://github.com/armaniacs/yasumaro)

---

## English

To enable Yasumaro to automatically save web page information to Obsidian, you need to set up the Local REST API plugin in Obsidian and register the API key in the Yasumaro dashboard. This guide walks through each step with screenshots.

**Estimated time**: ~5-10 minutes

### Prerequisites

- [Obsidian](https://obsidian.md/) installed
- An Obsidian Vault created (created on first launch)
- [Yasumaro Chrome Extension](https://chromewebstore.google.com/detail/yasumaro-ai-browsing-logg/cpeammcnmfpmlkidciiobmnjnhfkmjlc) installed
- Google Chrome browser

---

### 1. Install the Local REST API Plugin

Install the Local REST API plugin from the Obsidian community plugin store.

1. Open Obsidian and click **Settings ⚙️** in the bottom-left corner.
2. In the left sidebar, go to **Community Plugins** → **Browse**.
3. Type `Local REST API` in the search bar.

   ![TODO: Screenshot of plugin search](images/obsidian-plugin-search.png)

4. Click **Install** on the "Local REST API" plugin.
5. After installation, click **Enable**.

   ![TODO: Screenshot of installed plugin](images/obsidian-plugin-installed.png)

---

### 2. Copy the API Key

Copy the API key generated by the plugin. This key authenticates communication between Yasumaro and Obsidian.

1. Confirm that **Local REST API** now appears in the left sidebar of Obsidian settings.
2. Click **Local REST API**.
3. Copy the value in the **API Key** field (a UUID in `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` format).

   ![TODO: Screenshot of API key display](images/obsidian-api-key.png)

> **Note**: The API key is sensitive information. Do not share it with third parties. If the key is leaked, you can regenerate it using the **Regenerate API Key** button in the plugin settings.

---

### 3. Verify Protocol and Port

The default settings work for most cases. Verify these default values:

| Setting | Default Value | Notes |
|---------|--------------|-------|
| **Protocol** | `https` | https recommended for security |
| **Port** | `27124` | Default port for https |
| **HTTP Port** | `27123` | Only when using http |

**When to change settings**:
- Only change if port `27124` conflicts with another application
- Most environments can use the defaults

---

### 4. Configure Daily Note Path

Set the location where Yasumaro saves web page records.

1. Go to Obsidian Settings → **Local REST API**.
2. In the **Daily Note Path** field, enter the path to your daily notes within your Vault.

Examples:

| Vault Structure | Daily Note Path Value |
|----------------|----------------------|
| Standard Daily Notes (`DailyNotes/2026-06-29.md`) | `DailyNotes` |
| `Journal` folder with date format | `Journal` |
| `092.Daily` folder | `092.Daily` |

Match the path to your Daily Note plugin settings. If using Obsidian's built-in Daily Notes plugin, enter the folder name specified in the "New file location" setting.

---

### 5. Configure Yasumaro Dashboard and Test Connection

1. Right-click the Yasumaro extension icon in Chrome → select **Options** to open the dashboard.
2. In the "Initial Settings" panel, check **Use Obsidian**.
3. Enter the following:

   | Field | Value |
   |-------|-------|
   | **Obsidian URL** | `https://127.0.0.1:27124` (default) |
   | **Obsidian API Key** | The API key copied in step 2 |
   | **Daily Note Path** | The path configured in step 4 (e.g., `DailyNotes`) |

4. Click **Test Connection**.
5. You should see ✓ Connection successful.

---

### Troubleshooting

#### Certificate Error (Self-Signed Certificate)

The Local REST API plugin uses a self-signed certificate by default, which may trigger a Chrome certificate warning on the first connection.

**Steps to resolve (macOS / Windows)**:

1. Open `https://127.0.0.1:27124` in Chrome.
2. You will see a "Your connection is not private" warning.
3. Click **Advanced**.
4. Click **Proceed to 127.0.0.1 (unsafe)**.

This tells Chrome to trust this local certificate for future connections from Yasumaro.

> **Important**: This action is specific to the Obsidian Local REST API, a local-only tool. **Never** ignore certificate warnings for general websites on the internet.

**If the certificate error persists**:
- Switch the protocol to `http` and port to `27123` in the Yasumaro dashboard (http does not perform certificate validation)
- Note that http traffic is unencrypted, so be mindful of local network security

#### Connection Timeout

If the test connection times out:

1. Ensure Obsidian is running.
2. Verify the Local REST API plugin is enabled.
3. Check that the URL and port are correct (default: `https://127.0.0.1:27124`).
4. Check if a firewall is blocking port `27124`.

#### Daily Note Path Not Recognized

1. Check the "New file location" setting in Obsidian's Daily Notes plugin configuration.
2. Ensure the path is relative to the Vault root (no leading `/`).
3. If using Japanese folder names, verify the folder name is correct.

---

### Reference Links

- [Local REST API Plugin (GitHub)](https://github.com/coddingtonbear/obsidian-local-rest-api)
- [Yasumaro on Chrome Web Store](https://chromewebstore.google.com/detail/yasumaro-ai-browsing-logg/cpeammcnmfpmlkidciiobmnjnhfkmjlc)
- [Yasumaro GitHub Repository](https://github.com/armaniacs/yasumaro)
