# 条件付きCSP設定ガイド / Conditional CSP Settings Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

Yasumaro の**条件付きCSP（Content Security Policy）**設定は、AIプロバイダーとの接続先を細かく制御するセキュリティ機能です。有効にすると、ユーザーが設定画面で選択したAIプロバイダーのみ接続が許可されます。

本機能は Chrome Extension の CSP ディレクティブと、拡張機能内の `CSPValidator` クラスによる実行時フィルタリングの**二層構造**で実装されています。

> [!NOTE]
> デフォルトでは、主要AIプロバイダー（Google Gemini、OpenAI、Anthropic、Groq、Mistral、DeepSeek、Perplexity、Jina、Voyage）が常に許可されます。追加のプロバイダーを使用する場合にのみ、この設定を編集する必要があります。

---

### 二層CSPモデル

Yasumaro はCSPを2つの層で管理しています。

#### 第一层: manifest.json の connect-src（ブラウザレベル）

Chrome の CSP 機能により、拡張機能が接続できるドメインの上限が定義されます。全対応AIプロバイダーのドメインが列挙されており、ユーザーが将来選択する可能性があるドメインを含みます。

この層は Chrome ブラウザが強制するため、コードからバイパスすることはできません。

#### 第二层: CSPValidator（実行時フィルタリング）

`src/utils/cspValidator.ts` が管理する実行時のURL検証層です。ユーザーが設定画面で有効にしたプロバイダーのドメインのみを許可します。manifest.json よりも厳格なフィルタリングを行い、設定変更に応じて動的に更新されます。

```
fetch要求
    │
    ▼
manifest.json connect-src（第一層）
    │ ブロック → 即座にエラー
    │ 許可
    ▼
CSPValidator（第二層）
    │ ブロック → CSP_BLOCKED エラー
    │ 許可 → fetch実行
```

---

### デフォルトで許可されるAIプロバイダー

以下のプロバイダーは常に接続が許可されます。条件付きCSPの設定変更は不要です。

| プロバイダー | ドメイン |
|-------------|---------|
| Google Gemini | `generativelanguage.googleapis.com` |
| OpenAI | `api.openai.com`、`*.openai.com` |
| Anthropic Claude | `api.anthropic.com` |
| Groq | `api.groq.com` |
| Mistral | `mistral.ai` |
| DeepSeek | `deepseek.com` |
| Perplexity | `perplexity.ai` |
| Jina | `jina.ai` |
| Voyage | `voyageai.com` |

---

### 追加プロバイダーの有効化

デフォルト以外のAIプロバイダー（Hugging Face、OpenRouter、DeepInfra 等）を使用するには、ダッシュボードの「CSP」タブから有効化します。

#### 手順

1. ダッシュボードの「CSP」タブを開く
2. 「条件付きCSPを有効にする」にチェックを入れる
3. 使用したいAIプロバイダーにチェックを入れる
4. 「保存する」をクリック

有効化されたプロバイダーは、Chrome の権限リクエストが表示されます。「許可」をクリックすると、そのプロバイダーへの接続が許可されます。

#### 利用可能な追加プロバイダー

| プロバイダーID | ドメイン |
|---------------|---------|
| huggingface | `api-inference.huggingface.co` |
| openrouter | `api.openrouter.ai` |
| deepinfra | `deepinfra.com` |
| cerebras | `cerebras.ai` |
| venice | `api.venice.ai` |
| scaleway | `api.scaleway.ai` |
| nano-gpt | `nano-gpt.com` |
| poe | `api.poe.com` |
| chutes | `llm.chutes.ai` |
| sarvam | `api.sarvam.ai` |
| nebius | `nebius.com` |
| sambanova | `sambanova.ai` |
| nscale | `nscale.com` |
| featherless | `featherless.ai` |
| galadriel | `galadriel.com` |
| recraft | `recraft.ai` |

---

### OpenAI互換エンドポイントのCSP対応

Ollama や LM Studio などのローカルLLM、または OpenAI 互換APIを使用している場合、設定した Base URL のドメインは自動的にCSPに追加されます。

