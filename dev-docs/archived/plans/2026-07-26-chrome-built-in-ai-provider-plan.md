# Chrome Built-in AI Provider 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `BuiltInAIProvider` を `AIProviderStrategy` に統合し、ダッシュボード UI から「Built-in AI（APIキー不要）」を選択可能にする。

**Architecture:** Service 分離型（C）。`BuiltInAIProvider` がビジネスロジックを担い、`BuiltInAIService` が Offscreen Document との通信を抽象化する。これによりテスト容易性を高め、将来の実装差し替えも可能にする。

**Tech Stack:** TypeScript, Vitest, Chrome Extension Manifest V3, Chrome Prompt API (`window.ai`)

---

## ファイル構成

| ファイル | 責務 |
|----------|------|
| `src/background/builtInAiService.ts` | `BuiltInAIService` インターフェースと `OffscreenBuiltInAIService` 実装。Offscreen 起動とメッセージングを担当 |
| `src/background/ai/providers/BuiltInAIProvider.ts` | `AIProviderStrategy` を実装。入力制限、サニタイズ、エラーハンドリング、結果整形を担当 |
| `src/background/aiClient.ts` | `built-in-ai` Provider を登録 |
| `src/utils/storage/types.ts` | 必要に応じて ProviderSlot のコメント更新 |
| `src/popup/settings/aiProvider.ts` | `built-in-ai` 選択時の UI 表示制御 |
| `src/dashboard/dashboard.ts` | Provider 選択肢・優先度リストに `built-in-ai` を追加 |
| `_locales/ja/messages.json` | 日本語ラベル・メッセージ追加 |
| `_locales/en/messages.json` | 英語ラベル・メッセージ追加 |
| `src/background/__tests__/builtInAiService.test.ts` | `OffscreenBuiltInAIService` の単体テスト |
| `src/background/ai/providers/__tests__/BuiltInAIProvider.test.ts` | `BuiltInAIProvider` の単体テスト |

---

## Task 1: BuiltInAIService インターフェースと OffscreenBuiltInAIService の実装

**Files:**
- Create: `src/background/builtInAiService.ts`
- Create: `src/background/__tests__/builtInAiService.test.ts`

- [ ] **Step 1: Write the failing test for `OffscreenBuiltInAIService.checkAvailability`**

```typescript
// src/background/__tests__/builtInAiService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OffscreenBuiltInAIService, type BuiltInAIService } from '../builtInAiService.js';

describe('OffscreenBuiltInAIService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    globalThis.chrome = {
      offscreen: {
        hasDocument: vi.fn().mockResolvedValue(false),
        createDocument: vi.fn().mockResolvedValue(undefined),
      },
      runtime: {
        sendMessage: vi.fn(),
      },
    } as unknown as typeof chrome;
  });

  it('returns availability status from offscreen', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((_, callback) => {
      callback({ status: 'readily' });
      return true;
    });

    const service: BuiltInAIService = new OffscreenBuiltInAIService();
    const result = await service.checkAvailability();
    expect(result).toBe('readily');
  });
});
```

Run: `npm test -- src/background/__tests__/builtInAiService.test.ts`
Expected: FAIL with "Cannot find module '../builtInAiService.js'"

- [ ] **Step 2: Implement `BuiltInAIService` interface and `OffscreenBuiltInAIService`**

