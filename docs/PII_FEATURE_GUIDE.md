# PII 機能ガイド / PII Feature Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

Webページを要約してAIに送る前に、個人情報（PII）を自動でマスクする機能のガイドです。

### 主な機能

1. **4つのプライバシーモード**: ユーザーのニーズに合わせて選択可能。
2. **PIIマスキング**: クレジットカード番号、電話番号、EU圏の税ID等の機密情報を正規表現で検出し `[MASKED]` に置換。
3. **コンテンツクレンジング**: Webページの不要な要素（広告、ナビゲーション、SNS埋め込み等）をAI要約の前に削減。
4. **確認・編集プレビュー**: 送信前にマスク結果を確認・編集できるモーダルUI。

### 4つのプライバシーモード

| モード | 動作 |
|--------|------|
| **Masked Cloud**（推奨） | PIIマスキング + クラウドAI要約。PIIをマスクしてからクラウドAIに送信 |
| **Full Pipeline** | ローカルAI要約 + PIIマスキング + クラウドAI仕上げ。対応ブラウザでのみ動作 |
| **Local Only** | クラウドAIを使わず、デバイス上のローカル処理のみ |
| **Cloud Only** | PIIマスキング・クレンジングなしでクラウドAIに送信 |

**推奨設定: Masked Cloud**。PIIをマスクしてからクラウドAIに送信するため、プライバシーと利便性のバランスが最も良い。

| モード | ステータス | 動作説明 |
| :--- | :--- | :--- |
| **A: Local Only** | 🚧 開発中 | 完全ローカル処理。対応ブラウザでのみ動作。 |
| **B: Full Pipeline** | 🚧 開発中 | ローカル要約 + PIIマスキング + クラウド仕上げ。対応ブラウザでのみ動作。 |
| **C: Masked Cloud** | ✅ **推奨** | **PIIをマスクしてクラウドへ送信**。最も安定的かつ安全。 |
| **D: Cloud Only** | - | 従来動作。生データをクラウド送信。 |

#### 動作フロー

1. **「📝 今すぐ記録」** をクリック。
2. **確認モーダル** が表示されます。
   - 本文中の電話番号などが `[MASKED:PHONE]` のように隠されていることを確認してください。
   - 必要に応じてテキストを編集できます。
3. **「送信する」** をクリックしてObsidianへ保存します。

### 確認画面の使い勝手

#### マスク種別の詳細表示

どの種類の個人情報が何件マスクされたかが、ステータスメッセージに表示されます。

**表示例:**
```
電話番号3件をマスクしました
E-mail1件、クレジットカード番号2件をマスクしました
```

一目でどの種類の個人情報が検出されたかを確認できます。

#### マスク箇所へのワンタッチジャンプ

テキストエリアの右側にある **▲ / ▼ ボタン** で、マスク箇所（`[MASKED:*]`）の間を移動できます。

- **▼ ボタン**: 次のマスク箇所に移動
- **▲ ボタン**: 前のマスク箇所に移動
- ジャンプ時に自動的にテキストを選択

長いテキストの中からマスク箇所を探す手間がありません。

#### テキストエリアのリサイズ対応

テキストエリアは自由にサイズを調整できます。右下のリサイズハンドルをドラッグして拡大・縮小でき、デフォルトの高さも600pxと余裕を持たせています。ポップアップのサイズ変更にも自動で追従します。

### 技術的詳細

#### コンテンツサイズ制限

大きなページの内容は64KB（65,536文字）に切り詰められ、先頭の64KBのみが処理されます。これは以下の理由で実施されています：

- パフォーマンス：大きなページが処理パイプラインをハングさせるのを防ぐ
- APIコスト：AI APIに送信するデータ量を制限

**処理の順序とAI APIへの送信について：**

| 処理順序 | ステップ | 内容 |
|----------|----------|------|
| 1 | コンテンツ切り詰め | 64KB超過時、先頭64KBのみに切り詰め |
| 2 | プライバシーヘッダーチェック | `Cache-Control` などのHTTPヘッダー確認 |
| 3 | PrivacyPipeline処理 | PIIマスキング、プロンプトインジェクション対策 |
| 4 | AI API送信 | 切り詰められた64KBのコンテンツを送信 |
| 5 | Obsidian保存 | AI要約結果を保存 |

