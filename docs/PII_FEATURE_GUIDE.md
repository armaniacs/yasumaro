# PII 機能ガイド / PII Feature Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

Webページを要約してAIに送る前に、個人情報（PII）を自動でマスクする機能のガイドです。

### 主な機能

1. **4つのプライバシーモード**: ユーザーのニーズに合わせて選択可能。
2. **PIIマスキング**: クレジットカード番号、電話番号、税番号（ドイツ）等の機密情報を WASM-first のハイブリッド検出（全21パターン）で検出し、`[MASKED:email]` のような型付きトークンに置換。
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
| **A: Local Only** | 対応ブラウザで利用可能 | 完全ローカル処理。Chrome の Gemini Nano / Edge の Phi-mini など、ブラウザ内蔵 AI を使用。API キー不要・オフラインで動作（対応ブラウザかつフラグ有効化・モデルダウンロードが必要）。 |
| **B: Full Pipeline** | 対応ブラウザで利用可能 | ローカル要約 + PIIマスキング + クラウド仕上げ。Built-in AI でのローカル要約後、PII マスキングしてクラウド AI で要約を整えます。 |
| **C: Masked Cloud** | ✅ **推奨** | **PIIをマスクしてクラウドへ送信**。最も安定的かつ安全。 |
| **D: Cloud Only** | - | 従来動作。生データをクラウド送信。 |

#### 動作フロー

1. **「📝 今すぐ記録」** をクリック。
2. **確認モーダル** が表示されます。
   - 本文中の電話番号などが `[MASKED:phoneJp]` のように隠されていることを確認してください。
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

大きなページの内容は、記録パイプラインの最初の段階で 64KB（65,536バイト、UTF-8）に切り詰められ、先頭部分のみが処理されます。これは以下の理由で実施されています：

- パフォーマンス：大きなページが処理パイプラインをハングさせるのを防ぐ
- APIコスト：AI APIに送信するデータ量を制限

**処理の順序とAI APIへの送信について：**

| 処理順序 | ステップ | 内容 |
|----------|----------|------|
| 1 | コンテンツ切り詰め | 64KB（65,536バイト・UTF-8）超過時、先頭に切り詰め |
| 2 | プライバシーヘッダーチェック | `Cache-Control` などのHTTPヘッダー確認 |
| 3 | PrivacyPipeline処理 | PIIマスキング、プロンプトインジェクション対策 |
| 4 | AI API送信 | さらにプロバイダ別の送信上限を適用して送信（OpenAI互換: 既定1万文字、Gemini: 3万文字、ローカルLLM: 4,000文字、内蔵AI: 約1.6万文字） |
| 5 | Obsidian保存 | AI要約結果を保存 |

**重要なポイント：**
- 切り詰め後のコンテンツのうち、プロバイダ別の送信上限以内のみがAI APIに送信されます（64KBいっぱいまで送られるわけではありません）
- 64KB（65,536バイト）以降のコンテンツはAI APIには送信されません

これはPIIの観点から言えば、**「切り詰め以降に含まれるPIIはAI APIに送信されない」** という意味で、**安全側の挙動**です。

> [!TIP]
> AI APIに送信されるのは切り詰め後の先頭部分かつプロバイダ別上限以内のみであるため、ページの後半部分に含まれる機密情報はAI APIには送信されません。これはプライバシー保護の観点から安全な設計です。

#### サニタイズのガード値

64KB切り詰め以外にも、以下のガード値が適用されます：

| ガード | 値 | 超過時の動作 |
|--------|-----|--------------|
| 入力上限 | 64KB（65,536文字） | マスク実行＋エラー付与 |
| 入力上限（サイズ制限スキップ時） | 512KB | マスク実行＋エラー付与 |
| 出力上限 | 128KB | 出力切り詰め＋エラー付与 |
| タイムアウト | 5秒 | 処理中断（エラー） |
| マッチ件数上限 | 1000件 | 処理中断（エラー） |
| ReDoS 長トークンガード | 100文字超の非空白連続はサンプリング走査 | 検出精度を保ったまま正規表現エンジンの暴走を防止 |

#### PII検出（WASM-first ハイブリッド）
実際に試すには [PII Sandbox](pii-sandbox.html) を開いてください。

本番経路は WASM-first のハイブリッド方式 `sanitizePiiHybrid()` です。Rust 実装（`wasm/pii-sanitizer/`）の WASM コアが全21パターンを検出・マスクします。TypeScript の `sanitizeRegex()` は、WASM 初期化失敗時または WASM 呼び出しの実行時例外時のフォールバックとしてのみ使用されます。