```typescript
// src/background/builtInAiService.ts
import { errorMessage } from '../utils/errorUtils.js';

export type LocalAIAvailability = 'readily' | 'after-download' | 'no' | 'unsupported';

export interface BuiltInAIService {
  checkAvailability(): Promise<LocalAIAvailability>;
  summarize(content: string): Promise<{ success: boolean; summary?: string; error?: string }>;
}

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const MESSAGE_TIMEOUT_MS = 30000;

interface OffscreenResponse {
  status?: LocalAIAvailability;
  success?: boolean;
  summary?: string;
  error?: string;
  [key: string]: unknown;
}

export class OffscreenBuiltInAIService implements BuiltInAIService {
  private creatingOffscreenPromise: Promise<void> | null = null;

  async ensureOffscreenDocument(): Promise<void> {
    const hasOffscreen = await chrome.offscreen.hasDocument();
    if (hasOffscreen) return;

    if (this.creatingOffscreenPromise) {
      await this.creatingOffscreenPromise;
      return;
    }

    this.creatingOffscreenPromise = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'To access the chrome.ai Prompt API which is only available in window context.',
    });

    await this.creatingOffscreenPromise;
    this.creatingOffscreenPromise = null;
  }

  private async msgOffscreen(type: string, payload: Record<string, unknown> = {}): Promise<OffscreenResponse> {
    await this.ensureOffscreenDocument();
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type, target: 'offscreen', payload },
        (response: OffscreenResponse) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response ?? {});
          }
        }
      );
    });
  }

  async checkAvailability(): Promise<LocalAIAvailability> {
    try {
      const response = await this.msgOffscreen('CHECK_AVAILABILITY');
      return response?.status || 'unsupported';
    } catch (error: unknown) {
      console.error('BuiltInAIService: Failed to check availability', errorMessage(error));
      return 'unsupported';
    }
  }

  async summarize(content: string): Promise<{ success: boolean; summary?: string; error?: string }> {
    try {
      const response = await Promise.race([
        this.msgOffscreen('SUMMARIZE', { content }),
        new Promise<OffscreenResponse>((_, reject) =>
          setTimeout(() => reject(new Error('Error: Local AI request timed out. Please try again.')), MESSAGE_TIMEOUT_MS)
        ),
      ]);
      return {
        success: response.success ?? false,
        summary: response.summary,
        error: response.error,
      };
    } catch (error: unknown) {
      return { success: false, error: errorMessage(error) };
    }
  }
}
```

Run: `npm test -- src/background/__tests__/builtInAiService.test.ts`
Expected: PASS

- [ ] **Step 3: Add tests for `summarize` and timeout paths**

```typescript
// src/background/__tests__/builtInAiService.test.ts
it('returns summary from offscreen', async () => {
  vi.mocked(chrome.runtime.sendMessage).mockImplementation((_, callback) => {
    callback({ success: true, summary: 'AI summary' });
    return true;
  });

  const service = new OffscreenBuiltInAIService();
  const result = await service.summarize('page content');
  expect(result.success).toBe(true);
  expect(result.summary).toBe('AI summary');
});

it('returns error on timeout', async () => {
  vi.useFakeTimers();
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(() => {
    return true;
  });

  const service = new OffscreenBuiltInAIService();
  const promise = service.summarize('page content');
  vi.advanceTimersByTime(31000);

  const result = await promise;
  expect(result.success).toBe(false);
  expect(result.error).toContain('timed out');
  vi.useRealTimers();
});
```

Run: `npm test -- src/background/__tests__/builtInAiService.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/background/builtInAiService.ts src/background/__tests__/builtInAiService.test.ts
git commit -m "feat: add BuiltInAIService and OffscreenBuiltInAIService"
```

---

## Task 2: BuiltInAIProvider の実装

**Files:**
- Create: `src/background/ai/providers/BuiltInAIProvider.ts`
- Create: `src/background/ai/providers/__tests__/BuiltInAIProvider.test.ts`

- [ ] **Step 1: Write the failing test for `BuiltInAIProvider.generateSummary`**

```typescript
// src/background/ai/providers/__tests__/BuiltInAIProvider.test.ts
import { describe, it, expect, vi } from 'vitest';
import { BuiltInAIProvider } from '../BuiltInAIProvider.js';
import type { BuiltInAIService } from '../../../background/builtInAiService.js';
import type { Settings } from '../../../utils/storage.js';

describe('BuiltInAIProvider', () => {
  const mockService: BuiltInAIService = {
    checkAvailability: vi.fn(),
    summarize: vi.fn(),
  };

  const settings: Settings = {};

  it('returns summary when service succeeds', async () => {
    vi.mocked(mockService.summarize).mockResolvedValue({ success: true, summary: 'Built-in AI summary' });

    const provider = new BuiltInAIProvider(settings, mockService);
    const result = await provider.generateSummary('page content');

    expect(result.success).toBe(true);
    expect(result.summary).toBe('Built-in AI summary');
    expect(result.providerName).toBe('built-in-ai');
  });
});
```