**重要なポイント：**
- 切り詰められた64KBのコンテンツのみがAI APIに送信されます
- 64KB以降のコンテンツはAI APIには送信されません

これはPIIの観点から言えば、**「64KB以降に含まれるPIIはAI APIに送信されない」** という意味で、**安全側の挙動**です。

> [!TIP]
> AI APIに送信されるのは先頭の64KBのみであるため、ページの後半部分に含まれる機密情報はAI APIには送信されません。これはプライバシー保護の観点から安全な設計です。

#### PII検出 (Regex)
実際に試すには [PII Sandbox](pii-sandbox.html) を開いてください。

以下のパターンを自動検出してマスクします：
- クレジットカード番号
- マイナンバー
- 銀行口座番号
- メールアドレス
- 日本の電話番号

#### プロンプトインジェクション対策
AI要約時のセキュリティ保護機能：
- **検出パターン**: `ignore above`、`SYSTEM`、`PASSWORD`、`execute()` 等の危険パターンを検出
- **リスク評価**: HIGHリスクパターン（インジェクション指示）は `[FILTERED]` に置き換え、LOWリスクパターン（`password`、`execute` などの単語）は文脈分析で評価
- **処理**: HIGHリスク部分は `[FILTERED]` に置き換え、残りの安全なコンテンツをAIに送信
- **安全評価**: サニタイズ後のコンテンツを再評価し、リスクが残っている場合のみブロック
- **ログ記録**: 検出されたパターンとブロック原因をログに記録

#### ログ確認
マスキングの実行ログを確認するには、拡張機能の DevTools コンソールで以下を実行します：
```javascript
await reviewLogs()
```

### ホワイトリストドメインでの自動保存

> [!TIP]
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

ブラウザの Local AI API 実装が安定し次第、Local Only モードのローカルAI機能が自動的に有効になる設計となっています。

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

#### Q. History の「PIIマスキング」欄で、電話番号やメールアドレスがマスクされているのにトークン数が変化しません。バグですか？

**A. バグではありません。** History の各エントリには、由来の異なる2つの削減指標が別々の行で表示されています。

| 表示行 | 対象 | 計測タイミング |
|--------|------|----------------|
| **Content Cleansing** | ページ本文のDOM要素除去（広告・ナビゲーション等） | コンテンツ抽出時 |
| **PIIマスキング** | 個人情報の `[MASKED:*]` 置換 | AI送信直前 |

「PIIマスキング」行のトークン数は、`[MASKED:phoneJp]` のようなマスク後の文字列を含めた概算値（日本語は2文字=1トークンとして概算）です。マスク用の置換文字列は元の電話番号断片などより**長くなる場合がある**ため、実際にマスクが実行されても、文字数の増減が概算のトークン数（整数への丸め）に反映されず、見かけ上 `82 → 82` のように変化しないことがあります。

マスキングが実際に何件実行されたかは、同じ行の**検出件数**（例: `検出件数: 2`）で確認できます。トークン数が同じでも検出件数が1件以上であれば、PIIマスキングは正常に動作しています。

---

## English

### Overview

A guide to how Yasumaro automatically masks personally identifiable information (PII) before sending page content to an AI provider for summarization.

### Key Features

1. **Four Privacy Modes**: Choose according to your needs.
2. **PII Masking**: Detect sensitive information such as credit card numbers, phone numbers, EU tax IDs, etc. using regex patterns and replace them with `[MASKED]`.
3. **Content Cleansing**: Remove unwanted elements (ads, navigation, SNS embeds, etc.) from web pages before AI summarization.
4. **Preview & Edit Modal**: Modal UI to verify and edit masking results before sending.

### Configuration

Configure via the "Privacy" tab in the popup.

| Mode | Description |
| :--- | :--- |
| **Masked Cloud** (Recommended) | PII masking + cloud AI. Masks sensitive data before sending. Best balance of privacy and convenience. |
| **Full Pipeline** | Local AI summary + PII masking + cloud AI finishing. Only works on supported browsers. |
| **Local Only** | On-device processing only, no cloud AI. |
| **Cloud Only** | Sends raw data to cloud AI without masking or cleansing. |

#### Workflow

1. Click **"📝 Record Now"**.
2. **Confirmation Modal** appears.
   - Verify that phone numbers etc. in the text are hidden like `[MASKED:PHONE]`.
   - Text can be edited if necessary.
