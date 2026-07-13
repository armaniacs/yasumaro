# AI Provider Settings Accordion — Design Spec

**Date:** 2026-07-14
**Scope:** Convert AI provider priority settings from flat display to accordion pattern.

## Motivation

3つのAIプロバイダー設定（優先度1/2/3位）がフラットに並んで表示され、Base URL・API Key・モデル名が重複して視認性が低い。ユーザーがどのフィールドがどのプロバイダーに属するか判断しにくい。

## Decision

3つの優先度セクションを `<details>` 要素に変更。既存の `advanced-details` CSS クラスを流用する。

### Before / After

**Before:**
```
AI プロバイダー
─────────────────────────────────
優先度1位（必須）
  [Gemini] [API キー] [モデル名]
優先度2位（任意）
  [OpenAI] [Base URL] [API キー] [モデル名]
優先度3位（任意）
  [Ollama] [Base URL] [API キー（省略可）] [モデル名]
─────────────────────────────────
```

**After:**
```
AI プロバイダー
─────────────────────────────────
▼ 優先度1位（必須）— Gemini
  [Gemini] [API キー] [モデル名]
▶ 優先度2位（任意）— OpenAI
▶ 優先度3位（任意）— Ollama
─────────────────────────────────
```

### HTML変更

```html
<!-- Before: div + h4 -->
<div class="priority-provider-card">
  <h4 class="priority-label">優先度1位（必須）</h4>
  <select id="aiProvider">...</select>
  <div id="priority1ProviderSettings"></div>
  <input id="aiProviderPriority1Model">
</div>

<!-- After: details + summary -->
<details class="priority-details" open>
  <summary class="priority-details-summary">
    <span class="priority-number">1</span>
    <span class="priority-label">優先度1位（必須）</span>
    <span class="priority-provider-name">— Gemini</span>
  </summary>
  <div class="priority-details-content">
    <select id="aiProvider">...</select>
    <div id="priority1ProviderSettings"></div>
    <input id="aiProviderPriority1Model">
  </div>
</details>
```

### `<summary>` の動的更新

プロバイダー選択が変更されたとき、`<summary>` 内のプロバイダー名を自動更新:

```typescript
// 優先度1位のプロバイダー選択変更時
aiProviderSelect.addEventListener('change', () => {
  const selectedOption = aiProviderSelect.options[aiProviderSelect.selectedIndex];
  const providerName = selectedOption.textContent;
  summaryElement.querySelector('.priority-provider-name').textContent = `— ${providerName}`;
});
```

優先度2位・3位も同様。

### デフォルト展開状態

| 優先度 | デフォルト | 理由 |
|--------|----------|------|
| 1位 | 展開（`open`） | 必須設定。最初に設定する場所 |
| 2位 | 折りたたみ | 任意。必要に応じて展開 |
| 3位 | 折りたたみ | 任意。必要に応じて展開 |

### CSS

既存の `advanced-details` クラスを流用:

```css
.priority-details {
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  margin-bottom: 8px;
}

.priority-details-summary {
  padding: 8px 12px;
  cursor: pointer;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
}

.priority-details-summary::marker {
  /* デフォルトの三角矢印を非表示にしてカスタムに */
}

.priority-details-content {
  padding: 0 12px 12px 12px;
}

.priority-number {
  /* 優先度番号のスタイル */
  font-weight: 600;
  color: var(--accent-color);
}

.priority-provider-name {
  color: var(--text-secondary, #666);
  font-weight: 400;
}
```

### 影響範囲

| ファイル | 変更 |
|---------|------|
| `entrypoints/options/index.html` | 3つの `priority-provider-card` div を `<details>` に変更 |
| `entrypoints/options/styles/dashboard.css` | `.priority-details` 系のCSS追加 |
| `src/dashboard/panels/staticForm/generalSettingsPanel.ts` | プロバイダー選択変更時に `<summary>` の表示を更新 |

### テスト

- 既存のダッシュボードE2Eテストがパスすることを確認
- 新テスト不要（UI の見た目変更のみ、ロジック変更なし）

### i18n

`<summary>` 内のテキストは既存の `data-i18n="aiProviderPriority1"` 等を使用。プロバイダー名は動的（`<option>` のテキストから取得）。