Run: `npm test -- src/background/ai/providers/__tests__/BuiltInAIProvider.test.ts`
Expected: FAIL with "Cannot find module '../BuiltInAIProvider.js'"

- [ ] **Step 2: Implement `BuiltInAIProvider`**

```typescript
// src/background/ai/providers/BuiltInAIProvider.ts
import { AIProviderStrategy, type AIProviderConnectionResult, type AISummaryResult } from './ProviderStrategy.js';
import { sanitizePromptContent, DangerLevel } from '../../../utils/promptSanitizer.js';
import { addLog, LogType } from '../../../utils/logger.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import type { BuiltInAIService, LocalAIAvailability } from '../../builtInAiService.js';
import type { Settings } from '../../../utils/storage.js';

export class BuiltInAIProvider extends AIProviderStrategy {
  private service: BuiltInAIService;

  constructor(settings: Settings, service: BuiltInAIService) {
    super(settings);
    this.service = service;
  }

  getName(): string {
    return 'built-in-ai';
  }

  async generateSummary(content: string, _tagSummaryMode: boolean = false): Promise<AISummaryResult> {
    if (!content) {
      return { success: false, summary: 'Error: No content provided' };
    }

    const sanitizeResult = sanitizePromptContent(content);
    if (sanitizeResult.dangerLevel === DangerLevel.HIGH) {
      addLog(LogType.WARN, 'Content blocked due to high danger level', { source: 'BuiltInAI' });
      return { success: false, summary: 'Error: Content contains potentially dangerous patterns' };
    }

    const maxContentChars = this.getMaxContentChars(10_000);
    const truncatedContent = sanitizeResult.sanitized.substring(0, maxContentChars);

    try {
      const response = await this.service.summarize(truncatedContent);
      if (response.success && response.summary) {
        return {
          success: true,
          summary: response.summary,
          sentTokens: truncatedContent.length,
          receivedTokens: response.summary.length,
          providerName: this.getName(),
          model: 'gemini-nano',
        };
      }
      return {
        success: false,
        summary: response.error || 'Error: Failed to generate summary',
      };
    } catch (error: unknown) {
      addLog(LogType.ERROR, 'BuiltInAIProvider: Summarization failed', { error: errorMessage(error) });
      return { success: false, summary: 'Error: Failed to generate summary. Please try again.' };
    }
  }

  async testConnection(): Promise<AIProviderConnectionResult> {
    try {
      const availability = await this.service.checkAvailability();
      return this.mapAvailabilityToResult(availability);
    } catch (error: unknown) {
      return { success: false, message: errorMessage(error) };
    }
  }

  private mapAvailabilityToResult(availability: LocalAIAvailability): AIProviderConnectionResult {
    switch (availability) {
      case 'readily':
        return { success: true, message: 'Built-in AI is available' };
      case 'after-download':
        return { success: false, message: 'Built-in AI model is downloading. Please wait.' };
      case 'no':
        return { success: false, message: 'Built-in AI is not available. Check chrome://flags.' };
      case 'unsupported':
      default:
        return { success: false, message: 'Built-in AI is not supported in this browser.' };
    }
  }
}
```

Run: `npm test -- src/background/ai/providers/__tests__/BuiltInAIProvider.test.ts`
Expected: PASS

- [ ] **Step 3: Add tests for error cases and content limits**

```typescript
// src/background/ai/providers/__tests__/BuiltInAIProvider.test.ts
it('truncates content to max chars', async () => {
  vi.mocked(mockService.summarize).mockResolvedValue({ success: true, summary: 'ok' });

  const provider = new BuiltInAIProvider(settings, mockService);
  const longContent = 'x'.repeat(20_000);
  await provider.generateSummary(longContent);

  const callArg = vi.mocked(mockService.summarize).mock.calls[0][0];
  expect(callArg.length).toBeLessThanOrEqual(10_000);
});

it('returns error when service fails', async () => {
  vi.mocked(mockService.summarize).mockResolvedValue({ success: false, error: 'AI unavailable' });

  const provider = new BuiltInAIProvider(settings, mockService);
  const result = await provider.generateSummary('content');

  expect(result.success).toBe(false);
  expect(result.summary).toContain('AI unavailable');
});
```

