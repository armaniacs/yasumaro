# uBlock Origin形式フィルターインポート機能 ユーザーガイド / uBlock Origin Format Filter Import User Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

Obsidian Weave拡張機能のuBlock Origin形式フィルターインポート機能を使用すると、既存のuBlock Originフィルターリストやhosts形式のフィルターリスト（例：Steven Black's hosts）を直接インポートして、特定のWebサイトの記録をブロックまたは許可できます。

**複数のフィルターソースを同時に登録でき**、それぞれ個別に管理できます。

### 使い方

#### 1. 設定画面へのアクセス

1. ブラウザのツールバーにあるObsidian Weaveアイコンをクリックします。
2. 表示されるポップアップ画面で、右上の「☰」メニューを開きます。
3. 「Settings」を選択して設定画面に移動します。

#### 2. ドメインフィルタータブの選択

設定画面で「ドメインフィルター」タブを選択します。

#### 3. フィルターモードの選択

以下のいずれかのモードを選択します：
- **無効**: すべてのサイトを記録します。
- **ホワイトリスト**: 指定したサイトのみを記録します。
- **ブラックリスト**: 指定したサイトを記録から除外します。

#### 4. フィルター形式の選択

「フィルター形式」で「uBlock Origin 形式」を選択します。

#### 5. フィルターの入力

以下の4つの方法でuBlock形式のフィルターを入力できます：

##### 方法1: テキストの直接入力
1. 「uBlockフィルター」テキストエリアに、uBlock Origin形式のフィルターを直接貼り付けます。
2. 入力すると自動的にプレビューが表示され、ルール数、例外数、エラー数が確認できます。

##### 方法2: ファイルからの読み込み
1. 「ファイルを選択」ボタンをクリックします。
2. ローカルに保存されている.txt形式のフィルターリストを選択します。
3. ファイルが読み込まれ、テキストエリアに内容が表示されます。

##### 方法3: ドラッグ＆ドロップ
1. ファイルを「ファイルをここにドロップ」と表示されている領域にドラッグ＆ドロップします。
2. ファイルが読み込まれ、テキストエリアに内容が表示されます。

##### 方法4: URLからの読み込み
1. 「URLから読み込み」の入力欄に、フィルターリストのURLを入力します。
2. 「URLからインポート」ボタンをクリックします。
3. 指定したURLからフィルターがダウンロードされ、テキストエリアに内容が表示されます。

#### 6. フィルターのプレビュー

入力したフィルターはリアルタイムでプレビューされ、以下の情報が表示されます：
- **ルール数**: ブロックするドメインの数
- **例外数**: 許可するドメインの数
- **エラー**: フィルターの構文エラーの数と詳細

#### 7. エクスポート機能

既存のuBlockフィルターをエクスポートできます：
- **エクスポート**: 現在のフィルターを.txtファイルとしてダウンロードします。
- **クリップボードにコピー**: 現在のフィルターをクリップボードにコピーします。

#### 8. 設定の保存

「保存」ボタンをクリックして、入力したフィルターを保存します。保存後、テキストエリアはクリアされ、「登録済みフィルターソース」一覧に追加されます。

#### 9. 複数ソースの管理

複数のフィルターソースを登録して同時に使用できます。

##### ソース一覧の確認
「登録済みフィルターソース」セクションに、保存済みの全ソースが表示されます：
- **URL**: インポート元のURL（クリックで開く）または「手動入力」
- **インポート日時**: 最後にインポートした日時
- **ルール数**: そのソースに含まれるルール数

##### ソースの削除
各ソースの横にある「削除」ボタンをクリックすると、そのソースを削除できます。削除後、残りのソースのルールのみが適用されます。

##### ソースの更新
同じURLから再度インポートすると、既存のソースが上書き更新されます。

### サポートされているフィルター形式

#### uBlock Origin形式

以下のuBlock Origin構文がサポートされています：

