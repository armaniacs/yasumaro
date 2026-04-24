# Svelte + Tailwind Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Svelte 5 + Tailwind CSS 4へ全UIをMigrationし、E2E testで正确性を保证する

**Architecture:** Popup/Dashboard/Offscreen全UIをvanilla TSからSvelte+TailwindへMigration。E2E testで Migration正确性を确认后、完全化

**Tech Stack:** Svelte 5.x, Tailwind 4.x, Playwright (既存)

---

## Phase 1: E2E Test作成

### Task 1: Popup E2E Test作成

**Files:**
- Create: `e2e/popup-settings.test.ts`

- [ ] **Step 1: Write the failing test (AI Provider切替)**

```typescript
test('AI Provider切替后对应のsetting panelが表示される', async ({ page }) => {
  await page.goto('popup.html');
  
  // デフォルトはGemini
  const geminiPanel = page.locator('#geminiSettings');
  await expect(geminiPanel).toBeVisible();
  
  // OpenAIに切替
  await page.selectOption('#aiProvider', 'openai');
  await expect(geminiPanel).toBeHidden();
  
  const openaiPanel = page.locator('#openaiSettings');
  await expect(openaiPanel).toBeVisible();
});
```

- [ ] **Step 2: Run test to verify it passes (既存のvanilla实现で动作确认済み → PASSすることを確認)**

- [ ] **Step 3: Commit**

---

### Task 2: Popup設定保存 Test

**Files:**
- Modify: `e2e/popup-settings.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test('設定を保存后又正常読み込み', async ({ page }) => {
  await page.goto('popup.html');
  
  await page.fill('#port', '9999');
  await page.click('#save');
  
  // 再読み込み
  await page.reload();
  
  await expect(page.locator('#port')).toHaveValue('9999');
});
```

---

### Task 3: Domain Filter Test

**Files:**
- Create: `e2e/popup-domain-filter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test('Domain Filter Mode切替でlist表示が变化', async ({ page }) => {
  await page.goto('popup.html');
  await page.click('#domainTab');
  
  // Whitelist mode
  await page.check('#filterWhitelist');
  const whitelistSection = page.locator('#whitelistTextarea');
  await expect(whitelistSection).toBeVisible();
  
  // Blacklist mode
  await page.check('#filterBlacklist');
  const blacklistSection = page.locator('#blacklistTextarea');
  await expect(blacklistSection).toBeVisible();
});
```

---

### Task 4: Tab Navigation Test

**Files:**
- Create: `e2e/popup-tabs.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test('4つのTab正确に表示切替', async ({ page }) => {
  await page.goto('popup.html');
  
  const tabs = ['#generalTab', '#domainTab', '#promptTab', '#privacyTab'];
  const panels = ['#generalPanel', '#domainPanel', '#promptPanel', '#privacyPanel'];
  
  for (let i = 0; i < tabs.length; i++) {
    await page.click(tabs[i]);
    await expect(page.locator(panels[i])).toBeVisible();
  }
});
```

---

## Phase 2: Svelte + Tailwind环境構築

### Task 5: package.json更新

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add Svelte and Tailwind dependencies**

```bash
npm install -D svelte @sveltejs/vite-plugin-svelte tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: Update package.json scripts**

```json
{
  "scripts": {
    "dev": "wxt",
    "build": "wxt build"
  }
}
```

- [ ] **Step 3: Commit**

---

### Task 6: Vite + Svelte設定

**Files:**
- Create: `svelte.config.js`

```javascript
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: {
    target: 'esnext'
  }
});
```

- [ ] **Step 1: Create svelte.config.js**

---

### Task 7: Tailwind設定

**Files:**
- Create: `src/popup/styles/app.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --font-sans: system-ui, -apple-system, sans-serif;
}
```

- [ ] **Step 1: Create Tailwind CSS file**

- [ ] **Step 2: Commit**

---

## Phase 3: 漸進的Migration

### Task 8: 基本Component作成 (Button)

**Files:**
- Create: `src/popup/components/Common/Button.svelte`

```svelte
<script>
  export let variant = 'primary'; // primary, secondary
  export let disabled = false;
</script>

<button
  class="px-4 py-2 rounded {variant === 'primary' ? 'bg-blue-600 text-white' : 'bg-gray-200'}"
  {disabled}
  on:click
>
  <slot />
</button>
```

- [ ] **Step 1: Write the failing test**

```typescript
test('Button Componentが正しくrender', async ({ page }) => {
  // Svelte version確認
});
```

- [ ] **Step 2: Create Button.svelte**

- [ ] **Step 3: Commit**

---

### Task 9: Input Component

**Files:**
- Create: `src/popup/components/Common/Input.svelte`

---

### Task 10: Settings Panel Migration

**Files:**
- Modify: `src/popup/settingsForm.ts` → Create: `src/popup/components/Settings/`

- [ ] **Step 1: AI Provider Select Component**

```svelte
<script>
  import { providerStore } from '../stores/settings.js';
  
  export let elements;
  
  $: providerStore.set($elements.select.value);
</script>

<select bind:value={$providerStore} on:change={() => updateVisibility(elements)}>
  <option value="gemini">Gemini</option>
  <option value="openai">OpenAI</option>
  <option value="openai2">OpenAI (Compatible)</option>
</select>

<div id="geminiSettings" class:hidden={$providerStore !== 'gemini'}>
  <slot name="gemini" />
</div>
```

- [ ] **Step 2: Migration各完成后E2E test実行**

- [ ] **Step 3: Commit**

---

### Task 11-13: DomainFilter, Navigation, Offscreen Migration

(同様のPatternでMigration)

---

## Phase 4: 完全化

### Task 14: E2E Test全通過確認

**Files:**
- Modify: `e2e/*.test.ts`

- [ ] **Step 1: 全E2E test実行**

```bash
npm run test:e2e
```

- [ ] **Step 2: 结果确认 - 全部PASS**

---

### Task 15: Vanilla代码削除 (Rollback可能な状态确认后)

**Files:**
- Delete: `src/popup/*.ts` (温かい殘しでRollback可能)

- [ ] **Step 1: 全E2E test再実行**

- [ ] **Step 2: Vanilla代码削除commit**

---

## Execution Options

**Plan complete and saved to `docs/superpowers/plans/2026-04-20-svelte-tailwind-migration-plan.md`. Two execution options:**

1. **Subagent-Driven (recommended)** - dispatch fresh subagent per task
2. **Inline Execution** - execute tasks in this session

**Which approach?**