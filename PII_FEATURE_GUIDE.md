# PII 機能ガイド / PII Feature Guide (v2.3)

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

Webページ要約時のプライバシー保護機能の実装ガイドです。

> [!NOTE]
> **Local AI機能について**
> Chrome/Edge等のブラウザにおける Prompt API (window.ai) の実装状況が過渡期であるため、**Mode A / Mode B は現在「開発中（実験的機能）」** と位置づけています。
> デフォルトでは **Mode C (Masked Cloud)** を使用することを強く推奨します。

### 主な機能

1. **4つのプライバシーモード**: ユーザーのニーズに合わせて選択可能。
2. **PIIマスキング**: クレジットカード番号、電話番号などの機密情報を正規表現で検出し `[MASKED]` に置換。
3. **確認・編集プレビュー**: 送信前にマスク結果を確認・編集できるモーダルUI。
4. **サニタイズログ**: マスキング履歴をローカルに記録（7日間保持）。

### 操作設定

#### 推奨設定 (Mode C)

ポップアップの「プライバシー」タブから設定します。

| モード | ステータス | 動作説明 |
| :--- | :--- | :--- |
| **A: Local Only** | 🚧 開発中 | 完全ローカル処理。対応ブラウザでのみ動作。 |
| **B: Full Pipeline** | 🚧 開発中 | ローカル要約 + クラウド仕上げ。対応ブラウザでのみ動作。 |
| **C: Masked Cloud** | ✅ **推奨** | **PIIをマスクしてクラウドへ送信**。最も安定的かつ安全。 |
| **D: Cloud Only** | - | 従来動作。生データをクラウド送信。 |

#### 動作フロー

1. **「📝 今すぐ記録」** をクリック。
2. **確認モーダル** が表示されます。
   - 本文中の電話番号などが `[MASKED:PHONE]` のように隠されていることを確認してください。
   - 必要に応じてテキストを編集できます。
3. **「送信する」** をクリックしてObsidianへ保存します。

### v2.3の改善点（確認画面の使い勝手向上）

#### 1. マスク種別の詳細表示

マスクされた個人情報の種別と件数がステータスメッセージに表示されるようになりました。

**表示例:**
```
電話番号3件をマスクしました
E-mail1件、クレジットカード番号2件をマスクしました
```

これで、どの種類の個人情報が検出されたかが一目で分かります。

#### 2. マスク箇所へのワンタッチジャンプ

テキストエリアの右側に **▲ / ▼ ボタン** を追加しました。

**機能:**
- **▼ ボタン**: 次のマスク箇所（`[MASKED:*]`）に移動
- **▲ ボタン**: 前のマスク箇所に移動
- ジャンプ時に自動的にテキストを選択

長いテキストの中からマスク箇所を探す手間がなくなりました。

#### 3. テキストエリアのリサイズ対応

テキストエリアのサイズを自由に調整できるようになりました。

**機能:**
- 右下のリサイズハンドルをドラッグしてサイズ変更
- デフォルト高さを200pxから600px（3倍）に拡大
- ポップアップのサイズ変更に合わせて自動調整

### 技術的詳細

#### PII検出 (Regex)
以下のパターンを自動検出してマスクします：
- クレジットカード番号
- マイナンバー
- 銀行口座番号
- メールアドレス
- 日本の電話番号

#### プロンプトインジェクション対策
AI要約時のセキュリティ保護機能：
- **検出パターン**: `ignore above`、`SYSTEM`、`PASSWORD`、`execute()`、`eval()`、`previous conversation` 等の危険パターンを検出
- **処理**: 危険な部分は `[FILTERED]` に置き換え残り安全なコンテンツをAIに送信
- **安全評価**: サニタイズ後のコンテンツを再評価し、リスクが残っている場合のみブロック
- **ログ記録**: 検出されたパターンとブロック原因をログに記録

#### ログ確認
マスキングの実行ログを確認するには、拡張機能の DevTools コンソールで以下を実行します：
```javascript
await reviewLogs()
```

### ホワイトリストドメインでの自動保存

> [!TIP]
> **v4.0の新機能**
> ホワイトリストに登録されたドメインでは、プライベートページ検出による警告が表示されず、自動的に保存されます。

#### 概要

