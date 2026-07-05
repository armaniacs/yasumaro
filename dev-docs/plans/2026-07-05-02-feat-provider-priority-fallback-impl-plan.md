# AIプロバイダ優先順位・フォールバック 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AIプロバイダを優先度1〜3位まで設定でき、1位が失敗または最小長未満の要約を返したとき自動的に2位・3位へフォールバックする機能を実装する。

**Architecture:** `StorageKeys.AI_PROVIDER_PRIORITY_LIST`（`ProviderSlot[]`、各スロットに`provider`と任意の`model`）を新規ストレージキーとして追加し、`getSettings()`内で旧`AI_PROVIDER`からの導出マイグレーションを行う。`AIClient.generateSummary()`はスロットを順に試行し、成功かつ最小長以上の要約が得られた時点で返す。ダッシュボードUIには優先度2位・3位のセレクトとモデル入力欄を追加し、選択された全プロバイダの設定欄を同時表示する。

**Tech Stack:** TypeScript (strict, no any/unknown in non-test code), Vitest（`vi.mock`, `vi.fn()`）, Chrome Extension Manifest V3, ESM (`.js`インポート拡張子必須)

**設計書:** [dev-docs/plans/2026-07-05-01-feat-provider-priority-fallback-design.md](2026-07-05-01-feat-provider-priority-fallback-design.md)

**関連PBI:** [dev-docs/plans/2026-07-04-05-feat-summary-retry-fallback.md](2026-07-04-05-feat-summary-retry-fallback.md)

**注記:** 設計書は当初 `dev-docs/plans/2026-07-04-05-feat-summary-retry-fallback.md` の技術的考慮事項に `src/utils/retryHelper.ts` の再利用を挙げていたが、調査の結果 `retryHelper.ts` はService Worker通信（`chrome.runtime.sendMessage`）専用のリトライヘルパーであり、AIプロバイダのフォールバックとは無関係と判明した。本計画ではフォールバックロジックを `src/background/aiClient.ts` に新規実装する。

**テストランナー注記:** プロジェクトのCLAUDE.mdは「Jest」と記載しているが、`package.json`の実際のテストコマンドは `vitest run` であり、既存テスト（`src/background/__tests__/aiClient.test.ts`）も `vitest` の `vi.mock`/`vi.fn()` を使用している。本計画は実際の構成に合わせて Vitest を前提とする。

---

## Task 1: `ProviderSlot`型と`AI_PROVIDER_PRIORITY_LIST`ストレージキーを追加

**Files:**
- Modify: `src/utils/storage/types.ts:21`（`StorageKeys`に追加）
- Modify: `src/utils/storage/types.ts:207`（`StorageKeyValues`に追加）
- Test: `src/utils/__tests__/storage-types.test.ts`（新規）

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// src/utils/__tests__/storage-types.test.ts
import { describe, it, expect } from 'vitest';
import { StorageKeys } from '../storage/types.js';
import type { ProviderSlot, StorageKeyValues } from '../storage/types.js';

