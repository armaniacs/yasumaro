# manifest.json host_permissions 最小化

## Context

Chromeストアの審査・ユーザー信頼の観点から、`manifest.json`の`host_permissions`に多数のAIプロバイダーAPIドメインを列挙することは問題があります。

**現状の問題:**
- 多数のAIプロバイダードメインとTrancoドメインが許可リストに含まれている（2000+ドメイン）
- ユーザーには「なぜこんなに多くのサイトにアクセスするのか」と不審に思われる可能性
- Chromeストア審査で過剰な権限要求と判断されるリスク
- 実際にはユーザーが使用するプロバイダーに限定すべき

**現在のmanifest.json:**
```json
"host_permissions": [
  "http://127.0.0.1:27123/*",
  "https://127.0.0.1:27123/*",
  // ...2053ドメイン（Trancoドメインを含む）
]
```

## Decision

### 1. host_permissionsの最小化

**実装結果: host_permissions（23ドメイン）**

```json
"host_permissions": [
  "http://127.0.0.1:27123/*",
  "https://127.0.0.1:27123/*",
  "http://localhost:27123/*",
  "https://localhost:27123/*",
  "http://127.0.0.1:27124/*",
  "https://127.0.0.1:27124/*",
  "http://localhost:27124/*",
  "https://localhost:27124/*",
  "http://127.0.0.1:11434/*",
  "https://127.0.0.1:11434/*",
  "http://localhost:11434/*",
  "https://localhost:11434/*",
  "https://generativelanguage.googleapis.com/*",
  "https://api.openai.com/*",
  "https://*.openai.com/*",
  "https://api.anthropic.com/*",
  "https://api.groq.com/*",
  "https://mistral.ai/*",
  "https://deepseek.com/*",
  "https://voyageai.com/*",
  "https://volcengine.com/*",
  "https://z.ai/*",
  "https://wandb.ai/*",
  "https://api.ai.sakura.ad.jp/*"
]
```

**構成:**
- **Obsidian Local REST API（12ドメイン）**: localhost: 27123/27124/11434 のHTTP/HTTPS
- **localhost**: 127.0.0.1 のバリエーション
- **デフォルトAIプロバイダー（6ドメイン）**: OpenAI、Anthropic、Groq、Mistral、DeepSeek
- **Google Gemini API (generativelanguage.googleapis.com)**

### 2. optional_host_permissionsの追加

**実装結果: optional_host_permissions（36ドメイン）**

```json
"optional_host_permissions": [
  "https://api-inference.huggingface.co/*",
  "https://api.openrouter.ai/*",
  "https://deepinfra.com/*",
  "https://cerebras.ai/*",
  "https://ai-gateway.helicone.ai/*",
  "https://api.publicai.co/*",
  "https://api.venice.ai/*",
  "https://api.scaleway.ai/*",
  "https://api.synthetic.new/*",
  "https://api.stima.tech/*",
  "https://nano-gpt.com/*",
  "https://api.poe.com/*",
  "https://llm.chutes.ai/*",
  "https://api.abliteration.ai/*",
  "https://api.llamagate.dev/*",
  "https://api.gmi-serving.com/*",
  "https://api.sarvam.ai/*",
  "https://xiaomimimo.com/*",
  "https://nebius.com/*",
  "https://sambanova.ai/*",
  "https://nscale.com/*",
  "https://featherless.ai/*",
  "https://galadriel.com/*",
  "https://recraft.ai/*",
  "https://volcengine.com/*",
  "https://z-ai/*",
  "https://wandb.ai/*",
  "https://perplexity.ai/*",
  "https://jina.ai/*",
  "https://voyageai.com/*",
  "https://raw.githubusercontent.com/*",
  "https://gitlab.com/*",
  "https://easylist.to/*",
  "https://pgl.yoyo.org/*",
  "https://nsfw.oisd.nl/*",
  "https://tranco-list.eu/*"
]
```

**構成:**
- **追加AIプロバイダー（28ドメイン）**: HuggingFace他
- **Essential非AIドメイン（8ドメイン）**: GitHub/GitLab（uBlock Import）、Tranco/uBlockデータソース

## Consequences

### Positive

- host_permissionsの大幅削減（2053 → 23、削減率98.9%）
- Chromeストア審査・ユーザー信頼の改善
- Trancoドメインをoptionalに移動（データ更新時のみ権限リクエスト）
- 明示的な権限管理によりセキュリティ向上

### Negative

- 既存ユーザーへのアップデート時に権限リクエストが表示される可能性
- uBlock Import機能使用時にoptional権限リクエストが必要
- Tranco Update使用時にoptional権限リクエストが必要

### Mitigation

- 既存ユーザーへのアップデート通知を明記
- Dashboardで機能使用時に権限リクエストをガイド付きで表示
- CSPSettingsと連携して権限不足時に警告表示

## Implementation Steps

- [x] manifest.jsonのhost_permissionsを最小化（2053 → 23）
- [x] manifest.jsonにoptional_host_permissionsを追加（36ドメイン）
- [x] cspSettings.tsに権限リクエスト処理を実装（requestProviderPermission, requestEssentialPermission, hasPermission）
- [ ] Dashboard UIで権限リクエストをユーザーに提示（次回実装）
- [ ] マイグレーションスクリプト（既存ユーザーの場合）
- [x] テスト：最小化検証（8件パス）
- [x] テスト：権限リクエスト（9件パス）
- [ ] 文書更新

## Status

- **Proposed**: 2026-03-20
- **Approved**: 2026-03-20
- **Implemented**: 2026-03-20（Phase 1: manifest.json最小化完了）
- **Superseded By**: -