拡張機能はHTTPヘッダー（`Cache-Control`, `Set-Cookie`, `Authorization`）を監視して、プライベートページを自動検出します。通常、プライベートページでは保存前に警告が表示されますが、**ホワイトリストに登録されたドメイン**では警告なしで自動保存されます。

#### 想定される利用シーン

- 社内Confluence、社内Wiki
- 企業向けドキュメント管理システム
- その他、信頼できる社内システム

これらのシステムは認証が必要なため「プライベートページ」として検出されますが、ホワイトリストに登録することで、シームレスに自動保存できます。

#### 設定方法

1. 拡張機能のポップアップを開く
2. **「ドメインフィルター」** タブをクリック
3. **「ホワイトリスト」** セクションにドメインを追加
   - 例: `confluence.example.com`
   - ワイルドカード対応: `*.confluence.example.com`

#### 重要: PIIマスキングは引き続き実行されます

ホワイトリストドメインでプライバシー警告がスキップされても、**マイナンバー、クレジットカード番号、メールアドレス等のPII（個人情報）は必ずマスクされてからAIに送信されます**。

これにより、社内システムでの利便性とセキュリティの両立が実現します。

### 将来の展望

ブラウザの `window.ai` 実装が安定次第、Mode A/B のローカルAI機能が自動的に有効になる設計となっています。

---

### よくある質問 (FAQ)

#### Q. 「🔒 マスクあり」バッジが表示されたのに、確認通知が出なかった。これは正常ですか？

**A. 正常な動作です。** PIIマスクとプライベートページ検出は**独立した2つの機能**です。

| 機能 | 何を検査するか | いつ動作するか |
|------|-------------|--------------|
| **PIIマスク（🔒）** | ページのテキスト内容（電話番号・メールアドレスなど） | AI送信の直前、常時 |
| **プライベートページ検出** | HTTPレスポンスヘッダー（Cache-Control: private など） | ページ読み込み時 |

例えば、公開されている行政ページ（警視庁・国税庁など）にはPIIが記載されている場合があります。このようなページはHTTPヘッダーでプライベートと宣言されていないため確認通知は出ませんが、テキスト内の電話番号等はPIIマスクにより自動保護されます。

確認通知が出るのは、ネットバンキング・社内システム・医療ポータルなど、サーバーが `Cache-Control: private` や `Set-Cookie` ヘッダーを返すページにアクセスしたときです。

#### Q. 「スキップ済み」として残ったページはどこで確認できますか？

**A. ダッシュボードの History タブ**で確認できます。自動保存時の動作が `skip` に設定されている場合、プライベートページ検出が発動したページは Obsidian には保存されず、ダッシュボードの「Skipped」フィルターに一覧表示されます。「今すぐ記録」ボタンでその場から手動保存することができます。スキップされたページは24時間後に自動削除されます。

---

## English

### Overview

Implementation guide for privacy protection features during web page summarization.

> [!NOTE]
> **Local AI Feature Availability**
> Since Chrome/Edge Prompt API (window.ai) implementation is in a transitional period, **Mode A / Mode B are currently marked as "Experimental"**.
> We strongly recommend using **Mode C (Masked Cloud)** by default.

### Key Features

1. **Four Privacy Modes**: Choose according to your needs.
2. **PII Masking**: Detect sensitive information such as credit card numbers and phone numbers using regex patterns and replace them with `[MASKED]`.
3. **Preview & Edit Modal**: Modal UI to verify and edit masking results before sending.
4. **Sanitization Log**: Record masking history locally (retained for 7 days).

### Configuration

#### Recommended Setting (Mode C)

Configure via the "Privacy" tab in the popup.

| Mode | Status | Description |
| :--- | :--- | :--- |
| **A: Local Only** | 🚧 Experimental | Fully local processing. Works only on supported browsers. |
| **B: Full Pipeline** | 🚧 Experimental | Local summary + Cloud refinement. Works only on supported browsers. |
| **C: Masked Cloud** | ✅ **Recommended** | **Send masked PII to cloud**. Most stable and secure. |
| **D: Cloud Only** | - | Original behavior. Send raw data to cloud. |

#### Workflow

1. Click **"📝 Record Now"**.
2. **Confirmation Modal** appears.
   - Verify that phone numbers etc. in the text are hidden like `[MASKED:PHONE]`.
   - Text can be edited if necessary.