describe('AI_PROVIDER_PRIORITY_LIST', () => {
  it('StorageKeysにAI_PROVIDER_PRIORITY_LISTキーが定義されている', () => {
    expect(StorageKeys.AI_PROVIDER_PRIORITY_LIST).toBe('ai_provider_priority_list');
  });

  it('ProviderSlot型はproviderが必須、modelが任意である', () => {
    const slotWithModel: ProviderSlot = { provider: 'gemini', model: 'gemini-3.1-flash-lite' };
    const slotWithoutModel: ProviderSlot = { provider: 'openai' };
    expect(slotWithModel.provider).toBe('gemini');
    expect(slotWithoutModel.model).toBeUndefined();
  });

  it('StorageKeyValuesはAI_PROVIDER_PRIORITY_LISTキーに対してProviderSlot[]を要求する', () => {
    const value: StorageKeyValues[typeof StorageKeys.AI_PROVIDER_PRIORITY_LIST] = [
      { provider: 'gemini' },
      { provider: 'openai', model: 'gpt-4o-mini' }
    ];
    expect(value).toHaveLength(2);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/utils/__tests__/storage-types.test.ts`
Expected: FAIL（`StorageKeys.AI_PROVIDER_PRIORITY_LIST` が `undefined`、`ProviderSlot`型が存在しない）

- [ ] **Step 3: 最小限の実装を追加**

`src/utils/storage/types.ts:21` の直後（`AI_PROVIDER: 'ai_provider',`の次の行）に追加:

```typescript
    AI_PROVIDER: 'ai_provider',
    AI_PROVIDER_PRIORITY_LIST: 'ai_provider_priority_list', // 優先度1〜3位のプロバイダ設定（ProviderSlot[]）
```

`src/utils/storage/types.ts` のファイル冒頭付近（`export const StorageKeys`の前）に型を追加:

```typescript
/**
 * AIプロバイダ優先度スロット
 * provider: 既存6種のプロバイダID ('gemini' | 'openai' | 'openai2' | 'lm-studio' | 'ollama' | 'openai-compatible')
 * model: 省略時はそのプロバイダの既存モデル設定値（例: gemini_model）を使用する
 */
export interface ProviderSlot {
    provider: string;
    model?: string;
}
```

`StorageKeyValues`インターフェース内、`[StorageKeys.AI_PROVIDER]: string;`の行（`src/utils/storage/types.ts:207`）の直後に追加:

```typescript
    [StorageKeys.AI_PROVIDER]: string;
    [StorageKeys.AI_PROVIDER_PRIORITY_LIST]: ProviderSlot[];
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/utils/__tests__/storage-types.test.ts`
Expected: PASS（3 tests passed）

- [ ] **Step 5: 型チェックを実行**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/utils/storage/types.ts src/utils/__tests__/storage-types.test.ts
git commit -m "feat(storage): AIプロバイダ優先度リストのStorageKeyとProviderSlot型を追加"
```

---

## Task 2: `DEFAULT_SETTINGS`にデフォルト値を追加

**Files:**
- Modify: `src/utils/storage/defaults.ts`
- Test: `src/utils/__tests__/storage-defaults.test.ts`（新規）

- [ ] **Step 1: 現状の`defaults.ts`のAI_PROVIDER周辺を確認**

Run: `grep -n "AI_PROVIDER" src/utils/storage/defaults.ts`
Expected: `[StorageKeys.AI_PROVIDER]: 'gemini',` のような行が見つかる（正確な行番号と初期値をここで確認してから次のステップに進むこと）

- [ ] **Step 2: 失敗するテストを書く**

```typescript
// src/utils/__tests__/storage-defaults.test.ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../storage/defaults.js';
import { StorageKeys } from '../storage/types.js';

describe('DEFAULT_SETTINGS.AI_PROVIDER_PRIORITY_LIST', () => {
  it('デフォルトは空配列である（getSettings側でAI_PROVIDERからの導出を行う）', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.AI_PROVIDER_PRIORITY_LIST]).toEqual([]);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run src/utils/__tests__/storage-defaults.test.ts`
Expected: FAIL（プロパティが`undefined`）

- [ ] **Step 4: 実装を追加**

`src/utils/storage/defaults.ts`の`AI_PROVIDER`のデフォルト値定義の直後に追加:

```typescript
    [StorageKeys.AI_PROVIDER_PRIORITY_LIST]: [],
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run src/utils/__tests__/storage-defaults.test.ts`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/utils/storage/defaults.ts src/utils/__tests__/storage-defaults.test.ts
git commit -m "feat(storage): AI_PROVIDER_PRIORITY_LISTのデフォルト値（空配列）を追加"
```

---

## Task 3: `getSettings()`に旧`AI_PROVIDER`からの導出マイグレーションを追加

**Files:**
- Modify: `src/utils/storage.ts:605-611`（新方式パス）
- Modify: `src/utils/storage.ts`（旧方式パス、Step 1で行番号を確認）
- Test: `src/utils/__tests__/storage-provider-priority-migration.test.ts`（新規）

**背景:** `getSettings()`には既に「`obsidian_enabled`が未設定なら`obsidian_api_key`の有無から導出する」という同型のマイグレーションパターンが存在する（`src/utils/storage.ts:607-611`）。同じパターンを`AI_PROVIDER_PRIORITY_LIST`にも適用する。

- [ ] **Step 1: 旧方式パス（`chrome.storage.local.get(keysToGet)`以降）の該当箇所を確認**

Run: `grep -n "旧方式\|keysToGet" src/utils/storage.ts`
Expected: `src/utils/storage.ts:638`付近に旧方式のコードブロックが見つかる。このブロックの`merged`相当の変数名を確認してから次に進む。

- [ ] **Step 2: 失敗するテストを書く**

```typescript
// src/utils/__tests__/storage-provider-priority-migration.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSettings, clearSettingsCache, StorageKeys } from '../storage.js';

describe('AI_PROVIDER_PRIORITY_LIST 自動マイグレーション', () => {
  beforeEach(() => {
    clearSettingsCache();
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn((keys, callback?: (result: Record<string, unknown>) => void) => {
            const result = {
              settings: {
                [StorageKeys.AI_PROVIDER]: 'openai2',
                [StorageKeys.OPENAI_2_API_KEY]: 'dummy-test-apikey-value'
              },
              settings_migrated: true
            };
            if (callback) {
              callback(result);
              return;
            }
            return Promise.resolve(result);
          })
        }
      }
    });
  });

  it('AI_PROVIDER_PRIORITY_LISTが未設定の場合、既存のAI_PROVIDERを1位スロットとして導出する', async () => {
    const settings = await getSettings();
    expect(settings[StorageKeys.AI_PROVIDER_PRIORITY_LIST]).toEqual([
      { provider: 'openai2' }
    ]);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run src/utils/__tests__/storage-provider-priority-migration.test.ts`
Expected: FAIL（`AI_PROVIDER_PRIORITY_LIST`が空配列のまま、または`[{ provider: 'gemini' }]`のデフォルトのまま）

- [ ] **Step 4: 新方式パスに導出ロジックを追加**

`src/utils/storage.ts:605-611`を以下のように変更（既存の`obsidian_enabled`マイグレーションの直後に追加）:

```typescript
        const merged = { ...DEFAULT_SETTINGS, ...filteredSettings };

        // obsidian_enabled が未設定の場合、obsidian_api_key の有無で初期化（既存ユーザー向けマイグレーション）
        if (!(StorageKeys.OBSIDIAN_ENABLED in filteredSettings)) {
            const apiKey = merged[StorageKeys.OBSIDIAN_API_KEY] as string | undefined;
            merged[StorageKeys.OBSIDIAN_ENABLED] = !!(apiKey && apiKey.length >= 16);
        }

        // AI_PROVIDER_PRIORITY_LIST が未設定の場合、既存の AI_PROVIDER を1位スロットとして導出（既存ユーザー向けマイグレーション）
        if (!(StorageKeys.AI_PROVIDER_PRIORITY_LIST in filteredSettings)) {
            const legacyProvider = merged[StorageKeys.AI_PROVIDER] as string | undefined;
            merged[StorageKeys.AI_PROVIDER_PRIORITY_LIST] = legacyProvider ? [{ provider: legacyProvider }] : [];
        }
```

- [ ] **Step 5: 旧方式パスにも同じ導出ロジックを追加**

Step 1で確認した旧方式ブロック内の、settingsがマージされた直後（変数名はStep 1の確認結果に合わせる）に同様の導出コードを追加する。新方式パスと同じ条件式・同じ代入文を旧方式の変数名に置き換えて挿入する。

- [ ] **Step 6: テストが通ることを確認**

Run: `npx vitest run src/utils/__tests__/storage-provider-priority-migration.test.ts`
Expected: PASS

- [ ] **Step 7: 既存のstorage関連テストが壊れていないことを確認**

Run: `npx vitest run src/utils/__tests__/storage.test.ts`
Expected: 既存テストすべてPASS（新規追加による既存挙動への影響がないことを確認）

- [ ] **Step 8: コミット**

```bash
git add src/utils/storage.ts src/utils/__tests__/storage-provider-priority-migration.test.ts
git commit -m "feat(storage): AI_PROVIDERからAI_PROVIDER_PRIORITY_LISTへの自動マイグレーションを追加"
```

---

## Task 4: `AIClient.generateSummary()`にフォールバックロジックを実装

**Files:**
- Modify: `src/background/aiClient.ts:57-75`
- Modify: `src/utils/storage/types.ts`（`SUMMARY_MIN_LENGTH`キー追加、Task 1と同様のパターン）
- Modify: `src/utils/storage/defaults.ts`（`SUMMARY_MIN_LENGTH`デフォルト値）
- Test: `src/background/__tests__/aiClient-priority-fallback.test.ts`（新規）

- [ ] **Step 1: `SUMMARY_MIN_LENGTH`ストレージキーを追加**

`src/utils/storage/types.ts`の`AI_PROVIDER_PRIORITY_LIST`の行の直後に追加:

```typescript
    AI_PROVIDER_PRIORITY_LIST: 'ai_provider_priority_list',
    SUMMARY_MIN_LENGTH: 'summary_min_length', // 要約の最小文字数しきい値（デフォルト: 10）。未満の場合フォールバック対象
```

`StorageKeyValues`に追加:

```typescript
    [StorageKeys.AI_PROVIDER_PRIORITY_LIST]: ProviderSlot[];
    [StorageKeys.SUMMARY_MIN_LENGTH]: number;
```

`src/utils/storage/defaults.ts`に追加:

```typescript
    [StorageKeys.SUMMARY_MIN_LENGTH]: 10,
```

- [ ] **Step 2: 失敗するテストを書く**

```typescript
// src/background/__tests__/aiClient-priority-fallback.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIClient } from '../aiClient.js';
import * as storage from '../../utils/storage.js';

vi.mock('../../utils/storage.js', () => ({
  getSettings: vi.fn(),
  getAllowedUrls: vi.fn(() => Promise.resolve([])),
  StorageKeys: {
    AI_PROVIDER: 'ai_provider',
    AI_PROVIDER_PRIORITY_LIST: 'ai_provider_priority_list',
    SUMMARY_MIN_LENGTH: 'summary_min_length',
    GEMINI_API_KEY: 'gemini_api_key',
    GEMINI_MODEL: 'gemini_model',
    OPENAI_BASE_URL: 'openai_base_url',
    OPENAI_API_KEY: 'openai_api_key',
    OPENAI_MODEL: 'openai_model',
    OPENAI_2_BASE_URL: 'openai_2_base_url',
    OPENAI_2_API_KEY: 'openai_2_api_key',
    OPENAI_2_MODEL: 'openai_2_model'
  }
}));
vi.mock('../localAiClient.js');

describe('AIClient: 優先度フォールバック', () => {
  let aiClient: AIClient;
  const mockGetSettings = storage.getSettings as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    aiClient = new AIClient();
    vi.clearAllMocks();
  });

  it('1位のプロバイダーがエラーを返した場合、2位のプロバイダーで再実行し成功を返す', async () => {
    mockGetSettings.mockResolvedValue({
      ai_provider_priority_list: [
        { provider: 'gemini' },
        { provider: 'openai2' }
      ],
      summary_min_length: 10,
      gemini_api_key: '', // 空キーでGeminiは失敗する
      openai_2_api_key: 'dummy-test-apikey-value',
      openai_2_base_url: 'https://api.openai.com/v1',
      openai_2_model: 'gpt-4o-mini'
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'これは十分な長さの要約結果です。' } }] })
    });

    const result = await aiClient.generateSummary('some content to summarize');

    expect(result.success).toBe(true);
    expect(result.summary).toContain('十分な長さの要約結果');
  });

  it('1位の要約が最小長未満の場合、2位のプロバイダーにフォールバックする', async () => {
    mockGetSettings.mockResolvedValue({
      ai_provider_priority_list: [
        { provider: 'openai' },
        { provider: 'openai2' }
      ],
      summary_min_length: 20,
      openai_api_key: 'dummy-test-apikey-value',
      openai_base_url: 'https://api.openai.com/v1',
      openai_model: 'gpt-3.5-turbo',
      openai_2_api_key: 'dummy-test-apikey-value',
      openai_2_base_url: 'https://api.openai.com/v1',
      openai_2_model: 'gpt-4o-mini'
    });

    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: '短い' } }] }) };
      }
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'これは20文字以上ある十分な長さの要約結果テキストです。' } }] }) };
    });

    const result = await aiClient.generateSummary('some content to summarize');

    expect(result.success).toBe(true);
    expect(result.summary).toContain('20文字以上');
    expect(callCount).toBe(2);
  });

  it('全プロバイダーが失敗した場合、失敗結果を返す（pending判定は呼び出し元に委ねる）', async () => {
    mockGetSettings.mockResolvedValue({
      ai_provider_priority_list: [
        { provider: 'gemini' },
        { provider: 'openai2' }
      ],
      summary_min_length: 10,
      gemini_api_key: '',
      openai_2_api_key: ''
    });

    const result = await aiClient.generateSummary('some content to summarize');

    expect(result.success).toBe(false);
  });

  it('AI_PROVIDER_PRIORITY_LISTが空配列の場合、旧AI_PROVIDER単一設定にフォールバックする', async () => {
    mockGetSettings.mockResolvedValue({
      ai_provider_priority_list: [],
      ai_provider: 'gemini',
      summary_min_length: 10,
      gemini_api_key: ''
    });

    const result = await aiClient.generateSummary('some content to summarize');

    expect(result.success).toBe(false);
    expect(result.summary).toContain('Error:');
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run src/background/__tests__/aiClient-priority-fallback.test.ts`
Expected: FAIL（現状の`generateSummary`は`AI_PROVIDER_PRIORITY_LIST`を参照しないため、1件目・2件目のテストで期待通りのフォールバックが起きない）

- [ ] **Step 4: `generateSummary()`にフォールバックロジックを実装**

`src/background/aiClient.ts:57-75`を以下に置き換える:

```typescript
    /**
     * 要約を生成する
     * 優先度1〜3位のプロバイダーを順に試行し、成功かつ最小長以上の要約が得られた時点で返す。
     * @param {string} content - 要約対象のコンテンツ
     * @param {boolean} [tagSummaryMode=false] - タグ付き要約モード
     */
    async generateSummary(content: string, tagSummaryMode: boolean = false): Promise<AISummaryResult> {
        const settings = await getSettings();
        const minLength = (settings[StorageKeys.SUMMARY_MIN_LENGTH] as number) || 0;
        const slots = this.resolveProviderSlots(settings);

        let lastResult: AISummaryResult = {
            success: false,
            summary: "Error: AI provider configuration is missing. Please check your settings."
        };

        for (const slot of slots) {
            const factory = this.providers.get(slot.provider);
            if (!factory) {
                addLog(LogType.ERROR, `Unknown AI Provider: ${slot.provider}`);
                continue;
            }

            const effectiveSettings = this.applySlotModel(settings, slot);

            try {
                const providerInstance = factory(effectiveSettings);
                const result = await providerInstance.generateSummary(content, tagSummaryMode);
                if (result.success && result.summary.length >= minLength) {
                    return result;
                }
                lastResult = result;
            } catch (error: unknown) {
                addLog(LogType.ERROR, `Generate summary failed: ${errorMessage(error)}`);
                lastResult = { success: false, summary: "Error: Failed to generate summary. Please try again." };
            }
        }

        return lastResult;
    }

    /**
     * 優先度スロットリストを解決する
     * AI_PROVIDER_PRIORITY_LISTが空の場合は旧AI_PROVIDER単一設定を1位スロットとして扱う
     */
    private resolveProviderSlots(settings: Settings): ProviderSlot[] {
        const slots = settings[StorageKeys.AI_PROVIDER_PRIORITY_LIST] as ProviderSlot[] | undefined;
        if (slots && slots.length > 0) {
            return slots;
        }
        const legacyProvider = (settings[StorageKeys.AI_PROVIDER] as string) || 'gemini';
        return [{ provider: legacyProvider }];
    }

    /**
     * スロットにmodel指定がある場合、対応するプロバイダーのモデル設定キーを上書きした設定を返す
     */
    private applySlotModel(settings: Settings, slot: ProviderSlot): Settings {
        if (!slot.model) {
            return settings;
        }
        const normalizedName = slot.provider.replace('2', '_2').replace(/-/g, '_').toLowerCase();
        const modelKey = slot.provider === 'openai-compatible'
            ? StorageKeys.PROVIDER_MODEL
            : `${normalizedName}_model`;
        return { ...settings, [modelKey]: slot.model };
    }
```

`src/background/aiClient.ts`のimport文に`ProviderSlot`を追加:

```typescript
import { getSettings, StorageKeys, Settings, ProviderSlot } from '../utils/storage.js';
```

`src/utils/storage.ts`が`ProviderSlot`を再エクスポートしているか確認し、していなければ追加する（`export { StorageKeys } from './storage/types.js';`の行の近くに`export type { ProviderSlot } from './storage/types.js';`を追加）。

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run src/background/__tests__/aiClient-priority-fallback.test.ts`
Expected: PASS（4 tests passed）

- [ ] **Step 6: 既存の`aiClient.test.ts`が壊れていないことを確認**

Run: `npx vitest run src/background/__tests__/aiClient.test.ts src/background/__tests__/aiClient-timeout.test.ts`
Expected: 既存テストすべてPASS（`resolveProviderSlots`が空配列のとき旧`AI_PROVIDER`単一設定と同じ挙動になるため、既存の単一プロバイダーテストは変更なしで通るはず）

- [ ] **Step 7: 型チェックを実行**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 8: コミット**

```bash
git add src/background/aiClient.ts src/utils/storage.ts src/utils/storage/types.ts src/utils/storage/defaults.ts src/background/__tests__/aiClient-priority-fallback.test.ts
git commit -m "feat(aiClient): 優先度リストに基づく要約フォールバックロジックを実装"
```

---

## Task 5: ダッシュボードHTMLに優先度2位・3位のセレクトとモデル入力欄を追加

**Files:**
- Modify: `entrypoints/options/index.html:260-274`
- Modify: `public/_locales/ja/messages.json`
- Modify: `public/_locales/en/messages.json`

- [ ] **Step 1: `entrypoints/options/index.html:260-274`を以下に置き換える**

```html
        <!-- AI プロバイダーセクション -->
        <div id="aiProviderSection" class="settings-section">
          <h3 class="settings-section-title" data-i18n="aiSection">AI プロバイダー</h3>

          <div class="form-group">
            <label for="aiProvider" data-i18n="aiProviderPriority1" data-i18n-suffix="requiredSuffix">Priority 1 (Required)</label>
            <select id="aiProvider">
              <option value="gemini" data-i18n-opt="googleGemini">Google Gemini</option>
              <option value="openai" data-i18n-opt="openaiCompatible">OpenAI Compatible (Groq, etc.)</option>
              <option value="openai2" data-i18n-opt="openaiCompatible2">OpenAI Compatible 2 (Local, etc.)</option>
              <option value="lm-studio" data-i18n-opt="lmStudio">LM Studio</option>
              <option value="ollama" data-i18n-opt="ollama">Ollama</option>
              <option value="openai-compatible" data-i18n-opt="openaiCompatibleModelsDev">OpenAI Compatible (Models.dev)</option>
            </select>
            <input type="text" id="aiProviderPriority1Model" data-i18n-input-placeholder="providerPriorityModelPlaceholder" class="priority-model-input">
          </div>

          <div class="form-group">
            <label for="aiProviderPriority2" data-i18n="aiProviderPriority2">Priority 2 (Optional)</label>
            <select id="aiProviderPriority2">
              <option value="" data-i18n-opt="providerPriorityNone">Not set</option>
              <option value="gemini" data-i18n-opt="googleGemini">Google Gemini</option>
              <option value="openai" data-i18n-opt="openaiCompatible">OpenAI Compatible (Groq, etc.)</option>
              <option value="openai2" data-i18n-opt="openaiCompatible2">OpenAI Compatible 2 (Local, etc.)</option>
              <option value="lm-studio" data-i18n-opt="lmStudio">LM Studio</option>
              <option value="ollama" data-i18n-opt="ollama">Ollama</option>
              <option value="openai-compatible" data-i18n-opt="openaiCompatibleModelsDev">OpenAI Compatible (Models.dev)</option>
            </select>
            <input type="text" id="aiProviderPriority2Model" data-i18n-input-placeholder="providerPriorityModelPlaceholder" class="priority-model-input">
          </div>

          <div class="form-group">
            <label for="aiProviderPriority3" data-i18n="aiProviderPriority3">Priority 3 (Optional)</label>
            <select id="aiProviderPriority3">
              <option value="" data-i18n-opt="providerPriorityNone">Not set</option>
              <option value="gemini" data-i18n-opt="googleGemini">Google Gemini</option>
              <option value="openai" data-i18n-opt="openaiCompatible">OpenAI Compatible (Groq, etc.)</option>
              <option value="openai2" data-i18n-opt="openaiCompatible2">OpenAI Compatible 2 (Local, etc.)</option>
              <option value="lm-studio" data-i18n-opt="lmStudio">LM Studio</option>
              <option value="ollama" data-i18n-opt="ollama">Ollama</option>
              <option value="openai-compatible" data-i18n-opt="openaiCompatibleModelsDev">OpenAI Compatible (Models.dev)</option>
            </select>
            <input type="text" id="aiProviderPriority3Model" data-i18n-input-placeholder="providerPriorityModelPlaceholder" class="priority-model-input">
          </div>
```

（このセクションの直後、`<!-- Gemini Settings -->`以降は変更しない。既存の各プロバイダー設定欄はそのまま残す。）

- [ ] **Step 2: i18nメッセージを追加**

`public/_locales/ja/messages.json`の`"aiProvider"`エントリ（95行目付近）の直後に追加:

```json
  "aiProviderPriority1": {
    "message": "優先度1位（必須）"
  },
  "aiProviderPriority2": {
    "message": "優先度2位（任意）"
  },
  "aiProviderPriority3": {
    "message": "優先度3位（任意）"
  },
  "providerPriorityNone": {
    "message": "未設定"
  },
  "providerPriorityModelPlaceholder": {
    "message": "モデル名（任意・空欄でデフォルト使用）"
  },
```

`public/_locales/en/messages.json`の`"aiProvider"`エントリ（95行目付近）の直後に追加:

```json
  "aiProviderPriority1": {
    "message": "Priority 1 (Required)"
  },
  "aiProviderPriority2": {
    "message": "Priority 2 (Optional)"
  },
  "aiProviderPriority3": {
    "message": "Priority 3 (Optional)"
  },
  "providerPriorityNone": {
    "message": "Not set"
  },
  "providerPriorityModelPlaceholder": {
    "message": "Model name (optional, uses default if empty)"
  },
```

- [ ] **Step 3: `data-i18n-suffix`属性は既存i18nユーティリティが対応していない可能性があるため確認**

Run: `grep -rn "data-i18n-suffix" src/utils/i18n*.ts src/popup/utils/i18n*.ts 2>/dev/null`

もし対応していなければ、`data-i18n="aiProviderPriority1"`のみとし、"aiProviderPriority1"のメッセージ自体に「（必須）」を含める形にする（Step 2のJSON例はすでにこの形になっている）。この場合、HTMLの`label`タグから`data-i18n-suffix="requiredSuffix"`属性を削除する。

- [ ] **Step 4: ブラウザで表示確認**

Run: `npm run build`

その後Chromeで`chrome://extensions`から拡張機能をリロードし、ダッシュボードを開いて優先度1〜3位のセレクトとモデル入力欄が表示されることを目視確認する。

- [ ] **Step 5: コミット**

```bash
git add entrypoints/options/index.html public/_locales/ja/messages.json public/_locales/en/messages.json
git commit -m "feat(dashboard): AIプロバイダ優先度2位・3位のUIを追加"
```

---

## Task 6: `aiProvider.ts`（UI表示制御）を拡張し、選択された全プロバイダーの設定欄を同時表示する

**Files:**
- Modify: `src/popup/settings/aiProvider.ts`
- Test: `src/popup/settings/__tests__/aiProvider.test.ts`（既存があれば拡張、なければ新規）

- [ ] **Step 1: 既存テストファイルの有無を確認**

Run: `find src/popup/settings -iname "*aiProvider*test*"`

- [ ] **Step 2: 失敗するテストを書く**

```typescript
// src/popup/settings/__tests__/aiProvider-priority.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { updateAIProviderVisibilityMulti, AIProviderElements } from '../aiProvider.js';

function createMockElement(): HTMLElement {
  const el = document.createElement('div');
  return el;
}

function createMockSelect(value: string): HTMLSelectElement {
  const select = document.createElement('select');
  const option = document.createElement('option');
  option.value = value;
  option.selected = true;
  select.appendChild(option);
  select.value = value;
  return select;
}

describe('updateAIProviderVisibilityMulti', () => {
  let elements: AIProviderElements;

  beforeEach(() => {
    elements = {
      select: createMockSelect('gemini'),
      geminiSettings: createMockElement(),
      openaiSettings: createMockElement(),
      openai2Settings: createMockElement(),
      lmStudioSettings: createMockElement(),
      ollamaSettings: createMockElement(),
      openaiCompatibleSettings: createMockElement()
    };
  });

  it('優先度1位と2位で異なるプロバイダーを選択した場合、両方の設定欄を表示する', () => {
    updateAIProviderVisibilityMulti(elements, ['gemini', 'openai2']);

    expect(elements.geminiSettings.style.display).toBe('block');
    expect(elements.openai2Settings.style.display).toBe('block');
    expect(elements.openaiSettings.style.display).toBe('none');
  });

  it('選択されていないプロバイダーの設定欄は非表示のままにする', () => {
    updateAIProviderVisibilityMulti(elements, ['ollama']);

    expect(elements.ollamaSettings?.style.display).toBe('block');
    expect(elements.geminiSettings.style.display).toBe('none');
    expect(elements.openaiSettings.style.display).toBe('none');
    expect(elements.openai2Settings.style.display).toBe('none');
  });

  it('空文字列（未設定）は無視する', () => {
    updateAIProviderVisibilityMulti(elements, ['gemini', '', '']);

    expect(elements.geminiSettings.style.display).toBe('block');
    expect(elements.openaiSettings.style.display).toBe('none');
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run src/popup/settings/__tests__/aiProvider-priority.test.ts`
Expected: FAIL（`updateAIProviderVisibilityMulti`が存在しない）

- [ ] **Step 4: `src/popup/settings/aiProvider.ts`に関数を追加**

既存の`updateAIProviderVisibility`関数（`src/popup/settings/aiProvider.ts:39-68`）はそのまま残し、その直後に新関数を追加する:

```typescript
/**
 * 複数のプロバイダー選択（優先度1〜3位）に基づき、選択された全プロバイダーの設定欄を同時表示する
 * @param {AIProviderElements} elements - DOM要素
 * @param {string[]} selectedProviders - 選択されたプロバイダーIDのリスト（空文字列は無視）
 */
export function updateAIProviderVisibilityMulti(elements: AIProviderElements, selectedProviders: string[]): void {
    const selected = new Set(selectedProviders.filter(p => p !== ''));

    elements.geminiSettings.style.display = selected.has('gemini') ? 'block' : 'none';
    elements.openaiSettings.style.display = selected.has('openai') ? 'block' : 'none';
    elements.openai2Settings.style.display = selected.has('openai2') ? 'block' : 'none';

    if (elements.lmStudioSettings) {
        elements.lmStudioSettings.style.display = selected.has('lm-studio') ? 'block' : 'none';
    }
    if (elements.ollamaSettings) {
        elements.ollamaSettings.style.display = selected.has('ollama') ? 'block' : 'none';
    }
    if (elements.openaiCompatibleSettings) {
        elements.openaiCompatibleSettings.style.display = selected.has('openai-compatible') ? 'block' : 'none';
    }
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run src/popup/settings/__tests__/aiProvider-priority.test.ts`
Expected: PASS（3 tests passed）

- [ ] **Step 6: 既存の`updateAIProviderVisibility`テストが壊れていないことを確認**

Run: `find src/popup/settings -iname "*aiProvider*test*" -exec npx vitest run {} \;`
Expected: 既存テストすべてPASS

- [ ] **Step 7: コミット**

```bash
git add src/popup/settings/aiProvider.ts src/popup/settings/__tests__/aiProvider-priority.test.ts
git commit -m "feat(aiProvider): 複数プロバイダー同時表示用のupdateAIProviderVisibilityMultiを追加"
```

---

## Task 7: `dashboard.ts`を優先度2位・3位のDOM要素・保存/読込ロジックに対応させる

**Files:**
- Modify: `src/dashboard/dashboard.ts:169-330`
- Test: `src/dashboard/__tests__/dashboard-priority.test.ts`（新規、既存の`dashboard.test.ts`のモックパターンを踏襲）

- [ ] **Step 1: 既存の`dashboard.test.ts`のDOM要素モックパターンを確認**

Run: `find src/dashboard/__tests__ -iname "*dashboard*test*" | head -5`

該当ファイルを読み、`document.getElementById`のモック方法（jsdom使用かモック関数か）を確認してからStep 2に進む。

- [ ] **Step 2: `DashboardElements`インターフェースにフィールドを追加**

`src/dashboard/dashboard.ts:169-174`付近（`aiProviderSelect`, `geminiSettingsDiv`等が定義されている箇所）に追加:

```typescript
  aiProviderSelect: HTMLSelectElement | null;
  aiProviderPriority1ModelInput: HTMLInputElement | null;
  aiProviderPriority2Select: HTMLSelectElement | null;
  aiProviderPriority2ModelInput: HTMLInputElement | null;
  aiProviderPriority3Select: HTMLSelectElement | null;
  aiProviderPriority3ModelInput: HTMLInputElement | null;
```

- [ ] **Step 3: DOM取得箇所に追加**

`src/dashboard/dashboard.ts:218`付近（`aiProviderSelect: document.getElementById('aiProvider') as HTMLSelectElement | null,`の行）の直後に追加:

```typescript
      aiProviderSelect: document.getElementById('aiProvider') as HTMLSelectElement | null,
      aiProviderPriority1ModelInput: document.getElementById('aiProviderPriority1Model') as HTMLInputElement | null,
      aiProviderPriority2Select: document.getElementById('aiProviderPriority2') as HTMLSelectElement | null,
      aiProviderPriority2ModelInput: document.getElementById('aiProviderPriority2Model') as HTMLInputElement | null,
      aiProviderPriority3Select: document.getElementById('aiProviderPriority3') as HTMLSelectElement | null,
      aiProviderPriority3ModelInput: document.getElementById('aiProviderPriority3Model') as HTMLInputElement | null,
```

- [ ] **Step 4: 初期値（null埋め）に追加**

`src/dashboard/dashboard.ts:258`付近（`aiProviderSelect: null, geminiSettingsDiv: null, ...`の行）に追加:

```typescript
    aiProviderSelect: null, aiProviderPriority1ModelInput: null,
    aiProviderPriority2Select: null, aiProviderPriority2ModelInput: null,
    aiProviderPriority3Select: null, aiProviderPriority3ModelInput: null,
```

- [ ] **Step 5: 優先度リストの読み込み・保存関数を追加**

`src/dashboard/dashboard.ts`の`getAiProviderElements()`関数（`src/dashboard/dashboard.ts:319-330`）の直後に追加:

```typescript
/**
 * 優先度1〜3位のセレクト・モデル入力欄からProviderSlot[]を組み立てる
 */
export function collectProviderPrioritySlots(): ProviderSlot[] {
  const el = getDashboardElements();
  const slots: ProviderSlot[] = [];

  if (el.aiProviderSelect?.value) {
    const model = el.aiProviderPriority1ModelInput?.value.trim();
    slots.push(model ? { provider: el.aiProviderSelect.value, model } : { provider: el.aiProviderSelect.value });
  }
  if (el.aiProviderPriority2Select?.value) {
    const model = el.aiProviderPriority2ModelInput?.value.trim();
    slots.push(model ? { provider: el.aiProviderPriority2Select.value, model } : { provider: el.aiProviderPriority2Select.value });
  }
  if (el.aiProviderPriority3Select?.value) {
    const model = el.aiProviderPriority3ModelInput?.value.trim();
    slots.push(model ? { provider: el.aiProviderPriority3Select.value, model } : { provider: el.aiProviderPriority3Select.value });
  }

  return slots;
}

/**
 * ProviderSlot[]を優先度1〜3位のセレクト・モデル入力欄に反映する
 */
export function applyProviderPrioritySlots(slots: ProviderSlot[]): void {
  const el = getDashboardElements();
  const [slot1, slot2, slot3] = slots;

  if (el.aiProviderSelect) {
    el.aiProviderSelect.value = slot1?.provider ?? 'gemini';
  }
  if (el.aiProviderPriority1ModelInput) {
    el.aiProviderPriority1ModelInput.value = slot1?.model ?? '';
  }
  if (el.aiProviderPriority2Select) {
    el.aiProviderPriority2Select.value = slot2?.provider ?? '';
  }
  if (el.aiProviderPriority2ModelInput) {
    el.aiProviderPriority2ModelInput.value = slot2?.model ?? '';
  }
  if (el.aiProviderPriority3Select) {
    el.aiProviderPriority3Select.value = slot3?.provider ?? '';
  }
  if (el.aiProviderPriority3ModelInput) {
    el.aiProviderPriority3ModelInput.value = slot3?.model ?? '';
  }
}
```

`src/dashboard/dashboard.ts`のimportに`ProviderSlot`を追加（Task 4で`storage.ts`から再エクスポート済み）:

```typescript
import { getSettings, StorageKeys, ProviderSlot } from '../utils/storage.js';
```

（既存のimport文にStorageKeys等が既にある場合はProviderSlotのみ追記する）

- [ ] **Step 6: `loadGeneralSettings()`と保存処理に組み込む**

`src/dashboard/dashboard.ts:332-335`付近の`loadGeneralSettings`関数内、`updateAIProviderVisibility(getAiProviderElements());`の行の直後に追加:

```typescript
  const settings2 = await getSettings();
  applyProviderPrioritySlots((settings2[StorageKeys.AI_PROVIDER_PRIORITY_LIST] as ProviderSlot[]) ?? []);
```

（既に`settings`変数が同スコープに存在する場合は`settings2`ではなく既存の`settings`変数を再利用する。Step 1で該当関数の変数名を確認してから実装すること。）

保存処理（`saveSettings`を呼び出している箇所、`grep -n "saveSettings(" src/dashboard/dashboard.ts`で特定）で、送信するsettingsオブジェクトに以下を追加する:

```typescript
[StorageKeys.AI_PROVIDER_PRIORITY_LIST]: collectProviderPrioritySlots(),
```

- [ ] **Step 7: テストを書く**

```typescript
// src/dashboard/__tests__/dashboard-priority.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { collectProviderPrioritySlots, applyProviderPrioritySlots } from '../dashboard.js';

describe('AIプロバイダ優先度スロットのDOM連携', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="aiProvider">
        <option value="gemini">gemini</option>
        <option value="openai2">openai2</option>
      </select>
      <input id="aiProviderPriority1Model" />
      <select id="aiProviderPriority2">
        <option value="">none</option>
        <option value="openai2">openai2</option>
      </select>
      <input id="aiProviderPriority2Model" />
      <select id="aiProviderPriority3">
        <option value="">none</option>
        <option value="ollama">ollama</option>
      </select>
      <input id="aiProviderPriority3Model" />
    `;
  });

  it('1位のみ選択されている場合、長さ1の配列を返す', () => {
    (document.getElementById('aiProvider') as HTMLSelectElement).value = 'gemini';
    const slots = collectProviderPrioritySlots();
    expect(slots).toEqual([{ provider: 'gemini' }]);
  });

  it('1位・2位にモデル指定ありで選択されている場合、両方をスロットとして返す', () => {
    (document.getElementById('aiProvider') as HTMLSelectElement).value = 'gemini';
    (document.getElementById('aiProviderPriority1Model') as HTMLInputElement).value = 'gemini-2.5-pro';
    (document.getElementById('aiProviderPriority2') as HTMLSelectElement).value = 'openai2';
    (document.getElementById('aiProviderPriority2Model') as HTMLInputElement).value = 'gpt-4o-mini';

    const slots = collectProviderPrioritySlots();
    expect(slots).toEqual([
      { provider: 'gemini', model: 'gemini-2.5-pro' },
      { provider: 'openai2', model: 'gpt-4o-mini' }
    ]);
  });

  it('applyProviderPrioritySlotsは配列をDOMに反映する', () => {
    applyProviderPrioritySlots([
      { provider: 'openai2' },
      { provider: 'ollama', model: 'llama3' }
    ]);

    expect((document.getElementById('aiProvider') as HTMLSelectElement).value).toBe('openai2');
    expect((document.getElementById('aiProviderPriority2') as HTMLSelectElement).value).toBe('ollama');
    expect((document.getElementById('aiProviderPriority2Model') as HTMLInputElement).value).toBe('llama3');
    expect((document.getElementById('aiProviderPriority3') as HTMLSelectElement).value).toBe('');
  });
});
```

- [ ] **Step 8: テストが通ることを確認**

Run: `npx vitest run src/dashboard/__tests__/dashboard-priority.test.ts`
Expected: PASS（3 tests passed）

- [ ] **Step 9: 既存の`dashboard.test.ts`が壊れていないことを確認**

Run: `npx vitest run src/dashboard/__tests__/`
Expected: 既存テストすべてPASS

- [ ] **Step 10: 型チェックとフルテストを実行**

Run: `npm run type-check && npx vitest run`
Expected: エラーなし、全テストPASS

- [ ] **Step 11: コミット**

```bash
git add src/dashboard/dashboard.ts src/dashboard/__tests__/dashboard-priority.test.ts
git commit -m "feat(dashboard): 優先度2位・3位スロットのDOM読込・保存ロジックを実装"
```

---

## Task 8: 変更を選択リスナーに接続し、複数選択時の表示更新を有効化する

**Files:**
- Modify: `src/dashboard/dashboard.ts`（`setupAIProviderChangeListener`呼び出し箇所、`src/dashboard/dashboard.ts:1113-1115`付近）

- [ ] **Step 1: 現状のイベントリスナー設定箇所を確認**

Run: `grep -n "setupAIProviderChangeListener\|addEventListener.*change" src/dashboard/dashboard.ts`

- [ ] **Step 2: 3つのセレクトすべてに変更検知を追加**

`src/dashboard/dashboard.ts:1113-1115`付近を以下に置き換える（既存の`setupAIProviderChangeListener(aiProviderEl)`は1位セレクトの権限リクエスト・単体表示制御用に残しつつ、複数表示更新を追加する）:

```typescript
  const aiProviderEl = getAiProviderElements();
  if (aiProviderEl.select) {
    setupAIProviderChangeListener(aiProviderEl);
  }

  const refreshMultiVisibility = (): void => {
    const el = getDashboardElements();
    const selected = [
      el.aiProviderSelect?.value ?? '',
      el.aiProviderPriority2Select?.value ?? '',
      el.aiProviderPriority3Select?.value ?? ''
    ];
    updateAIProviderVisibilityMulti(getAiProviderElements(), selected);
  };

  const el = getDashboardElements();
  el.aiProviderSelect?.addEventListener('change', refreshMultiVisibility);
  el.aiProviderPriority2Select?.addEventListener('change', refreshMultiVisibility);
  el.aiProviderPriority3Select?.addEventListener('change', refreshMultiVisibility);
  refreshMultiVisibility();