Run: `npm test -- src/background/ai/providers/__tests__/BuiltInAIProvider.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/background/ai/providers/BuiltInAIProvider.ts src/background/ai/providers/__tests__/BuiltInAIProvider.test.ts
git commit -m "feat: add BuiltInAIProvider implementation"
```

---

## Task 3: AIClient への Provider 登録

**Files:**
- Modify: `src/background/aiClient.ts`
- Test: `src/background/__tests__/aiClient.test.ts`（既存があれば流用、なければ新規作成）

- [ ] **Step 1: Modify `AIClient.registerDefaultProviders()` to include built-in-ai**

```typescript
// src/background/aiClient.ts
import { OffscreenBuiltInAIService } from './builtInAiService.js';
import { BuiltInAIProvider } from './ai/providers/BuiltInAIProvider.js';

// inside AIClient constructor or registerDefaultProviders()
this.registerProvider('built-in-ai', (settings: Settings) => new BuiltInAIProvider(settings, new OffscreenBuiltInAIService()));
```

- [ ] **Step 2: Update `PROVIDER_LABELS`**

```typescript
// src/background/aiClient.ts
export const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI Compatible',
  openai2: 'OpenAI Compatible 2',
  'lm-studio': 'LM Studio',
  ollama: 'Ollama',
  'openai-compatible': 'OpenAI Compatible',
  'built-in-ai': 'Built-in AI（APIキー不要）',
};
```

- [ ] **Step 3: Add a test verifying built-in-ai fallback**

```typescript
// src/background/__tests__/aiClient.test.ts
it('falls back to next provider when built-in-ai fails', async () => {
  // mock BuiltInAIProvider to fail and GeminiProvider to succeed
});
```

Run: `npm test -- src/background/__tests__/aiClient.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/background/aiClient.ts src/background/__tests__/aiClient.test.ts
git commit -m "feat: register built-in-ai provider in AIClient"
```

---

## Task 4: UI 選択肢とラベルの追加

**Files:**
- Modify: `src/background/aiClient.ts`（`PROVIDER_LABELS`）
- Modify: `src/dashboard/dashboard.ts`
- Modify: `_locales/ja/messages.json`
- Modify: `_locales/en/messages.json`

- [ ] **Step 1: Add i18n messages**

```json
// _locales/ja/messages.json
{
  "builtInAiProviderLabel": {
    "message": "Built-in AI（APIキー不要）",
    "description": "AI Provider 選択肢の Built-in AI ラベル"
  },
  "builtInAiUnavailableUnsupported": {
    "message": "このブラウザは Built-in AI に対応していません。",
    "description": "Built-in AI が未対応ブラウザの場合のメッセージ"
  },
  "builtInAiUnavailableNo": {
    "message": "Built-in AI が利用できません。chrome://flags で有効化してください。",
    "description": "Built-in AI が no 状態の場合のメッセージ"
  },
  "builtInAiUnavailableDownloading": {
    "message": "Built-in AI モデルをダウンロード中です。しばらくお待ちください。",
    "description": "Built-in AI モデルダウンロード中のメッセージ"
  }
}
```

```json
// _locales/en/messages.json
{
  "builtInAiProviderLabel": {
    "message": "Built-in AI (no API key)",
    "description": "Built-in AI provider label"
  },
  "builtInAiUnavailableUnsupported": {
    "message": "This browser does not support Built-in AI.",
    "description": "Message when Built-in AI is unsupported"
  },
  "builtInAiUnavailableNo": {
    "message": "Built-in AI is not available. Please enable it in chrome://flags.",
    "description": "Message when Built-in AI status is no"
  },
  "builtInAiUnavailableDownloading": {
    "message": "Built-in AI model is downloading. Please wait.",
    "description": "Message while Built-in AI model is downloading"
  }
}
```

- [ ] **Step 2: Update dashboard option lists**

```typescript
// src/dashboard/dashboard.ts
// Add 'built-in-ai' to provider option lists
```

- [ ] **Step 3: Commit**