3. Click **"Send"** to save to Obsidian.

### v2.3 Improvements (Enhanced Confirmation Screen UX)

#### 1. Detailed Mask Type Display

Status messages now show the types and counts of masked personal information.

**Display Example:**
```
Masked 3 phone numbers
Masked 1 email address, 2 credit card numbers
```

You can now see at a glance what types of personal information were detected.

#### 2. One-Click Jump to Masked Locations

Added **▲ / ▼ buttons** on the right side of the text area.

**Features:**
- **▼ Button**: Move to next masked location (`[MASKED:*]`)
- **▲ Button**: Move to previous masked location
- Auto-select text when jumping

No more effort to find masked locations within long text.

#### 3. Text Area Resize Support

Text area size can now be adjusted freely.

**Features:**
- Drag resize handle at bottom right to change size
- Default height increased from 200px to 600px (3 times)
- Auto-adjusts with popup size changes

### Technical Details

#### PII Detection (Regex)
Automatically detects and masks the following patterns:
- Credit card numbers
- My Number (Japanese personal identification number)
- Bank account numbers
- Email addresses
- Japanese phone numbers

#### Prompt Injection Protection
Security protection feature during AI summarization:
- **Detection Patterns**: Detects dangerous patterns like `ignore above`, `SYSTEM`, `PASSWORD`, `execute()`, `eval()`, `previous conversation`
- **Processing**: Dangerous parts are replaced with `[FILTERED]` and remaining safe content is sent to AI
- **Safety Evaluation**: Re-evaluates sanitized content; only blocks if risks remain
- **Logging**: Records detected patterns and block reasons in logs

#### Log Viewing
To view masking execution logs, run the following in the extension's DevTools console:
```javascript
await reviewLogs()
```

### Automatic Saving for Whitelisted Domains

> [!TIP]
> **New in v4.0**
> Domains registered in the whitelist will be automatically saved without privacy detection warnings.

#### Overview

The extension monitors HTTP headers (`Cache-Control`, `Set-Cookie`, `Authorization`) to automatically detect private pages. Normally, a warning is displayed before saving private pages, but **domains registered in the whitelist** are automatically saved without warnings.

#### Expected Use Cases

- Internal Confluence, internal Wiki
- Enterprise document management systems
- Other trusted internal systems

These systems are detected as "private pages" because they require authentication, but by registering them in the whitelist, they can be saved seamlessly.

#### Configuration

1. Open the extension popup
2. Click the **"Domain Filter"** tab
3. Add domains to the **"Whitelist"** section
   - Example: `confluence.example.com`
   - Wildcard support: `*.confluence.example.com`

#### Important: PII Masking Still Applies

Even if privacy warnings are skipped for whitelisted domains, **PII (Personal Identifiable Information) such as My Number, credit card numbers, and email addresses are always masked before being sent to AI**.

This achieves a balance between convenience and security for internal systems.

### Future Outlook

The design automatically enables Mode A/B local AI functionality once browser `window.ai` implementation stabilizes.

---

### Frequently Asked Questions (FAQ)

#### Q. I see a "🔒 Masked" badge, but no confirmation notification appeared. Is this normal?

**A. Yes, this is normal.** PII masking and private page detection are **two independent features**.

| Feature | What it inspects | When it runs |
|---------|-----------------|--------------|
| **PII Masking (🔒)** | Page text content (phone numbers, email addresses, etc.) | Always, just before sending to AI |
| **Private Page Detection** | HTTP response headers (e.g., `Cache-Control: private`) | At page load time |

For example, public government pages may contain personal information such as phone numbers. Since these pages do not declare themselves private via HTTP headers, no confirmation notification is shown — but any PII in the text is still automatically protected by the masking feature.

Confirmation notifications appear when accessing pages where the server returns `Cache-Control: private` or `Set-Cookie` headers, such as online banking, internal systems, or medical portals.

#### Q. Where can I find pages that were skipped?

**A. In the Dashboard's History tab.** When the auto-save behavior is set to `skip`, pages triggered by private page detection are not saved to Obsidian, but appear in the "Skipped" filter of the Dashboard. You can manually save them from there using the "Record Now" button. Skipped pages are automatically deleted after 24 hours.