以下の21パターン（型名 + 対象）を自動検出してマスクします。マスク形式は `[MASKED:<camelCase type>]`（例: `[MASKED:phoneJp]`、`[MASKED:creditCard]`）です。

| 型名 | 対象 |
|------|------|
| `email` | メールアドレス |
| `creditCard` | クレジットカード番号（Luhn 検証で偽陽性を除外） |
| `myNumber` | マイナンバー（12桁、区切り必須） |
| `phoneJp` | 日本の電話番号 |
| `bankAccount` | 銀行口座番号（7桁） |
| `driverLicense` | 日本の運転免許番号（連続12桁） |
| `jpPassport` | 日本のパスポート番号（英字2文字＋数字7桁） |
| `ipv4` | IPv4アドレス（プライベートレンジのみ） |
| `ipv6` | IPv6アドレス |
| `ssn` | 米国社会保障番号（3-2-4形式） |
| `phoneUs` | 米国の電話番号 |
| `phoneCn` | 中国の電話番号 |
| `idCn` | 中国の身分証番号（18桁、末尾は X 可） |
| `rrnKr` | 韓国の住民登録番号 |
| `phoneKr` | 韓国の電話番号 |
| `iban` | IBAN（DE / FR / IT / ES / NL） |
| `deTaxId` | ドイツ納税者番号（11桁） |
| `frInsee` | フランス INSEE番号（15桁） |
| `itCodiceFiscale` | イタリア税務コード（16文字） |
| `esDni` | スペイン DNI（数字8桁＋英字1文字） |
| `esNie` | スペイン NIE（X/Y/Z＋数字7桁＋英字1文字） |

#### プロンプトインジェクション対策
AI要約時のセキュリティ保護機能：
- **検出パターン**: `ignore above`、`SYSTEM`、`PASSWORD`、`execute()` 等の危険パターンを検出
- **リスク評価**: HIGH / MEDIUM / LOW の3段階で評価し、HIGH 部分は `[FILTERED]` に置き換え。LOW（`password`、`execute` などの一般語）は文脈分析で評価
- **ブロック判定**: コンテキストごとのポリシーに従う。ローカル入力・プロバイダー入力・内蔵AI入力で HIGH を検出した場合のみブロックし、要約文コンテキストでは警告ログを残してサニタイズ継続する。MEDIUM はすべてのコンテキストで通過する
- **ログ記録**: 検出されたパターンとブロック原因をログに記録

#### ログ確認
マスキング実行ログは、`PII_SANITIZE_LOGS` 設定が有効な場合（初期値: 有効）に `SANITIZE` ログとして記録されます（`addLog(LogType.SANITIZE, ...)`）。同設定で記録の有効・無効を切り替えできます。

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

1. 拡張機能アイコンをクリックしてポップアップを開き、右上の **「⚙」アイコン** からダッシュボードを開く
2. ダッシュボードの **「Domain Filter」** パネルを開く
3. **「ホワイトリスト」** セクションにドメインを追加
    - 例: `confluence.example.com`
    - 記録パイプラインのホワイトリスト照合はドメインの完全一致のみです。ワイルドカード（`*.confluence.example.com` 形式）はここでは適用されません（ワイルドカードやサブドメイン一致はポップアップ・Domain Filter 側の機能です）。

#### 重要: PIIマスキングは引き続き実行されます

ホワイトリストドメインでプライバシー警告がスキップされても、**マイナンバー、クレジットカード番号、メールアドレス等のPII（個人情報）は必ずマスクされてからAIに送信されます**。

これにより、社内システムでの利便性とセキュリティの両立が実現します。

### Local Only / Full Pipeline について

Local Only / Full Pipeline は、ブラウザ内蔵 AI（Chrome の Gemini Nano / Edge の Phi-mini など）を利用してローカルで要約を行うモードです。API キー不要でデータをデバイス外に送信せず、インターネット接続がなくても動作します。ただし、対応ブラウザであることに加え、該当するフラグを有効化し、モデルをダウンロードしておく必要があります。詳しいセットアップ手順は [Built-in AI 設定ガイド](BUILT_IN_AI_SETUP_GUIDE.md) を参照してください。

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

