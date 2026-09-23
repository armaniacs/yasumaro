# AIによる自動要約ガイド / AI Summarization Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

Yasumaro は、記録対象と判定されたページの本文を AI に送信し、簡潔な要約を生成します。ページを読むだけで、あとから見返せる要約付きの記録が自動的に溜まっていきます。

### 対応AIプロバイダー

| プロバイダー | 備考 |
|------------|------|
| **Built-in AI** | ブラウザ内蔵AI。Chrome の Gemini Nano / Edge の Phi-mini。API キー不要・オフライン動作（対応ブラウザかつフラグ有効化・モデルダウンロードが必要） |
| **Google Gemini** | クラウドAI。デフォルトのおすすめ |
| **OpenAI Compatible** | Groq、OpenAI、Anthropic など、OpenAI互換APIを提供する多数のサービスに対応 |
| **OpenAI Compatible 2** | 2つ目の互換プロバイダー枠。ローカルLLMなどのサブ設定用 |
| **LM Studio** | ローカルで動くLM Studio（`http://127.0.0.1:1234/v1`） |
| **Ollama** | ローカルで動くOllama（`http://localhost:11434/v1`） |
| **OpenAI Compatible (Models.dev)** | Models.dev のモデル一覧から選択して接続 |

接続方式は 3 種類のストラテジーです（`GeminiProvider` / `GenericOpenAICompatibleProvider` / `BuiltInAiProvider`）。Groq・Anthropic・ローカルLLM 等は「OpenAI Compatible」の枠で Base URL を差し替えるだけで使えます。Built-in AI はブラウザの LanguageModel API（旧称 Prompt API）を直接使用します。詳しいセットアップ手順は [セットアップガイド](SETUP_GUIDE.md)、Built-in AI 固有の手順は [Built-in AI 設定ガイド](BUILT_IN_AI_SETUP_GUIDE.md) を参照してください。

プロバイダーの Base URL は origin 単位で認可されます。既知の AI プロバイダーのエンドポイントとローカル（loopback）アドレスは追加設定なしで利用でき、それ以外の origin は保存時に確認ダイアログで明示的に許可した場合のみ使えます。許可の記録はデバイスローカルであり、設定のエクスポート/インポートには含まれません（インポートした設定で新しい origin を使う場合は再度許可が必要です）。

### 要約生成の流れ

```
1. コンテンツ抽出（ページ本文の主要部分を選択）
   ↓
2. Content Cleansing（有効な場合。保存前のクレンジング）
   ↓
3. AI Summary Cleansing（有効な場合。要約前のクレンジング）
   ↓
4. 優先度順に AI プロバイダー（Built-in AI、クラウドAI、ローカルLLM など）へ送信し、要約を生成
   ↓
5. Obsidian / SQLite / ローカルMarkdown へ保存
```

クレンジングの処理順序と各機能の役割の詳細は、[クレンジングの順番](CLEANSING_ORDER.md) を参照してください。日本語サイト特化オプションやドメイン別ホワイトリスト抽出モードについても同ガイドで説明しています。

### 優先度フォールバック（1〜3位設定）

ダッシュボードの「初期設定」で、AIプロバイダーを優先度1〜3位まで設定できます。要約生成時は以下のルールで順に試行されます。

1. 優先度1位のプロバイダーで要約を試みる
2. 成功し、かつ要約の長さが最小文字数（`Summary Min Length`）以上であれば、その結果を採用して終了
3. 失敗した場合、または要約が短すぎる場合は、優先度2位のプロバイダーに切り替えて再試行
4. 2位も失敗すれば3位で再試行

優先度リストが未設定の場合は、従来通り単一の「AI Provider」設定のみが使用されます。ローカルLLMをメインに据えつつ、失敗時のみクラウドAIにフォールバックする、といった構成も可能です。

### コンテンツサイズとコスト管理

- **Max Tokens Per Prompt**（デフォルト: 1,000）: 1回のプロンプトに含める最大トークン数
- **AI Timeout**（デフォルト: 0 = 自動）: AI応答を待つ最大時間。0（自動）の場合、ローカルプロバイダーは 120,000ms、それ以外は 30,000ms として解決されます。Gemini は設定値に関わらず 30,000ms 固定です
- AI送信時の本文文字数上限はプロバイダーごとに異なります（設定で変更可能）：