3. Click **"Send"** to save to Obsidian.

### Confirmation Screen Usability

#### Detailed Mask Type Display

Status messages show the types and counts of masked personal information.

**Display Example:**
```
Masked 3 phone numbers
Masked 1 email address, 2 credit card numbers
```

You can see at a glance what types of personal information were detected.

#### One-Click Jump to Masked Locations

Use the **▲ / ▼ buttons** on the right side of the text area to jump between masked locations (`[MASKED:*]`).

- **▼ Button**: Move to next masked location
- **▲ Button**: Move to previous masked location
- Text is auto-selected when jumping

No need to hunt for masked locations within long text.

#### Text Area Resize Support

The text area can be resized freely by dragging the handle at the bottom right, with a generous default height of 600px. It also adjusts automatically as the popup is resized.

### Technical Details

#### Content Size Limit

Large page content is truncated to 64KB (65,536 characters), and only the first 64KB is processed. This is implemented for the following reasons:

- Performance: Prevents large pages from hanging the processing pipeline
- API Cost: Limits the amount of data sent to AI APIs

**Processing Order and AI API Transmission:**

| Processing Order | Step | Description |
|------------------|------|-------------|
| 1 | Content Truncation | If over 64KB, truncate to first 64KB only |
| 2 | Privacy Header Check | Check HTTP headers like `Cache-Control` |
| 3 | PrivacyPipeline Processing | PII masking, prompt injection protection |
| 4 | Send to AI API | Send the truncated 64KB content |
| 5 | Save to Obsidian | Save AI summary result |

**Key Points:**
- Only the truncated 64KB content is sent to the AI API
- Content beyond 64KB is NOT sent to the AI API

From a PII perspective, this means **"PII contained beyond 64KB will not be transmitted to the AI API"**, which is a **conservative/safe behavior**.

> [!TIP]
> Since only the first 64KB is sent to the AI API, sensitive information in the latter part of the page is not transmitted to the AI API. This is a safe design from a privacy protection perspective.

#### PII Detection (Regex)
Try it at [PII Sandbox](pii-sandbox.html).

Automatically detects and masks the following patterns:
- Credit card numbers
- My Number (Japanese personal identification number)
- Bank account numbers
- Email addresses
- Japanese phone numbers

#### Prompt Injection Protection
Security protection feature during AI summarization:
- **Detection Patterns**: Detects dangerous patterns like `ignore above`, `SYSTEM`, `PASSWORD`, `execute()`
- **Risk Assessment**: HIGH-risk patterns (injection instructions) are replaced with `[FILTERED]`; LOW-risk patterns (generic words like `password`, `execute`) are evaluated via context analysis
- **Processing**: HIGH-risk parts are replaced with `[FILTERED]` and remaining safe content is sent to AI
- **Safety Evaluation**: Re-evaluates sanitized content; only blocks if risks remain
- **Logging**: Records detected patterns and block reasons in logs

#### Log Viewing
To view masking execution logs, run the following in the extension's DevTools console:
```javascript
await reviewLogs()
```

### Automatic Saving for Whitelisted Domains

> [!TIP]
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

The design automatically enables Local Only mode functionality once browser local AI APIs stabilize.

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

#### Q. The "PII Masking" line in History shows masked phone numbers/emails, but the token count doesn't change. Is this a bug?

**A. No, this is not a bug.** Each History entry displays two independent reduction metrics on separate lines, with different origins:

| Line | What it measures | When it's measured |
|------|-------------------|---------------------|
| **Content Cleansing** | DOM element removal from page content (ads, navigation, etc.) | During content extraction |
| **PII Masking** | Replacement of personal information with `[MASKED:*]` | Just before sending to AI |

The token count on the "PII Masking" line is a rough estimate (Japanese text is approximated as 2 characters per token) computed on the text including mask replacement strings like `[MASKED:phoneJp]`. Since a mask replacement string can be **longer** than the original phone number fragment it replaces, the character-count change from masking doesn't always show up after rounding to an integer token count — so you may see `82 → 82` even though masking actually ran.

To confirm masking actually happened, check the **detected count** on the same line (e.g., `Detected: 2`). If the detected count is 1 or more, PII masking is working correctly even if the token count looks unchanged.