**A. ダッシュボードの SQLite History パネル**で確認できます。自動保存時の動作が `skip` に設定されている場合、プライベートページ検出が発動したページは Obsidian には保存されず、パネル下部の保留（pending）セクションに一覧表示されます。「今すぐ記録」ボタンでその場から手動保存できます。スキップされたページは24時間後に自動削除されます。

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
2. **PII Masking**: Detect sensitive information such as credit card numbers, phone numbers, tax IDs (German), etc. using a WASM-first hybrid detector (21 patterns) and replace them with typed tokens like `[MASKED:email]`.
3. **Content Cleansing**: Remove unwanted elements (ads, navigation, SNS embeds, etc.) from web pages before AI summarization.
4. **Preview & Edit Modal**: Modal UI to verify and edit masking results before sending.

### Configuration

Open the extension popup and click the **"⚙" icon** in the top-right to open the Dashboard, then configure in the **"Privacy"** panel.

| Mode | Description |
| :--- | :--- |
| **Masked Cloud** (Recommended) | PII masking + cloud AI. Masks sensitive data before sending. Best balance of privacy and convenience. |
| **Full Pipeline** | Local AI summary + PII masking + cloud AI finishing. Works on supported browsers with Built-in AI enabled. |
| **Local Only** | On-device processing only using the browser's Built-in AI. No API key, works offline on supported browsers. |
| **Cloud Only** | Sends raw data to cloud AI without masking or cleansing. |

#### Workflow

1. Click **"📝 Record Now"**.
2. **Confirmation Modal** appears.
    - Verify that phone numbers etc. in the text are hidden like `[MASKED:phoneJp]`.
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

Large page content is truncated to 64KB (65,536 bytes, UTF-8) at the first stage of the recording pipeline, and only the leading part is processed. This is implemented for the following reasons:

- Performance: Prevents large pages from hanging the processing pipeline
- API Cost: Limits the amount of data sent to AI APIs

**Processing Order and AI API Transmission:**

| Processing Order | Step | Description |
|------------------|------|-------------|
| 1 | Content Truncation | If over 64KB (65,536 bytes, UTF-8), truncate to the leading part |
| 2 | Privacy Header Check | Check HTTP headers like `Cache-Control` |
| 3 | PrivacyPipeline Processing | PII masking, prompt injection protection |
| 4 | Send to AI API | Apply the per-provider send cap and send (OpenAI-compatible: 10,000 chars by default, Gemini: 30,000, local LLM: 4,000, Built-in AI: ~16,384) |
| 5 | Save to Obsidian | Save AI summary result |

**Key Points:**
- Of the truncated content, only the portion within the per-provider send cap is sent to the AI API (the full 64KB is not necessarily sent)
- Content beyond 64KB (65,536 bytes) is NOT sent to the AI API

From a PII perspective, this means **"PII contained beyond the truncation point will not be transmitted to the AI API"**, which is a **conservative/safe behavior**.

> [!TIP]
> Since only the leading part of the truncated content, within the per-provider cap, is sent to the AI API, sensitive information in the latter part of the page is not transmitted to the AI API. This is a safe design from a privacy protection perspective.

#### Sanitizer Guard Values

In addition to the 64KB truncation, the following guards apply:

| Guard | Value | Behavior on exceed |
|-------|-------|--------------------|
| Input limit | 64KB (65,536 characters) | Masking still runs, error attached |
| Input limit (size limit skipped) | 512KB | Masking still runs, error attached |
| Output limit | 128KB | Output truncated, error attached |
| Timeout | 5 seconds | Processing aborted (error) |
| Match count limit | 1000 matches | Processing aborted (error) |
| ReDoS long-token guard | Non-whitespace runs over 100 chars are sampled for scanning | Prevents regex engine blowup while preserving detection |

#### PII Detection (WASM-First Hybrid)
Try it at [PII Sandbox](pii-sandbox.html).

The production path is the WASM-first hybrid `sanitizePiiHybrid()`. The Rust-based (`wasm/pii-sanitizer/`) WASM core detects and masks all 21 patterns. The TypeScript `sanitizeRegex()` is used only as a fallback when WASM initialization fails or a WASM call throws at runtime.

The following 21 patterns (type name + target) are detected and masked automatically. The mask format is `[MASKED:<camelCase type>]` (e.g. `[MASKED:phoneJp]`, `[MASKED:creditCard]`).

