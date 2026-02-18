# AIプロンプトカスタマイズガイド / AI Prompt Customization Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

設定画面の「AIプロンプト」タブで、AI要約時に使用するプロンプトをカスタマイズできます。プロバイダーごとに異なるプロンプトを設定したり、複数のプロンプトを保存して切り替えたりすることができます。

### デフォルトプロンプト

カスタムプロンプトが設定されていない場合、以下のデフォルト値が使用されます。

システムプロンプト（OpenAI互換プロバイダー用）

```
You are a helpful assistant that summarizes web pages effectively and concisely in Japanese.
```

ユーザープロンプト

```
以下のWebページの内容を、日本語で簡潔に要約してください。
1文または2文で、重要なポイントをまとめてください。改行しないこと。

Content:
{{content}}
```

### 使い方

1. 設定画面の「AIプロンプト」タブを開きます
2. 「プロンプトエディタ」で以下の項目を入力します
   - **プロンプト名** — 識別しやすい名前を設定します
   - **適用プロバイダー** — 全プロバイダー共通、またはGemini・OpenAI互換などプロバイダー別に設定できます
   - **システムプロンプト** — OpenAI互換プロバイダー向けのシステムプロンプト（オプション）
   - **ユーザープロンプト** — 要約指示の本文。ページ内容の挿入位置として `{{content}}` を使用してください
3. 「プロンプトを保存」をクリックします
4. 保存済みプロンプト一覧で「有効化」をクリックすると、そのプロンプトがAI要約に使用されます

### `{{content}}` プレースホルダーについて

ユーザープロンプト内の `{{content}}` は、要約対象のWebページ本文に置換されます。プロンプトに必ず含めてください。

### カスタマイズ例

#### 英語で要約したい場合

```
Please summarize the following web page in English in 1-2 sentences.

Content:
{{content}}
```

#### 箇条書きで要約したい場合

```
以下のWebページの内容を、日本語で箇条書き3点で要約してください。

{{content}}
```

#### 技術的な観点で要約したい場合

```
以下のWebページの技術的なポイントを日本語で簡潔に3点まとめてください。

{{content}}
```

#### OpenAIのシステムプロンプトもカスタマイズする場合

システムプロンプト

```
You are a technical writer. Summarize web pages focusing on technical accuracy and key insights.
```

ユーザープロンプト

```
Summarize the following web page in 2-3 concise bullet points. Focus on technical details.

{{content}}
```

### 複数プロンプトの管理

- 複数のプロンプトを保存しておき、シーンに応じて切り替えることができます
- 同じプロバイダーに対して有効化できるプロンプトは1つです
- 「編集」ボタンで内容を修正、「削除」ボタンで削除できます

---

## English

### Overview

In the "AI Prompt" tab of the settings screen, you can customize the prompts used for AI summarization. You can configure different prompts per provider and save multiple prompts to switch between them.

### Default Prompts

When no custom prompt is configured, the following defaults are used.

System Prompt (for OpenAI-compatible providers)

```
You are a helpful assistant that summarizes web pages effectively and concisely in Japanese.
```

User Prompt

```
以下のWebページの内容を、日本語で簡潔に要約してください。
1文または2文で、重要なポイントをまとめてください。改行しないこと。

Content:
{{content}}
```

### How to Use

1. Open the "AI Prompt" tab in the settings screen
2. Fill in the following fields in the "Prompt Editor"
   - **Prompt Name** — An identifying name for the prompt
   - **Apply to Provider** — All providers, or configure per-provider (Gemini, OpenAI Compatible, etc.)
   - **System Prompt** — Optional system prompt for OpenAI-compatible providers
   - **User Prompt** — The summarization instruction body. Use `{{content}}` as a placeholder for the page content
3. Click "Save Prompt"
4. Click "Activate" in the saved prompt list to use that prompt for AI summarization

### About the `{{content}}` Placeholder

`{{content}}` in the user prompt is replaced with the body text of the web page being summarized. Make sure to include it in your prompt.

### Customization Examples

#### Summarize in English

```
Please summarize the following web page in English in 1-2 sentences.

Content:
{{content}}
```

#### Bullet point summary

```
Summarize the following web page in 3 concise bullet points in English.

{{content}}
```

#### Technical focus

```
Explain the key technical points of the following web page in 3 concise points.

{{content}}
```

#### Customize both system and user prompts (OpenAI)

System Prompt

```
You are a technical writer. Summarize web pages focusing on technical accuracy and key insights.
```

User Prompt

```
Summarize the following web page in 2-3 concise bullet points. Focus on technical details.

{{content}}
```

### Managing Multiple Prompts

- Save multiple prompts and switch between them as needed
- Only one prompt can be active per provider at a time
- Use the "Edit" button to modify a prompt, or "Delete" to remove it