| プロバイダータイプ | 例 |
|------------------|-----|
| OpenAI (カスタム) | `https://custom.openai.example.com/v1` |
| LM Studio | `http://localhost:1234/v1` |
| Ollama | `http://localhost:11434/v1` |

Base URL が変更された場合、CSPValidator の初期化時に新しいドメインが自動的に許可リストに追加されます。

---

### ローカルLLM接続のポート制限

localhost や 127.0.0.1 からの接続は、以下のポートに限定されています。

| ポート | 用途 |
|--------|------|
| 27123 | Obsidian Local REST API（HTTP） |
| 27124 | Obsidian Local REST API（HTTPS） |
| 11434 | Ollama |
| 1234 | LM Studio |

他のポートへの接続は CSP によりブロックされます。

---

### エラー対処

#### 「APIプロバイダーは条件付きCSPによりブロックされました」

条件付きCSPが有効で、使用したいプロバイダーが有効化されていない場合に表示されます。

**対処法:**
1. ダッシュボードの「CSP」タブを開く
2. 該当するAIプロバイダーにチェックを入れる
3. 「保存する」をクリック

#### CSP設定のリセット

ダッシュボードの「CSP」タブで「リセット」ボタンをクリックすると、すべての追加プロバイダーが無効化され、デフォルト状態に戻ります。

---

### セキュリティ上の注意

- 条件付きCSP は**セキュリティ強化機能**であり、必須ではありません
- 有効にしない場合でも、manifest.json の connect-src により未対応ドメインへの接続は制限されます
- APIキーは暗号化されて `chrome.storage.local` に保存されます
- すべてのCSP検証はローカルで行われ、外部に送信されません

---

### トラブルシューティング

#### Q1. 条件付きCSPを有効にしたがAIプロバイダーに接続できない

- ダッシュボードの「CSP」タブで、使用したいプロバイダーがチェックされているか確認
- Chrome の権限リクエストで「許可」をクリックしたか確認
- 拡張機能を再読み込みしてから再度お試しください

#### Q2. Ollama/LM Studio に接続できない

- 対象のローカルLLMサーバーが起動しているか確認
- ポート番号が正しいか確認（Ollama: 11434、LM Studio: 1234）
- ダッシュボードの「CSP」タブで、Base URL が正しく設定されているか確認

#### Q3. CSP設定のリセット後にプロバイダー設定も消えた

- CSP設定のリセットはCSP許可リストのみをリセットします
- AIプロバイダー自体の設定（APIキーやモデル選択）は「初期設定」タブで管理します

---

## English

### Overview

Yasumaro's **Conditional CSP (Content Security Policy)** settings let you control which AI providers the extension can connect to. When enabled, only AI providers selected in the settings panel are permitted to receive connections.

This feature is implemented with a **two-layer architecture**: Chrome's CSP directive in the manifest and runtime URL validation via the `CSPValidator` class.

> [!NOTE]
> By default, major AI providers (Google Gemini, OpenAI, Anthropic, Groq, Mistral, DeepSeek, Perplexity, Jina, Voyage) are always allowed. You only need to edit these settings when using additional providers.

---

### Two-Layer CSP Model

Yasumaro manages CSP in two layers.

#### Layer 1: manifest.json connect-src (Browser-Level)

Chrome's CSP mechanism defines the upper bound of domains the extension can connect to. All supported AI provider domains are listed, including those users may select in the future.

This layer is enforced by Chrome and cannot be bypassed by code.

#### Layer 2: CSPValidator (Runtime Filtering)

Managed by `src/utils/cspValidator.ts`, this layer performs runtime URL validation. It permits only domains for providers the user has enabled in settings. It is stricter than the manifest layer and updates dynamically based on user configuration.

```
fetch request
    │
    ▼
manifest.json connect-src (Layer 1)
    │ Blocked → immediate error
    │ Allowed
    ▼
CSPValidator (Layer 2)
    │ Blocked → CSP_BLOCKED error
    │ Allowed → fetch executed
```

---

### Default Allowed AI Providers

The following providers are always permitted. No conditional CSP configuration is needed.