```

importに`updateAIProviderVisibilityMulti`を追加:

```typescript
import { setupAIProviderChangeListener, updateAIProviderVisibility, updateAIProviderVisibilityMulti, AIProviderElements } from '../popup/settings/aiProvider.js';
```

`loadGeneralSettings()`内の`updateAIProviderVisibility(getAiProviderElements());`の呼び出しは、単一表示ロジック（後方互換用）として残すか、`updateAIProviderVisibilityMulti`に置き換えるかを次のStepで判断する。

- [ ] **Step 3: `loadGeneralSettings()`内の表示更新を複数表示版に統一**

`src/dashboard/dashboard.ts:335`の`updateAIProviderVisibility(getAiProviderElements());`を以下に置き換える:

```typescript
  const prioritySlots = (settings[StorageKeys.AI_PROVIDER_PRIORITY_LIST] as ProviderSlot[]) ?? [];
  applyProviderPrioritySlots(prioritySlots);
  updateAIProviderVisibilityMulti(
    getAiProviderElements(),
    [
      prioritySlots[0]?.provider ?? '',
      prioritySlots[1]?.provider ?? '',
      prioritySlots[2]?.provider ?? ''
    ]
  );
```

（Task 7 Step 6で追加した`applyProviderPrioritySlots`呼び出しと重複しないよう、片方に統一する。この時点で`loadGeneralSettings`関数を通しで読み、重複コードがあれば削除する。）

- [ ] **Step 4: ビルドして手動確認**

Run: `npm run build`

Chromeでダッシュボードを開き、以下を確認:
- 優先度1位でgemini、2位でopenai2を選択 → Gemini設定欄とOpenAI2設定欄の両方が表示される
- 2位を「未設定」に戻す → OpenAI2設定欄が非表示に戻る
- 保存後、ページをリロードして選択状態が復元される

- [ ] **Step 5: 全テストスイートを実行**

Run: `npm validate`
Expected: 型チェック・全テストがPASS

- [ ] **Step 6: コミット**

```bash
git add src/dashboard/dashboard.ts
git commit -m "feat(dashboard): 優先度セレクト変更時に複数プロバイダー設定欄の表示を更新"
```

---

## Task 9: CHANGELOG更新とドキュメント整合性チェック

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `dev-docs/plans/00-index.md`

- [ ] **Step 1: CHANGELOGに追記**

`CHANGELOG.md`の最新バージョンの直前（Unreleasedセクションがあればそこ、なければ新規セクション）に追記:

```markdown
### Added
- AIプロバイダの優先順位（1〜3位）設定機能。1位のプロバイダーが失敗、または要約が最小長未満の場合、自動的に2位・3位のプロバイダーへフォールバックする / Added AI provider priority (1st-3rd) configuration. Automatically falls back to the 2nd/3rd provider when the 1st fails or returns a summary shorter than the minimum length threshold.
```

- [ ] **Step 2: `00-index.md`のステータスを更新**

`dev-docs/plans/00-index.md`の「関連設計ドキュメント」セクションの記述を更新:

```markdown
## 関連設計ドキュメント

- [2026-07-05-01-feat-provider-priority-fallback-design.md](2026-07-05-01-feat-provider-priority-fallback-design.md) — AIプロバイダ優先順位（1〜3位）設計。ステータス: 実装完了
- [2026-07-05-02-feat-provider-priority-fallback-impl-plan.md](2026-07-05-02-feat-provider-priority-fallback-impl-plan.md) — 上記の実装計画。ステータス: 実装完了
```

- [ ] **Step 3: コミット**

```bash
git add CHANGELOG.md dev-docs/plans/00-index.md
git commit -m "docs: AIプロバイダ優先順位機能のCHANGELOG・計画ステータスを更新"
```

---

## 完了確認チェックリスト

- [ ] `npm run type-check` がエラーなしで通る
- [ ] `npx vitest run` の全テストがPASSする
- [ ] Chromeで実際にダッシュボードを開き、優先度1〜3位の設定・保存・再読込が動作することを確認した
- [ ] 1位失敗→2位成功のフォールバックが実際のAPIレスポンス（またはモック）で確認できた
- [ ] 全プロバイダー失敗時にエラー結果が返り、呼び出し元のpending機構（`feat-summary-retry-fallback`本体PBI）に接続可能な形になっている
