# AIによる自動要約ガイド / AI Summarization Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

Yasumaro は、記録対象と判定されたページの本文を AI に送信し、簡潔な要約を生成します。ページを読むだけで、あとから見返せる要約付きの記録が自動的に溜まっていきます。

### 対応AIプロバイダー

| プロバイダー | 備考 |
|------------|------|
| **Google Gemini** | クラウドAI。デフォルトのおすすめ |
| **OpenAI Compatible** | Groq、OpenAI、Anthropic など、OpenAI互換APIを提供する多数のサービスに対応 |
| **OpenAI Compatible 2** | 2つ目の互換プロバイダー枠。ローカルLLMなどのサブ設定用 |
| **LM Studio** | ローカルで動くLM Studio（`http://localhost:1234/v1`） |
| **Ollama** | ローカルで動くOllama（`http://localhost:11434/v1`） |
| **OpenAI Compatible (Models.dev)** | Models.dev のモデル一覧から選択して接続 |

内部的には Gemini 用と OpenAI 互換用の2つの実装しかなく、Groq・Anthropic・ローカルLLM等は「OpenAI Compatible」の枠に Base URL を差し替えることで対応しています。詳しいセットアップ手順は [セットアップガイド](SETUP_GUIDE.md) を参照してください。

### 要約生成の流れ

```
1. コンテンツ抽出（ページ本文の主要部分を選択）
   ↓
2. Content Cleansing（有効な場合。保存前のクレンジング）
   ↓
3. AI Summary Cleansing（有効な場合。要約前のクレンジング）
   ↓
4. AIプロバイダーへ送信し、要約を生成
   ↓
5. Obsidian / SQLite / ローカルMarkdown へ保存
```

クレンジングの詳細な順序と各機能の役割は [クレンジングの順番](CLEANSING_ORDER.md) を参照してください。

### 優先度フォールバック（1〜3位設定）

ダッシュボードの「初期設定」で、AIプロバイダーを優先度1〜3位まで設定できます。要約生成時は以下のルールで順に試行されます。

1. 優先度1位のプロバイダーで要約を試みる
2. 成功し、かつ要約の長さが最小文字数（`Summary Min Length`）以上であれば、その結果を採用して終了
3. 失敗した場合、または要約が短すぎる場合は、優先度2位のプロバイダーに切り替えて再試行
4. 2位も失敗すれば3位で再試行

優先度リストが未設定の場合は、従来通り単一の「AI Provider」設定のみが使用されます。ローカルLLMをメインに据えつつ、失敗時のみクラウドAIにフォールバックする、といった構成も可能です。

### コンテンツサイズとコスト管理

- **Max Tokens Per Prompt**（デフォルト: 1,000）: 1回のプロンプトに含める最大トークン数
- **AI Timeout**（デフォルト: 自動）: AI応答を待つ最大秒数。空欄の場合は自動調整
- ページ内容は最大64KB（65,536文字）に切り詰められた上でAIに送信されます（詳細は [PII機能ガイド](PII_FEATURE_GUIDE.md) を参照）

### プロンプトのカスタマイズ

要約時に使用するシステムプロンプト・ユーザープロンプトは自由にカスタマイズできます。プロバイダーごとに異なるプロンプトを設定することも可能です。詳細は [AIプロンプトカスタマイズガイド](USER-GUIDE-AI-PROMPT.md) を参照してください。

### プライバシーとの関係

AIに送信する前に、PIIマスキング（メールアドレス・クレジットカード番号・電話番号など）が適用されます。マスキングの詳細は [PII機能ガイド](PII_FEATURE_GUIDE.md) を参照してください。

また、どのプロバイダーにいつ要約を送信したかは監査ログに記録され、ダッシュボードの「監査ログ」パネルから後から確認できます。

### 使用量の警告

月間の利用量が一定のしきい値を超えると、ダッシュボードに警告が表示されます。APIコストを意識してプロンプトサイズやタイムアウトを調整する際の目安にしてください。

### よくある質問

**Q. AIプロバイダーへの接続に失敗する**