| プロバイダー | 送信文字数上限（デフォルト） | 設定キー |
|------------|--------------------------|---------|
| OpenAI互換（クラウド） | 10,000文字 | `OPENAI_CONTENT_CHARS`（デフォルト 10000） |
| Gemini | 30,000文字 | `GEMINI_CONTENT_CHARS`（デフォルト 30000） |
| OpenAI互換（ローカルURL） | 4,000文字 | —（ローカル判定時は固定） |
| Built-in AI | 16,384文字 | —（セッションのコンテキストウィンドウが狭い場合はさらに切り詰め） |

なお、65,536文字（64KB）はPIIサニタイザーの入力サイズ上限であり、AI送信時の切り詰め上限ではありません（詳細は [PII機能ガイド](PII_FEATURE_GUIDE.md) を参照）

### プロンプトのカスタマイズ

要約時に使用するシステムプロンプト・ユーザープロンプトは自由にカスタマイズできます。プロバイダーごとに異なるプロンプトを設定することも可能です。詳細は [AIプロンプトカスタマイズガイド](USER-GUIDE-AI-PROMPT.md) を参照してください。

### プライバシーとの関係

AIに送信する前に、PIIマスキング（メールアドレス・クレジットカード番号・電話番号など）が適用されます。マスキングの詳細は [PII機能ガイド](PII_FEATURE_GUIDE.md) を参照してください。

また、どのプロバイダーにいつ要約を送信したかは監査ログに記録され、ダッシュボードの「Export Logs」パネルから後から確認できます。

### 使用量の警告

月間の利用量が一定のしきい値を超えると、ダッシュボードに警告が表示されます。APIコストを意識してプロンプトサイズやタイムアウトを調整する際の目安にしてください。

### よくある質問

**Q. AIプロバイダーへの接続に失敗する**

ダッシュボードの「Test AI」で接続テストを行い、Base URL・APIキー・モデル名が正しいか確認してください。接続テストは実際に AI へ短いプロンプトを1往復させ、送信内容・受信内容・モデル名・所要時間・HTTP ステータスを画面に表示します。空応答は成功扱いにならないため、「テストは通ったのに本番で要約が空」という状態を切り分けられます。優先度リストを設定している場合、1位が失敗しても自動的に2位・3位が試行されるため、複数プロバイダーを登録しておくと可用性が上がります。

**Q. 要約が短すぎる・空になることがある**

`Summary Min Length` の設定値を確認してください。生成された要約がこの文字数を下回ると、そのプロバイダーの結果は採用されず次の優先度へフォールバックします。

### 過剰削減ガード（送信前に何が起きるか）

本文がAIに届く前に、3つのガードが「空の断片」での送信を防ぎます: **候補フロア**（スコア1位の候補が文字数フロア未満なら次点候補またはページ本文へフォールバック）、**コンテンツクレンジング過剰削減からの復元**（削除後が削減率・フロア未満ならクレンジング前の候補テキストへ復元）、既存の**AI要約クレンジング過剰削減フォールバック**（pre-AIテキスト／本文へ復元）。3つは優先順 ② > ③ > 短文本文 の単一ポリシーで共有され、発動したガードの理由は履歴エントリの「フォールバック理由」行（`candidate_too_small` / `content_overcut` / `over_cleansed` / `short_content`）に残ります。

2つの新ガードと共有の文字数フロアは **Dashboard → AI Summary Cleansing → 過剰削減ガード** で切り替えられます（どちらも既定ON）。ホワイトリスト抽出サイトは v1 ではガード対象外です。記録後も要約が薄すぎる場合は、下記の再生成フローを使ってください。

### AI要約の手動再生成

**Dashboard → SQLite History** の各エントリヘッダーにある **「AI要約を作り直す」** ボタンで、既存レコードの要約を作り直せます。ページ本文を再取得し、記録時と同じパイプラインを通した結果で**同じ行を上書き**します（新規行は増えません）。

再生成時にクレンジングの緩和度を選べます:

| 選択肢 | 動作 |
|---|---|
| **現在の設定** | グローバル設定のまま再生成（既定） |
| **やや緩い** | AI要約クレンジング（③）のルールを1段階下げる（`aggressive` → `balanced` → `minimal`。`balanced` / `custom` / `minimal` は `minimal` が下限）。Content Cleansing（②）は変更なし |
| **最も緩い** | Content Cleansing（②）と AI要約クレンジング（③）の両方を無効化 |