```bash
git add _locales/ja/messages.json _locales/en/messages.json src/dashboard/dashboard.ts
git commit -m "feat: add built-in-ai to dashboard provider options and i18n"
```

---

## Task 5: UI 表示制御

**Files:**
- Modify: `src/popup/settings/aiProvider.ts`
- Test: `src/popup/settings/__tests__/aiProvider.test.ts`（既存があれば流用）

- [ ] **Step 1: Update `AIProviderElements` interface to include built-in-ai settings panel**

```typescript
// src/popup/settings/aiProvider.ts
export interface AIProviderElements {
  select: HTMLSelectElement;
  geminiSettings: HTMLElement;
  openaiSettings: HTMLElement;
  openai2Settings: HTMLElement;
  openaiCompatibleSettings?: HTMLElement;
  lmStudioSettings?: HTMLElement;
  ollamaSettings?: HTMLElement;
  builtInAiSettings?: HTMLElement; // 追加
}
```

- [ ] **Step 2: Update `updateAIProviderVisibility()` and `updateAIProviderVisibilityMulti()`**

```typescript
// src/popup/settings/aiProvider.ts
if (elements.builtInAiSettings) {
  elements.builtInAiSettings.style.display = provider === 'built-in-ai' ? 'block' : 'none';
}

// In updateAIProviderVisibilityMulti
if (elements.builtInAiSettings) {
  elements.builtInAiSettings.style.display = selected.has('built-in-ai') ? 'block' : 'none';
}
```

- [ ] **Step 3: Add test**

```typescript
// src/popup/settings/__tests__/aiProvider.test.ts
it('hides API key inputs when built-in-ai is selected', () => {
  // setup elements
  elements.select.value = 'built-in-ai';
  updateAIProviderVisibility(elements);
  expect(elements.geminiSettings.style.display).toBe('none');
  expect(elements.builtInAiSettings?.style.display).toBe('block');
});
```

Run: `npm test -- src/popup/settings/__tests__/aiProvider.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/popup/settings/aiProvider.ts src/popup/settings/__tests__/aiProvider.test.ts
git commit -m "feat: add built-in-ai UI visibility control"
```

---

## Task 6: E2E 動作確認

**Files:**
- N/A（手動確認）

- [ ] **Step 1: Build extension**

```bash
npm run build
```

Expected: `dist/chromium-mv3` が生成される

- [ ] **Step 2: Test in Chrome Dev/Canary with Prompt API enabled**

1. `chrome://flags` で Prompt API 関連フラグを有効化
2. `chrome://extensions` で `dist/chromium-mv3` を「パッケージ化されていない拡張機能を読み込む」
3. ダッシュボードを開き、AI Provider で「Built-in AI（APIキー不要）」を選択
4. Web ページを訪問し、要約が生成されることを確認
5. ネットワークを切断し、要約が継続して動作することを確認
6. 優先度リストで Built-in AI を 1位、Gemini を 2位に設定し、Built-in AI が失敗した場合に Gemini にフォールバックすることを確認

- [ ] **Step 3: Document results**

E2E 結果を `dev-docs/2026-07-26-chrome-built-in-ai-provider-design.md` の末尾か別途メモに記録。

- [ ] **Step 4: Commit any final fixes**

```bash
git add .
git commit -m "fix: address E2E findings for built-in-ai"
```

---

## Self-Review

- [ ] **Spec coverage:** design doc の各要件（Service 分離、Provider 統合、UI 選択、フォールバック、i18n、E2E）に対応するタスクがある
- [ ] **Placeholder scan:** TBD / TODO / 「適切に処理する」などの曖昧な表現なし
- [ ] **Type consistency:** `BuiltInAIService`, `LocalAIAvailability`, `AIProviderStrategy`, `AISummaryResult` の型を統一して使用
- [ ] **File boundaries:** `BuiltInAIProvider`（ビジネスロジック）と `OffscreenBuiltInAIService`（インフラ通信）を分離
- [ ] **Testability:** `BuiltInAIProvider` は `BuiltInAIService` を DI 可能

---

## 実行方法の選択

Plan complete and saved to `dev-docs/plans/2026-07-26-chrome-built-in-ai-provider-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