ダッシュボードの「Save & Test Connection」で接続テストを行い、Base URL・APIキー・モデル名が正しいか確認してください。優先度リストを設定している場合、1位が失敗しても自動的に2位・3位が試行されるため、複数プロバイダーを登録しておくと可用性が上がります。

**Q. 要約が短すぎる・空になることがある**

`Summary Min Length` の設定値を確認してください。生成された要約がこの文字数を下回ると、そのプロバイダーの結果は採用されず次の優先度へフォールバックします。

---

## English

### Overview

Yasumaro sends the body text of pages that meet the recording criteria to an AI provider and generates a concise summary. Just by reading a page, a summarized record automatically accumulates for later review.

### Supported AI Providers

| Provider | Notes |
|----------|-------|
| **Google Gemini** | Cloud AI. Recommended default |
| **OpenAI Compatible** | Supports many services offering OpenAI-compatible APIs, including Groq, OpenAI, and Anthropic |
| **OpenAI Compatible 2** | A second compatible-provider slot, useful for a local LLM or secondary configuration |
| **LM Studio** | Local LM Studio (`http://localhost:1234/v1`) |
| **Ollama** | Local Ollama (`http://localhost:11434/v1`) |
| **OpenAI Compatible (Models.dev)** | Connect by selecting a model from the Models.dev catalog |

Internally there are only two implementations — one for Gemini and one for OpenAI-compatible APIs — and Groq, Anthropic, local LLMs, etc. are supported by swapping the Base URL within the "OpenAI Compatible" slot. See the [Setup Guide](SETUP_GUIDE.md) for detailed setup steps.

### Summarization Flow

```
1. Content Extraction (selects the main body of the page)
   ↓
2. Content Cleansing (if enabled; cleansing before saving)
   ↓
3. AI Summary Cleansing (if enabled; cleansing before summarization)
   ↓
4. Send to the AI provider and generate a summary
   ↓
5. Save to Obsidian / SQLite / local Markdown
```

For the detailed cleansing order and what each feature does, see [Cleansing Order](CLEANSING_ORDER.md).

### Priority Fallback (Ranks 1–3)

In the dashboard's "Initial Setup," you can configure AI providers with priority ranks 1 through 3. When generating a summary, providers are tried in order:

1. Attempt summarization with the rank-1 provider
2. If it succeeds and the summary length meets or exceeds the configured minimum (`Summary Min Length`), that result is used and the process stops
3. If it fails, or the summary is too short, fall back to the rank-2 provider and retry
4. If rank 2 also fails, retry with rank 3

If no priority list is configured, the single legacy "AI Provider" setting is used as before. This lets you run a local LLM as your primary provider and fall back to a cloud AI only on failure, for example.

### Content Size and Cost Control

- **Max Tokens Per Prompt** (default: 1,000): Maximum tokens included in a single prompt
- **AI Timeout** (default: auto): Maximum seconds to wait for an AI response; auto-adjusts if left blank
- Page content is truncated to at most 64KB (65,536 characters) before being sent to the AI (see the [PII Feature Guide](PII_FEATURE_GUIDE.md) for details)

### Customizing Prompts

The system and user prompts used during summarization can be freely customized, including per-provider prompts. See the [AI Prompt Customization Guide](USER-GUIDE-AI-PROMPT.md) for details.

### Relationship to Privacy

Before content is sent to an AI provider, PII masking (email addresses, credit card numbers, phone numbers, etc.) is applied. See the [PII Feature Guide](PII_FEATURE_GUIDE.md) for details on masking.

Which provider received a summary request, and when, is recorded in the audit log, viewable from the dashboard's "Audit Log" panel.

### Usage Warnings

When monthly usage exceeds a configured threshold, a warning is shown in the dashboard — a useful signal for adjusting prompt size or timeout settings to manage API costs.

### FAQ

**Q. Connecting to an AI provider fails**

Use "Save & Test Connection" in the dashboard to verify the Base URL, API key, and model name are correct. If you've configured a priority list, a failure at rank 1 automatically falls through to rank 2 and 3, so registering multiple providers improves availability.

**Q. Summaries are sometimes too short or empty**

Check the `Summary Min Length` setting. If a generated summary falls below this length, that provider's result is discarded and the next priority rank is tried instead.