この緩和は**1回の再生成にのみ適用**され、設定は保存されません（次回の自動記録にはグローバル設定が使われます）。①候補選択の緩和 knob は v1 では無く、過剰削減ガードは緩和中も発火します。

再生成は同一行の UPDATE です。Obsidian・ローカル Markdown への自動出力は行わないため、送信し直したい場合は既存の「追記」ボタンを使ってください。レート制限は再生成専用のバケットで、通常の記録と別に計上されます。

**選択一括再生成**: エントリ一覧でチェックボックスを複数選択し、選択バーの「AI要約を作り直し」を押すと、**現在の設定**で順次再生成します。完了時に成功・失敗件数（実行中の行はスキップ件数として区別）をトースト表示し、一覧を更新します（緩和3択と force は一括では選べません。緩和が必要な場合は個別ヘッダーから実行してください）。同じレート制限バケットを使うため、再生成専用レート制限の影響を受けます。

---

## English

### Overview

Yasumaro sends the body text of pages that meet the recording criteria to an AI provider and generates a concise summary. Just by reading a page, a summarized record automatically accumulates for later review.

### Supported AI Providers

| Provider | Notes |
|----------|-------|
| **Built-in AI** | Browser-integrated AI: Chrome's Gemini Nano / Edge's Phi-mini. No API key required, works offline (requires a supported browser, flag enablement, and model download) |
| **Google Gemini** | Cloud AI. Recommended default |
| **OpenAI Compatible** | Supports many services offering OpenAI-compatible APIs, including Groq, OpenAI, and Anthropic |
| **OpenAI Compatible 2** | A second compatible-provider slot, useful for a local LLM or secondary configuration |
| **LM Studio** | Local LM Studio (`http://127.0.0.1:1234/v1`) |
| **Ollama** | Local Ollama (`http://localhost:11434/v1`) |
| **OpenAI Compatible (Models.dev)** | Connect by selecting a model from the Models.dev catalog |

Internally there are three provider strategies (`GeminiProvider` / `GenericOpenAICompatibleProvider` / `BuiltInAiProvider`) — and Groq, Anthropic, local LLMs, etc. are supported by swapping the Base URL within the "OpenAI Compatible" slot. Built-in AI uses the browser's LanguageModel API (formerly Prompt API) directly. See the [Setup Guide](SETUP_GUIDE.md) for detailed setup steps, and the [Built-in AI Setup Guide](BUILT_IN_AI_SETUP_GUIDE.md) for Built-in AI specific steps.

Provider base URLs are authorized per origin. Known AI-provider endpoints and local (loopback) addresses work without extra setup; any other origin is only usable after you explicitly allow it in the confirmation dialog shown at save time. The grant is device-local and is never included in settings exports or imports (re-allow the origin after importing settings on another device).

### Summarization Flow

```
1. Content Extraction (selects the main body of the page)
   ↓
2. Content Cleansing (if enabled; cleansing before saving)
   ↓
3. AI Summary Cleansing (if enabled; cleansing before summarization)
   ↓
4. Send to AI providers in priority order (Built-in AI, cloud AI, local LLM, etc.) and generate a summary
   ↓
5. Save to Obsidian / SQLite / local Markdown
```

For the detailed cleansing order and what each feature does — including the Japanese site-specific options and the Domain Whitelist Extraction Mode — see [Cleansing Order](CLEANSING_ORDER.md).

### Priority Fallback (Ranks 1–3)

In the dashboard's "Initial Setup," you can configure AI providers with priority ranks 1 through 3. When generating a summary, providers are tried in order:

1. Attempt summarization with the rank-1 provider
2. If it succeeds and the summary length meets or exceeds the configured minimum (`Summary Min Length`), that result is used and the process stops
3. If it fails, or the summary is too short, fall back to the rank-2 provider and retry
4. If rank 2 also fails, retry with rank 3

If no priority list is configured, the single legacy "AI Provider" setting is used as before. This lets you run a local LLM as your primary provider and fall back to a cloud AI only on failure, for example.

### Content Size and Cost Control

- **Max Tokens Per Prompt** (default: 1,000): Maximum tokens included in a single prompt
- **AI Timeout** (default: 0 = auto): Maximum time to wait for an AI response. When 0 (auto), it resolves to 120,000ms for local providers and 30,000ms otherwise. Gemini always uses a fixed 30,000ms
- The send-character cap applied to page content differs per provider (configurable):