| Provider | Domain |
|----------|--------|
| Google Gemini | `generativelanguage.googleapis.com` |
| OpenAI | `api.openai.com`, `*.openai.com` |
| Anthropic Claude | `api.anthropic.com` |
| Groq | `api.groq.com` |
| Mistral | `mistral.ai` |
| DeepSeek | `deepseek.com` |
| Perplexity | `perplexity.ai` |
| Jina | `jina.ai` |
| Voyage | `voyageai.com` |

---

### Enabling Additional Providers

To use AI providers not in the default list (Hugging Face, OpenRouter, DeepInfra, etc.), enable them from the dashboard's "CSP" tab.

#### Steps

1. Open the "CSP" tab in the dashboard
2. Check "Enable Conditional CSP"
3. Check the AI providers you want to use
4. Click "Save"

When enabled, Chrome will show a permission request for that provider. Click "Allow" to permit connections.

#### Available Additional Providers

| Provider ID | Domain |
|-------------|--------|
| huggingface | `api-inference.huggingface.co` |
| openrouter | `api.openrouter.ai` |
| deepinfra | `deepinfra.com` |
| cerebras | `cerebras.ai` |
| venice | `api.venice.ai` |
| scaleway | `api.scaleway.ai` |
| nano-gpt | `nano-gpt.com` |
| poe | `api.poe.com` |
| chutes | `llm.chutes.ai` |
| sarvam | `api.sarvam.ai` |
| nebius | `nebius.com` |
| sambanova | `sambanova.ai` |
| nscale | `nscale.com` |
| featherless | `featherless.ai` |
| galadriel | `galadriel.com` |
| recraft | `recraft.ai` |

---

### OpenAI-Compatible Endpoint CSP Support

When using local LLMs (Ollama, LM Studio) or OpenAI-compatible APIs, the Base URL domain is automatically added to the CSP allowlist.

| Provider Type | Example |
|--------------|---------|
| OpenAI (custom) | `https://custom.openai.example.com/v1` |
| LM Studio | `http://localhost:1234/v1` |
| Ollama | `http://localhost:11434/v1` |

When the Base URL changes, CSPValidator automatically adds the new domain during initialization.

---

### Local LLM Port Restrictions

Connections from localhost or 127.0.0.1 are restricted to the following ports.

| Port | Purpose |
|------|---------|
| 27123 | Obsidian Local REST API (HTTP) |
| 27124 | Obsidian Local REST API (HTTPS) |
| 11434 | Ollama |
| 1234 | LM Studio |

Connections to other ports are blocked by CSP.

---

### Error Handling

#### "API provider blocked by conditional CSP"

This message appears when conditional CSP is enabled but the provider you want to use is not enabled.

**Fix:**
1. Open the "CSP" tab in the dashboard
2. Check the AI provider you want to use
3. Click "Save"

#### Resetting CSP Settings

Click the "Reset" button in the dashboard's "CSP" tab to disable all additional providers and return to the default state.

---

### Security Notes

- Conditional CSP is a **security enhancement**, not a requirement
- Even without enabling it, the manifest.json connect-src restricts connections to unsupported domains
- API keys are encrypted and stored in `chrome.storage.local`
- All CSP validation is performed locally and never sent externally

---

### Troubleshooting

#### Q1. Enabled conditional CSP but cannot connect to AI provider

- Check the "CSP" tab in the dashboard to verify the provider is checked
- Ensure you clicked "Allow" in Chrome's permission request
- Try reloading the extension and attempting again

#### Q2. Cannot connect to Ollama/LM Studio

- Verify the local LLM server is running
- Check the port number (Ollama: 11434, LM Studio: 1234)
- Confirm the Base URL is correctly set in the "CSP" tab

#### Q3. Provider settings were lost after resetting CSP

- CSP reset only clears the CSP allowlist
- AI provider configuration (API keys, model selection) is managed in the "Initial Setup" tab

---

## 関連ドキュメント / Related Documents

- [セットアップガイド / Setup Guide](SETUP_GUIDE.md)
- [AI自動要約ガイド / AI Summary Guide](AI_SUMMARY_GUIDE.md)
- [プライバシーポリシー / Privacy Policy](PRIVACY.md)