| 構文 | 説明 | 例 |
|------|------|-----|
| `||hostname^` | ドメインと全サブドメインをブロック | `||example.com^` |
| `@@||hostname^` | 例外ルール（ブロックを解除） | `@@||trusted.com^` |
| `*` | ワイルドカード | `||*.ads.net^` |
| `!` | コメント | `! Comment` |
| `$domain=` | 特定ドメインに制限 | `||tracker.com$domain=example.com` |
| `$~domain=` | ドメインを除外 | `||tracker.com$domain=~trusted.com` |
| `$3p` | サードパーティのみ | `||ad.com$3p` |
| `$1p` | ファーストパーティのみ | `||script.com$1p` |
| `$important` | 重要マーク（他のルールより優先） | `||analytics.com$important` |

#### hosts形式（AdGuard DNS / Steven Black互換）

以下のhosts形式もサポートされています：

| 形式 | 説明 | 例 |
|------|------|-----|
| `0.0.0.0 hostname` | ドメインをブロック | `0.0.0.0 ads.example.com` |
| `127.0.0.1 hostname` | ドメインをブロック | `127.0.0.1 tracker.com` |
| `#` | コメント行 | `# This is a comment` |
| 行末コメント | 行末のコメント | `0.0.0.0 ads.com # 広告` |

hosts形式のフィルターは自動的にuBlock Origin形式に変換されます：
- `0.0.0.0 ads.example.com` → `||ads.example.com^`
- `localhost`, `local`, `broadcasthost` などの特殊ドメインは自動的にスキップされます

### 推奨フィルターリスト

以下の公開フィルターリストをURLから直接インポートできます：

| リスト名 | 説明 | URL |
|---------|------|-----|
| Steven Black's hosts | 広告・マルウェア・ポルノなど総合ブロック | `https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts` |
| Steven Black's hosts (fakenews-gambling-porn-social) | 拡張版 | `https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/fakenews-gambling-porn-social/hosts` |
| OISD (nsfw) | NSFW ドメインリスト | `https://nsfw.oisd.nl/` |

### 注意事項

- ファイルの文字エンコーディングはUTF-8であることを推奨します。
- フィルターにエラーがある場合、保存前に修正してください。
- プレビューでエラーが表示された場合でも、有効なルールは正常に機能します。
- 大きなフィルターリスト（20万ドメイン以上）もサポートしています。
- ストレージ容量を節約するため、ドメイン情報のみが保存されます（オプション情報は保持されません）。
- ローカルファイルやdataプロトコルのURLはインポートできません。
- v2.2.4以前を使用していたユーザーは、データが自動的に軽量形式へ変換されます。詳細は [UBLOCK_MIGRATION.md](docs/UBLOCK_MIGRATION.md) を参照してください。

#### セキュリティ制限

セキュリティ上の理由から、URLからのインポートは**許可されたドメインのみ**に制限されています。現在、以下のドメインからのインポートが可能です:

**フィルターリスト提供サイト:**
- `raw.githubusercontent.com` - GitHub Raw Content（Steven Black's hostsなど）
- `gitlab.com` - GitLab
- `easylist.to` - EasyList公式サイト
- `pgl.yoyo.org` - Peter Lowe's Ad and tracking server list
- `nsfw.oisd.nl` - OISD NSFW domain list

許可されていないドメインからインポートしようとすると、「URL is not allowed」というエラーが表示されます。この場合は、以下の方法を使用してください:

1. **ファイルをダウンロードしてローカルから読み込む**: URLからフィルターリストをダウンロードし、「ファイルを選択」またはドラッグ&ドロップで読み込みます。
2. **テキストをコピー&ペースト**: フィルターリストの内容をブラウザで開いてコピーし、テキストエリアに直接貼り付けます。

### 技術仕様

#### ストレージ形式（軽量化版）

フィルターデータは最小限の形式で保存されています：
- ドメイン名のみの配列として保存
- ルールオブジェクトではなく文字列のみ

フィルターデータは以下の形式でChrome拡張機能のローカルストレージに保存されます：