| Provider | Send-character cap (default) | Setting key |
|----------|------------------------------|-------------|
| OpenAI-compatible (cloud) | 10,000 chars | `OPENAI_CONTENT_CHARS` (default 10000) |
| Gemini | 30,000 chars | `GEMINI_CONTENT_CHARS` (default 30000) |
| OpenAI-compatible (local URL) | 4,000 chars | — (fixed when the URL is detected as local) |
| Built-in AI | 16,384 chars | — (truncated further when the session context window is narrower) |

Note: 65,536 characters (64KB) is the PII sanitizer's input-size limit, not the AI send cap (see the [PII Feature Guide](PII_FEATURE_GUIDE.md) for details)

### Customizing Prompts

The system and user prompts used during summarization can be freely customized, including per-provider prompts. See the [AI Prompt Customization Guide](USER-GUIDE-AI-PROMPT.md) for details.

### Relationship to Privacy

Before content is sent to an AI provider, PII masking (email addresses, credit card numbers, phone numbers, etc.) is applied. See the [PII Feature Guide](PII_FEATURE_GUIDE.md) for details on masking.

Which provider received a summary request, and when, is recorded in the audit log, viewable from the dashboard's "Export Logs" panel.

### Usage Warnings

When monthly usage exceeds a configured threshold, a warning is shown in the dashboard — a useful signal for adjusting prompt size or timeout settings to manage API costs.

### FAQ

**Q. Connecting to an AI provider fails**

Use "Test AI" in the dashboard to verify the Base URL, API key, and model name are correct. The connection test sends a short prompt to the AI and waits for one round-trip, then displays what was sent, what came back, the model name, the elapsed time, and the HTTP status. An empty response does not count as success, so you can tell apart the "test passed but the real summary is empty" case. If you've configured a priority list, a failure at rank 1 automatically falls through to rank 2 and 3, so registering multiple providers improves availability.

**Q. Summaries are sometimes too short or empty**

Check the `Summary Min Length` setting. If a generated summary falls below this length, that provider's result is discarded and the next priority rank is tried instead.

### Over-cut Guards (what gets sent when cleansing cuts too deep)

Before content reaches the AI, three guards keep the send from being a starved fragment: a **candidate floor** (extraction falls back to the next candidate or the page body when the top candidate is under the character floor), a **Content Cleansing over-cut restore** (restores the pre-cleansing candidate text when stripping leaves it below the reduction ratio or floor), and the existing **AI summary cleansing over-reduction fallback** (restores the pre-AI text / body). All three share one policy with priority ② > ③ > short-body, and each fired guard leaves its reason in the history entry ("Fallback reason" row: `candidate_too_small`, `content_overcut`, `over_cleansed`, `short_content`).

Toggle the two new guards and the shared character floor under **Dashboard → AI Summary Cleansing → Over-cut Guards** (both default on). Whitelist-extracted sites are intentionally excluded from the guards (v1). If summaries are still too thin after a record, use the manual regeneration flow described below.

### Manual Regeneration of AI Summaries

Use the **"Regenerate AI summary"** button in each entry header under **Dashboard → SQLite History** to rebuild an existing record's summary. The page body is re-fetched, run through the same pipeline as the original recording, and the result **overwrites the same row** (no new row is created).

You can choose how much to loosen cleansing for that one regeneration:

| Choice | Behavior |
|---|---|
| **Current settings** | Regenerate with the global settings unchanged (default) |
| **Looser** | Step the AI Summary Cleansing (③) rules down one preset (`aggressive` → `balanced` → `minimal`; `balanced` / `custom` / `minimal` floor at `minimal`). Content Cleansing (②) is untouched |
| **Loosest** | Disable both Content Cleansing (②) and AI Summary Cleansing (③) |

The loosening applies **only to that single regeneration** and is never saved to settings (the next automatic recording still uses the global settings). There is no loosening knob for ① candidate selection in v1, and the over-cut guards keep firing during a loosened run.

Regeneration updates the same row in place. It does not auto-append to Obsidian or local Markdown — use the existing "append" button if you want to send it again. Rate limiting uses a regenerate-only bucket, counted separately from normal recording.

**Bulk regeneration of a selection**: Check multiple entries in the list and press "Regenerate AI summaries" in the selection bar to re-run them sequentially with **current settings**. A toast reports succeeded/failed counts when the run finishes (rows already running are reported as skipped), then the list refreshes (the loosening choices and force option are header-only — use the per-entry header when you need them). The same regenerate-only rate-limit bucket applies.