| Type | Target |
|------|--------|
| `email` | Email addresses |
| `creditCard` | Credit card numbers (false positives filtered by Luhn validation) |
| `myNumber` | My Number (12 digits, separators required) |
| `phoneJp` | Japanese phone numbers |
| `bankAccount` | Bank account numbers (7 digits) |
| `driverLicense` | Japanese driver's license numbers (12 consecutive digits) |
| `jpPassport` | Japanese passport numbers (2 letters + 7 digits) |
| `ipv4` | IPv4 addresses (private ranges only) |
| `ipv6` | IPv6 addresses |
| `ssn` | US Social Security Numbers (3-2-4 format) |
| `phoneUs` | US phone numbers |
| `phoneCn` | Chinese phone numbers |
| `idCn` | Chinese ID numbers (18 digits, trailing X allowed) |
| `rrnKr` | Korean Resident Registration Numbers |
| `phoneKr` | Korean phone numbers |
| `iban` | IBAN (DE / FR / IT / ES / NL) |
| `deTaxId` | German tax IDs (11 digits) |
| `frInsee` | French INSEE numbers (15 digits) |
| `itCodiceFiscale` | Italian Codice Fiscale (16 characters) |
| `esDni` | Spanish DNI (8 digits + 1 letter) |
| `esNie` | Spanish NIE (X/Y/Z + 7 digits + 1 letter) |

#### Prompt Injection Protection
Security protection feature during AI summarization:
- **Detection Patterns**: Detects dangerous patterns like `ignore above`, `SYSTEM`, `PASSWORD`, `execute()`
- **Risk Assessment**: Evaluates content as HIGH / MEDIUM / LOW and replaces HIGH-risk parts with `[FILTERED]`; LOW-risk generic words (like `password`, `execute`) are evaluated via context analysis
- **Blocking Policy**: Follows a per-context policy. HIGH-risk content blocks only in local-input, provider-input, and built-in-AI-input contexts; summary contexts log a warning and continue with the sanitized content. MEDIUM passes through in every context
- **Logging**: Records detected patterns and block reasons in logs

#### Log Viewing
Masking execution logs are recorded as `SANITIZE` logs when the `PII_SANITIZE_LOGS` setting is enabled (default: enabled) via `addLog(LogType.SANITIZE, ...)`. Use the same setting to toggle log recording.

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

1. Click the extension icon to open the popup, then click the **"⚙" icon** in the top-right to open the Dashboard
2. Open the **"Domain Filter"** panel in the Dashboard
3. Add domains to the **"Whitelist"** section
    - Example: `confluence.example.com`
    - The recording pipeline matches the whitelist by exact domain only. Wildcards (e.g. `*.confluence.example.com`) are not applied here (wildcard and subdomain matching are popup / Domain Filter-side features).

#### Important: PII Masking Still Applies

Even if privacy warnings are skipped for whitelisted domains, **PII (Personal Identifiable Information) such as My Number, credit card numbers, and email addresses are always masked before being sent to AI**.

This achieves a balance between convenience and security for internal systems.

### About Local Only / Full Pipeline

Local Only and Full Pipeline use your browser's Built-in AI (such as Chrome's Gemini Nano or Edge's Phi-mini) to summarize locally. No API key is required and data is not sent outside your device, so these modes can work offline. However, they require a supported browser, the relevant flags to be enabled, and the model to be downloaded. See the [Built-in AI Setup Guide](BUILT_IN_AI_SETUP_GUIDE.md) for detailed setup instructions.

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

**A. In the Dashboard's SQLite History panel.** When the auto-save behavior is set to `skip`, pages triggered by private page detection are not saved to Obsidian, but appear in the pending section at the bottom of the panel. You can manually save them from there using the "Record Now" button. Skipped pages are automatically deleted after 24 hours.

#### Q. The "PII Masking" line in History shows masked phone numbers/emails, but the token count doesn't change. Is this a bug?

**A. No, this is not a bug.** Each History entry displays two independent reduction metrics on separate lines, with different origins:

| Line | What it measures | When it's measured |
|------|-------------------|---------------------|
| **Content Cleansing** | DOM element removal from page content (ads, navigation, etc.) | During content extraction |
| **PII Masking** | Replacement of personal information with `[MASKED:*]` | Just before sending to AI |

The token count on the "PII Masking" line is a rough estimate (Japanese text is approximated as 2 characters per token) computed on the text including mask replacement strings like `[MASKED:phoneJp]`. Since a mask replacement string can be **longer** than the original phone number fragment it replaces, the character-count change from masking doesn't always show up after rounding to an integer token count — so you may see `82 → 82` even though masking actually ran.

To confirm masking actually happened, check the **detected count** on the same line (e.g., `Detected: 2`). If the detected count is 1 or more, PII masking is working correctly even if the token count looks unchanged.