```javascript
{
  // マージ済みルール（全ソースの統合）
  ublock_rules: {
    blockDomains: ["ads.example.com", "tracker.com", ...],
    exceptionDomains: ["trusted.com", ...],
    metadata: {
      importedAt: 1234567890,
      ruleCount: 12345
    }
  },
  // 個別ソース情報
  ublock_sources: [
    {
      url: "https://example.com/filters.txt",
      importedAt: 1234567890,
      ruleCount: 1000,
      blockDomains: [...],
      exceptionDomains: [...]
    }
  ]
}
```

#### パフォーマンス最適化

- **Setベースのマッチング**: 完全一致ドメインはO(1)で高速検索
- **ワイルドカード**: `*`を含むパターンのみ配列でチェック
- **キャッシュ**: ルールインデックスはWeakMapでキャッシュされ、再構築を回避

---

## English

### Overview

The Obsidian Weave extension's uBlock Origin format filter import feature allows you to directly import existing uBlock Origin filter lists or hosts format filter lists (e.g., Steven Black's hosts) to block or allow recording of specific websites.

**You can register multiple filter sources simultaneously** and manage each one individually.

### Usage

#### 1. Accessing Settings

1. Click the Obsidian Weave icon in your browser's toolbar.
2. In the popup that appears, open the "☰" menu in the top right.
3. Select "Settings" to go to the settings screen.

#### 2. Selecting the Domain Filter Tab

Select the "Domain Filter" tab in the settings screen.

#### 3. Selecting Filter Mode

Select one of the following modes:
- **Disabled**: Record all websites.
- **Whitelist**: Record only specified websites.
- **Blacklist**: Exclude specified websites from recording.

#### 4. Selecting Filter Format

Select "uBlock Origin Format" in the "Filter Format" option.

#### 5. Inputting Filters

You can input uBlock format filters using the following methods:

##### Method 1: Direct Text Input
1. Paste uBlock Origin format filters directly into the "uBlock Filters" text area.
2. A preview is automatically displayed when you input, showing the number of rules, exceptions, and errors.

##### Method 2: Load from File
1. Click the "Select File" button.
2. Select a .txt format filter list saved locally.
3. The file is loaded and its contents are displayed in the text area.

##### Method 3: Drag & Drop
1. Drag and drop a file into the area marked "Drop files here."
2. The file is loaded and its contents are displayed in the text area.

##### Method 4: Load from URL
1. Enter the URL of the filter list in the "Load from URL" input field.
2. Click the "Import from URL" button.
3. Filters are downloaded from the specified URL and displayed in the text area.

#### 6. Filter Preview

The filters you input are previewed in real-time, showing the following information:
- **Rule Count**: Number of domains to block
- **Exception Count**: Number of domains to allow
- **Errors**: Number and details of filter syntax errors

#### 7. Export Functionality

You can export existing uBlock filters:
- **Export**: Download the current filters as a .txt file.
- **Copy to Clipboard**: Copy the current filters to the clipboard.

#### 8. Saving Settings

Click the "Save" button to save the entered filters. After saving, the text area is cleared and added to the "Registered Filter Sources" list.

#### 9. Managing Multiple Sources

You can register multiple filter sources and use them simultaneously.

##### Viewing Source List
All saved sources are displayed in the "Registered Filter Sources" section:
- **URL**: Import source URL (click to open) or "Manual Input"
- **Import Date/Time**: Date and time of last import
- **Rule Count**: Number of rules contained in that source

##### Deleting a Source
Click the "Delete" button next to each source to delete that source. After deletion, only rules from remaining sources are applied.

##### Updating a Source
Re-importing from the same URL will overwrite and update the existing source.

### Supported Filter Formats

#### uBlock Origin Format

The following uBlock Origin syntax is supported:

| Syntax | Description | Example |
|--------|-------------|---------|
| `||hostname^` | Block domain and all subdomains | `||example.com^` |
| `@@||hostname^` | Exception rule (unblocks) | `@@||trusted.com^` |
| `*` | Wildcard | `||*.ads.net^` |
| `!` | Comment | `! Comment` |
| `$domain=` | Restrict to specific domain | `||tracker.com$domain=example.com` |
| `$~domain=` | Exclude domain | `||tracker.com$domain=~trusted.com` |
| `$3p` | Third-party only | `||ad.com$3p` |
| `$1p` | First-party only | `||script.com$1p` |
| `$important` | Important mark (higher priority) | `||analytics.com$important` |

#### hosts Format (AdGuard DNS / Steven Black Compatible)

The following hosts format is also supported:

| Format | Description | Example |
|--------|-------------|---------|
| `0.0.0.0 hostname` | Block domain | `0.0.0.0 ads.example.com` |
| `127.0.0.1 hostname` | Block domain | `127.0.0.1 tracker.com` |
| `#` | Comment line | `# This is a comment` |
| End-of-line comment | Comment at end of line | `0.0.0.0 ads.com # 广告` |

Hosts format filters are automatically converted to uBlock Origin format:
- `0.0.0.0 ads.example.com` → `||ads.example.com^`
- Special domains like `localhost`, `local`, and `broadcasthost` are automatically skipped

### Recommended Filter Lists

You can directly import the following public filter lists from URLs:

| List Name | Description | URL |
|-----------|-------------|-----|
| Steven Black's hosts | Comprehensive blocking for ads, malware, porn, etc. | `https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts` |
| Steven Black's hosts (fakenews-gambling-porn-social) | Extended version | `https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/fakenews-gambling-porn-social/hosts` |
| OISD (nsfw) | NSFW domain list | `https://nsfw.oisd.nl/` |

### Notes

- UTF-8 character encoding is recommended for files.
- Correct any errors in filters before saving.
- Even if errors are displayed in the preview, valid rules will function normally.
- Large filter lists (200,000+ domains) are also supported.
- To save storage capacity, only domain information is stored (optional information is not retained).
- Local files and data protocol URLs cannot be imported.
- For users who used v2.2.4 or earlier, data is automatically converted to the lightweight format. For details, see [UBLOCK_MIGRATION.md](docs/UBLOCK_MIGRATION.md).

#### Security Restrictions

For security reasons, URL imports are restricted to **allowed domains only**. Currently, the following domains are available for import:

**Filter List Provider Sites:**
- `raw.githubusercontent.com` - GitHub Raw Content (Steven Black's hosts, etc.)
- `gitlab.com` - GitLab
- `easylist.to` - EasyList official site
- `pgl.yoyo.org` - Peter Lowe's Ad and tracking server list
- `nsfw.oisd.nl` - OISD NSFW domain list

If you attempt to import from a non-allowed domain, you will see a "URL is not allowed" error. In this case, use one of the following methods:

1. **Download the file and load it locally**: Download the filter list from the URL and load it using "Select File" or drag & drop.
2. **Copy & Paste the text**: Open the filter list in your browser, copy its contents, and paste it directly into the text area.

### Technical Specifications

#### Storage Format (Lightweight Version)

Filter data is stored in a minimal format:
- Saved as an array of domain names only
- Stored as strings, not rule objects

Filter data is stored in the following format in the Chrome extension's local storage:

```javascript
{
  // Merged rules (integrated from all sources)
  ublock_rules: {
    blockDomains: ["ads.example.com", "tracker.com", ...],
    exceptionDomains: ["trusted.com", ...],
    metadata: {
      importedAt: 1234567890,
      ruleCount: 12345
    }
  },
  // Individual source information
  ublock_sources: [
    {
      url: "https://example.com/filters.txt",
      importedAt: 1234567890,
      ruleCount: 1000,
      blockDomains: [...],
      exceptionDomains: [...]
    }
  ]
}
```

#### Performance Optimization

- **Set-based Matching**: Exact domain matches use O(1) high-speed search
- **Wildcards**: Only patterns containing `*` are checked as arrays
- **Cache**: Rule indexes are cached using WeakMap to avoid rebuilding