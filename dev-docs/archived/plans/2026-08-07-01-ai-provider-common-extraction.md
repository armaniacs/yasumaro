# AIプロバイダー共通化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GeminiProvider` と `OpenAIProvider` の重複ロジックを `AIProviderStrategy` 基底クラスに抽出し、各プロバイダーはペイロード構築とAPI呼び出しのみに縮小する

**Architecture:** Template Method パターンを採用。`AIProviderStrategy` に共通フロー（プリフライトガード、コンテンツサニタイズ、HTTPエラーハンドリング）を実装し、各プロバイダーは `buildPayload()` と `parseResponse()` のみをオーバーライドする。

**Tech Stack:** TypeScript, Vitest, 既存の `fetchWithRetry` / `sanitizePromptContent` / `checkHardLimit` 等のユーティリティ

---

## ファイルマッピング

| 操作 | ファイル |
|------|---------|
| 変更 | `src/background/ai/providers/ProviderStrategy.ts` |
| 変更 | `src/background/ai/providers/GeminiProvider.ts` |
| 変更 | `src/background/ai/providers/OpenAIProvider.ts` |
| 変更 | `src/background/ai/providers/__tests__/ProviderStrategy.test.ts` |

---

### Task 1: `checkPreFlight()` を基底クラスに追加

**Files:**
- Modify: `src/background/ai/providers/ProviderStrategy.ts:44-49`（コンストラクタの後）

- [ ] **Step 1: テストを書く**

`src/background/ai/providers/__tests__/ProviderStrategy.test.ts` に追加:

```typescript
describe('checkPreFlight', () => {
    test('hardLimitブロック時は { blocked: true, message } を返す', async () => {
        vi.mock('../../../../utils/aiUsageTracker.js', () => ({
            checkHardLimit: vi.fn(async () => ({ blocked: true, message: 'Monthly limit reached' })),
            checkUsageWarning: vi.fn(async () => ({ warning: false })),
            checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetTime: Date.now() + 60000 })),
            getRateLimitMessage: vi.fn(() => 'Rate limit')
        }));
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = await provider.callCheckPreFlight();
        expect(result.blocked).toBe(true);
        expect(result.message).toBe('Monthly limit reached');
    });

    test('usageWarning時は { blocked: true, message } を返す', async () => {
        vi.mock('../../../../utils/aiUsageTracker.js', () => ({
            checkHardLimit: vi.fn(async () => ({ blocked: false })),
            checkUsageWarning: vi.fn(async () => ({ warning: true, message: 'Usage warning' })),
            checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetTime: Date.now() + 60000 })),
            getRateLimitMessage: vi.fn(() => 'Rate limit')
        }));
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = await provider.callCheckPreFlight();
        expect(result.blocked).toBe(true);
        expect(result.message).toBe('Usage warning');
    });

    test('rateLimitブロック時は { blocked: true, message } を返す', async () => {
        vi.mock('../../../../utils/aiUsageTracker.js', () => ({
            checkHardLimit: vi.fn(async () => ({ blocked: false })),
            checkUsageWarning: vi.fn(async () => ({ warning: false })),
            checkRateLimit: vi.fn(async () => ({ allowed: false, remaining: 0, resetTime: Date.now() + 60000 })),
            getRateLimitMessage: vi.fn(() => 'Rate limit exceeded')
        }));
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = await provider.callCheckPreFlight();
        expect(result.blocked).toBe(true);
        expect(result.message).toBe('Rate limit exceeded');
    });

    test('全チェック通過時は { blocked: false } を返す', async () => {
        vi.mock('../../../../utils/aiUsageTracker.js', () => ({
            checkHardLimit: vi.fn(async () => ({ blocked: false })),
            checkUsageWarning: vi.fn(async () => ({ warning: false })),
            checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetTime: Date.now() + 60000 })),
            getRateLimitMessage: vi.fn(() => 'Rate limit')
        }));
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = await provider.callCheckPreFlight();
        expect(result.blocked).toBe(false);
    });
});
```

`TestProvider` にテスト用ラッパーを追加:

```typescript
class TestProvider extends AIProviderStrategy {
    // ... 既存のメソッド ...

    // テスト用: protectedメソッドにアクセスするラッパー
    async callCheckPreFlight() {
        return this.checkPreFlight();
    }
}
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/background/ai/providers/__tests__/ProviderStrategy.test.ts`
Expected: FAIL with "Property 'checkPreFlight' does not exist"

- [ ] **Step 3: 最小限の実装を書く**

`src/background/ai/providers/ProviderStrategy.ts` にインポートを追加:

```typescript
import { Settings, StorageKeys } from '../../../utils/storage.js';
import { validateMaxTokens } from '../../../utils/aiLimits.js';
import { checkHardLimit, checkRateLimit, checkUsageWarning, getRateLimitMessage } from '../../../utils/aiUsageTracker.js';
```

`AIProviderStrategy` クラス内にメソッドを追加:

```typescript
    /**
     * プリフライトガード: 月次リミット、使用量警告、レート制限を順にチェック
     * @returns blocked=true の場合は caller は早期リターンすべき
     */
    protected async checkPreFlight(): Promise<{ blocked: boolean; message?: string }> {
        const hardLimit = await checkHardLimit();
        if (hardLimit.blocked) {
            return { blocked: true, message: `Error: ${hardLimit.message}` };
        }

        const usageWarning = await checkUsageWarning();
        if (usageWarning.warning) {
            return { blocked: true, message: `Error: ${usageWarning.message}` };
        }

        const rateLimit = await checkRateLimit();
        if (!rateLimit.allowed) {
            return { blocked: true, message: `Error: ${getRateLimitMessage(rateLimit.resetTime)}` };
        }

        return { blocked: false };
    }
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `npx vitest run src/background/ai/providers/__tests__/ProviderStrategy.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/background/ai/providers/ProviderStrategy.ts src/background/ai/providers/__tests__/ProviderStrategy.test.ts
git commit -m "refactor(ai): add checkPreFlight() to AIProviderStrategy base class"
```

---

### Task 2: `sanitizeContent()` を基底クラスに追加

**Files:**
- Modify: `src/background/ai/providers/ProviderStrategy.ts`

- [ ] **Step 1: テストを書く**

`src/background/ai/providers/__tests__/ProviderStrategy.test.ts` に追加:

```typescript
describe('sanitizeContent', () => {
    test('dangerLevel=high時は { blocked: true } を返す', () => {
        vi.mock('../../../../utils/promptSanitizer.js', () => ({
            sanitizePromptContent: (content: string) => ({
                sanitized: 'sanitized',
                warnings: ['injection detected'],
                dangerLevel: 'high'
            })
        }));
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callSanitizeContent('malicious content', 'test-provider', 'trace-1');
        expect(result.blocked).toBe(true);
        expect(result.warnings).toContain('injection detected');
    });

    test('dangerLevel=low時は { blocked: false, sanitized } を返す', () => {
        vi.mock('../../../../utils/promptSanitizer.js', () => ({
            sanitizePromptContent: (content: string) => ({
                sanitized: 'safe content',
                warnings: [],
                dangerLevel: 'low'
            })
        }));
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callSanitizeContent('safe content', 'test-provider', 'trace-1');
        expect(result.blocked).toBe(false);
        expect(result.sanitized).toBe('safe content');
    });
});
```

`TestProvider` にラッパーを追加:

```typescript
    callSanitizeContent(content: string, providerName: string, traceId: string) {
        return this.sanitizeContent(content, providerName, traceId);
    }
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/background/ai/providers/__tests__/ProviderStrategy.test.ts`
Expected: FAIL with "Property 'sanitizeContent' does not exist"

- [ ] **Step 3: 実装を書く**

`src/background/ai/providers/ProviderStrategy.ts` にインポートを追加:

```typescript
import { sanitizePromptContent } from '../../../utils/promptSanitizer.js';
import { addLog, LogType } from '../../../utils/logger.js';
```

`AIProviderStrategy` クラス内にメソッドを追加:

```typescript
    /**
     * コンテンツのサニタイズとプロンプトインジェクション検出
     * @returns blocked=true の場合は caller は早期リターンすべき
     */
    protected sanitizeContent(
        content: string,
        providerName: string,
        traceId: string
    ): { blocked: boolean; sanitized: string; warnings: string[] } {
        const { sanitized, warnings, dangerLevel } = sanitizePromptContent(content);
        if (warnings.length > 0) {
            addLog(LogType.WARN, `[${providerName}] Prompt injection detected: ${warnings.join('; ')}`, { traceId });
        }
        if (dangerLevel === 'high') {
            const cause = warnings.length > 0 ? warnings.join('; ') : 'High risk content detected';
            addLog(LogType.ERROR, `[${providerName}] High risk prompt injection blocked: ${cause}`, { traceId });
            return { blocked: true, sanitized, warnings };
        }
        return { blocked: false, sanitized, warnings };
    }
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `npx vitest run src/background/ai/providers/__tests__/ProviderStrategy.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/background/ai/providers/ProviderStrategy.ts src/background/ai/providers/__tests__/ProviderStrategy.test.ts
git commit -m "refactor(ai): add sanitizeContent() to AIProviderStrategy base class"
```

---

### Task 3: `mapConnectionError()` を基底クラスに追加

**Files:**
- Modify: `src/background/ai/providers/ProviderStrategy.ts`

- [ ] **Step 1: テストを書く**

`src/background/ai/providers/__tests__/ProviderStrategy.test.ts` に追加:

```typescript
describe('mapConnectionError', () => {
    test('401の場合は認証失敗メッセージを返す', () => {
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callMapConnectionError(401, 'OpenAI');
        expect(result.success).toBe(false);
        expect(result.message).toContain('Authentication failed');
        expect(result.debug?.statusCode).toBe(401);
    });

    test('404の場合はエンドポイント未発見メッセージを返す', () => {
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callMapConnectionError(404, 'Gemini');
        expect(result.success).toBe(false);
        expect(result.message).toContain('not found');
    });

    test('429の場合はレート制限メッセージを返す', () => {
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callMapConnectionError(429, 'OpenAI');
        expect(result.success).toBe(false);
        expect(result.message).toContain('Rate limit');
    });

    test('500の場合はサーバーエラーメッセージを返す', () => {
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callMapConnectionError(500, 'Gemini');
        expect(result.success).toBe(false);
        expect(result.message).toContain('API Error');
    });
});
```

`TestProvider` にラッパーを追加:

```typescript
    callMapConnectionError(statusCode: number, providerLabel: string) {
        return this.mapConnectionError(statusCode, providerLabel);
    }
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/background/ai/providers/__tests__/ProviderStrategy.test.ts`
Expected: FAIL with "Property 'mapConnectionError' does not exist"

- [ ] **Step 3: 実装を書く**

`AIProviderStrategy` クラス内にメソッドを追加:

```typescript
    /**
     * HTTPステータスコードをユーザー向け接続エラーメッセージに変換
     */
    protected mapConnectionError(
        statusCode: number,
        providerLabel: string
    ): AIProviderConnectionResult {
        if (statusCode === 401 || statusCode === 403) {
            return {
                success: false,
                message: `Authentication failed (${statusCode}). Check your ${providerLabel} API key.`,
                debug: { statusCode },
            };
        } else if (statusCode === 404) {
            return {
                success: false,
                message: `Endpoint not found (404). Check your Base URL.`,
                debug: { statusCode },
            };
        } else if (statusCode === 429) {
            return {
                success: false,
                message: `Rate limit exceeded (429). Please try again later.`,
                debug: { statusCode },
            };
        } else {
            return {
                success: false,
                message: `${providerLabel} API Error: ${statusCode}`,
                debug: { statusCode },
            };
        }
    }
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `npx vitest run src/background/ai/providers/__tests__/ProviderStrategy.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/background/ai/providers/ProviderStrategy.ts src/background/ai/providers/__tests__/ProviderStrategy.test.ts
git commit -m "refactor(ai): add mapConnectionError() to AIProviderStrategy base class"
```

---

### Task 4: `parseAndMapFetchError()` を基底クラスに追加

**Files:**
- Modify: `src/background/ai/providers/ProviderStrategy.ts`

- [ ] **Step 1: テストを書く**

`src/background/ai/providers/__tests__/ProviderStrategy.test.ts` に追加:

```typescript
describe('parseAndMapFetchError', () => {
    test('タイムアウトエラーの場合はタイムアウトメッセージを返す', () => {
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callParseAndMapFetchError('Aborted', 'OpenAI');
        expect(result.success).toBe(false);
        expect(result.message).toContain('timed out');
    });

    test('HTTPエラーメッセージの場合は対応するステータスメッセージを返す', () => {
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callParseAndMapFetchError('HTTP 401: Unauthorized', 'Gemini');
        expect(result.success).toBe(false);
        expect(result.message).toContain('Invalid API key');
    });

    test('ネットワークエラーの場合は接続エラーメッセージを返す', () => {
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callParseAndMapFetchError('Failed to fetch', 'OpenAI');
        expect(result.success).toBe(false);
        expect(result.message).toContain('Cannot connect');
    });

    test('その他エラーの場合は汎用エラーメッセージを返す', () => {
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callParseAndMapFetchError('Unknown error', 'Gemini');
        expect(result.success).toBe(false);
        expect(result.message).toContain('Connection error');
    });
});
```

`TestProvider` にラッパーを追加:

```typescript
    callParseAndMapFetchError(msg: string, providerLabel: string) {
        return this.parseAndMapFetchError(msg, providerLabel);
    }
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/background/ai/providers/__tests__/ProviderStrategy.test.ts`
Expected: FAIL with "Property 'parseAndMapFetchError' does not exist"

- [ ] **Step 3: 実装を書く**

`AIProviderStrategy` クラス内にメソッドを追加:

```typescript
    /**
     * fetchWithRetry がスローするエラーメッセージをパースし、ユーザー向け接続エラーメッセージに変換
     */
    protected parseAndMapFetchError(
        msg: string,
        providerLabel: string
    ): AIProviderConnectionResult {
        // タイムアウト判定
        if (msg.includes('timed out') || msg.includes('timeout')) {
            return {
                success: false,
                message: 'Connection timed out. Check your network or increase timeout.',
                debug: { error: msg },
            };
        }

        // HTTPステータスコードをパース
        const httpMatch = msg.match(/HTTP\s+(\d+):/);
        const statusCode = httpMatch ? parseInt(httpMatch[1], 10) : 0;

        if (statusCode === 401 || statusCode === 403) {
            return {
                success: false,
                message: `Invalid API key (${statusCode}). Check your ${providerLabel} API key settings.`,
                debug: { error: msg, statusCode },
            };
        } else if (statusCode === 404) {
            return {
                success: false,
                message: `Model or endpoint not found (404). Check your Base URL.`,
                debug: { error: msg, statusCode },
            };
        } else if (statusCode === 429) {
            return {
                success: false,
                message: `Rate limit exceeded (429). Please try again later.`,
                debug: { error: msg, statusCode },
            };
        } else if (statusCode >= 500) {
            return {
                success: false,
                message: `${providerLabel} API server error (${statusCode}). Please try again later.`,
                debug: { error: msg, statusCode },
            };
        } else if (msg.includes('Failed to fetch')) {
            return {
                success: false,
                message: 'Cannot connect. Check your Base URL and network.',
                debug: { error: msg },
            };
        } else {
            return {
                success: false,
                message: `Connection error: ${msg}`,
                debug: { error: msg, statusCode: statusCode || undefined },
            };
        }
    }
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `npx vitest run src/background/ai/providers/__tests__/ProviderStrategy.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/background/ai/providers/ProviderStrategy.ts src/background/ai/providers/__tests__/ProviderStrategy.test.ts
git commit -m "refactor(ai): add parseAndMapFetchError() to AIProviderStrategy base class"
```

---

### Task 5: GeminiProvider を基底クラスメソッドに書き換え

**Files:**
- Modify: `src/background/ai/providers/GeminiProvider.ts:44-137`（`generateSummary`）
- Modify: `src/background/ai/providers/GeminiProvider.ts:147-273`（`testConnection`）

- [ ] **Step 1: `generateSummary()` を書き換え**

`GeminiProvider.ts` の `generateSummary()` を以下に置換:

```typescript
    async generateSummary(content: string, tagSummaryMode: boolean = false, traceId: string = ''): Promise<AISummaryResult> {
        if (!this.apiKey) {
            return { success: false, summary: "Error: API key is missing. Please check your settings." };
        }

        // 共通プリフライトガード
        const preFlight = await this.checkPreFlight();
        if (preFlight.blocked) {
            return { success: false, summary: preFlight.message! };
        }

        const cleanModelName = this.model.replace(/^models\//, '');
        const apiVersion = this._getApiVersion();
        const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${cleanModelName}:generateContent`;
        const maxContentChars = this.getMaxContentChars(30_000, StorageKeys.GEMINI_CONTENT_CHARS);
        const truncatedContent = content.substring(0, maxContentChars);

        // 共通サニタイズ
        const sanitizeResult = this.sanitizeContent(truncatedContent, this.getName(), traceId);
        if (sanitizeResult.blocked) {
            return { success: false, summary: `Error: Content blocked due to potential security risk. (原因: ${sanitizeResult.warnings.join('; ')})` };
        }

        // カスタムプロンプトを適用（タグ付き要約モード対応）
        const { userPrompt, systemPrompt } = applyCustomPrompt(this.settings, this.getName(), sanitizeResult.sanitized, tagSummaryMode);

        const payload = {
            systemInstruction: {
                parts: [{
                    text: systemPrompt || getDefaultSystemPrompt()
                }]
            },
            contents: [{
                parts: [{
                    text: userPrompt
                }]
            }],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: this.getMaxTokens()
            }
        };

        try {
            const allowedUrls = await this._getAllowedUrls();

            const response = await fetchWithRetry(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': this.apiKey
                },
                body: JSON.stringify(payload),
                allowedUrls,
                timeoutMs: this.timeoutMs
            }, {
                maxRetryCount: 3,
                initialDelayMs: 1000,
                backoffMultiplier: 2,
                maxDelayMs: 60000
            });

            if (!response.ok) {
                return this._handleError(response);
            }

            const data = await response.json();
            return await this._extractSummary(data, traceId);
        } catch (error: unknown) {
            const msg = errorMessage(error);
            const isTimeout = error instanceof Error && error.name === 'AbortError';
            if (isTimeout || msg.includes('timed out')) {
                return { success: false, summary: "Error: AI request timed out. Please check your connection." };
            }
            return { success: false, summary: "Error: Failed to generate summary. Please try again or check your settings." };
        }
    }
```

- [ ] **Step 2: `testConnection()` を書き換え**

`GeminiProvider.ts` の `testConnection()` を以下に置換:

```typescript
    async testConnection(): Promise<AIProviderConnectionResult> {
        if (!this.apiKey) {
            return {
                success: false,
                message: 'Gemini API Key is not set.',
                debug: { error: 'API key is missing' },
            };
        }

        const testUrl = `https://generativelanguage.googleapis.com/${this._getApiVersion()}/models`;

        // BaseUrl SSRF対策 - テストURLの検証
        try {
            validateUrlForAIRequests(testUrl);
        } catch (error: unknown) {
            addLog(LogType.ERROR, `Invalid test URL for Gemini: ${errorMessage(error)}`);
            return {
                success: false,
                message: `Invalid test URL: ${errorMessage(error)}`,
                debug: { error: errorMessage(error) },
            };
        }

        try {
            const allowedUrls = await this._getAllowedUrls();

            const response = await fetchWithRetry(
                testUrl,
                {
                    method: 'GET',
                    headers: { 'x-goog-api-key': this.apiKey },
                    allowedUrls,
                    timeoutMs: this.timeoutMs
                },
                {
                    maxRetryCount: 1,
                    initialDelayMs: 500,
                    backoffMultiplier: 2,
                    maxDelayMs: 3000
                }
            );

            if (response.ok) {
                return {
                    success: true,
                    message: 'Connected to Gemini API.',
                    debug: { prompt: `GET ${testUrl}`, response: `HTTP ${response.status} OK`, hasContent: true },
                };
            }

            // 共通HTTPステータスマッピング
            return this.mapConnectionError(response.status, 'Gemini');
        } catch (e: unknown) {
            const msg = errorMessage(e);
            // 共通エラーパース
            return this.parseAndMapFetchError(msg, 'Gemini');
        }
    }
```

- [ ] **Step 3: 不要なインポートを削除**

`GeminiProvider.ts` から `checkHardLimit`, `checkRateLimit`, `checkUsageWarning`, `getRateLimitMessage` のインポートを削除（基底クラスが処理するため不要に）。`addLog`, `LogType` は `_handleError` と `_extractSummary` でまだ使用するため維持。

- [ ] **Step 4: 既存テストがパスすることを確認**

Run: `npx vitest run src/background/ai/providers/__tests__/GeminiProvider.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/background/ai/providers/GeminiProvider.ts
git commit -m "refactor(ai): use base class methods in GeminiProvider"
```

---

### Task 6: OpenAIProvider を基底クラスメソッドに書き換え

**Files:**
- Modify: `src/background/ai/providers/OpenAIProvider.ts:105-217`（`generateSummary`）
- Modify: `src/background/ai/providers/OpenAIProvider.ts:219-334`（`testConnection`）

- [ ] **Step 1: `generateSummary()` を書き換え**

`OpenAIProvider.ts` の `generateSummary()` を以下に置換:

```typescript
    async generateSummary(content: string, tagSummaryMode: boolean = false, traceId: string = ''): Promise<AISummaryResult> {
        if (!this.baseUrl) {
            return { success: false, summary: "Error: Base URL is missing. Please check your settings." };
        }

        // 共通プリフライトガード
        const preFlight = await this.checkPreFlight();
        if (preFlight.blocked) {
            return { success: false, summary: preFlight.message! };
        }

        const trimmedBaseUrl = this.baseUrl.replace(/\/$/, '');
        const url = `${trimmedBaseUrl}/chat/completions`;
        const contentLimit = OpenAIProvider.isLocalUrl(this.baseUrl)
            ? 4000
            : this.getMaxContentLength();
        const truncatedContent = content.substring(0, contentLimit);

        // 共通サニタイズ
        const sanitizeResult = this.sanitizeContent(truncatedContent, this.providerName, traceId);
        if (sanitizeResult.blocked) {
            return { success: false, summary: `Error: Content blocked due to potential security risk. (原因: ${sanitizeResult.warnings.join('; ')})` };
        }

        // カスタムプロンプトを適用（タグ付き要約モード対応）
        const { userPrompt, systemPrompt } = applyCustomPrompt(this.settings, this.providerName, sanitizeResult.sanitized, tagSummaryMode);

        const payload = {
            model: this.model,
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: userPrompt
                }
            ],
            max_tokens: this.getMaxTokens(),
            temperature: 0.1
        };

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        try {
            const allowedUrls = await this._getAllowedUrls();

            const response = await fetchWithRetry(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
                allowedUrls,
                timeoutMs: this.timeoutMs
            }, {
                maxRetryCount: 3,
                initialDelayMs: 1000,
                backoffMultiplier: 2,
                maxDelayMs: 60000,
                shouldRetry: (error: Error, attempt: number, response: Response | null, method?: string) => {
                    if (response?.status === 429) return false;
                    if (response && response.status >= 500) {
                        return !['POST', 'PUT', 'PATCH'].includes(method?.toUpperCase() ?? 'POST');
                    }
                    if (error.name === 'AbortError' || error.message.includes('timed out')) {
                        return attempt <= 1;
                    }
                    if (error.name === 'NetworkError' || error.message.includes('NetworkError') || error.message.includes('fetch failed')) {
                        return true;
                    }
                    return false;
                }
            });

            if (!response.ok) {
                return { success: false, summary: "Error: Failed to generate summary. Please check your API settings." };
            }

            const data = await response.json();
            return this._extractSummary(data, traceId);
        } catch (error: unknown) {
            const msg = errorMessage(error);
            const isTimeout = error instanceof Error && error.name === 'AbortError';
            if (isTimeout || msg.includes('timed out')) {
                return { success: false, summary: "Error: AI request timed out. Please check your connection." };
            }
            return { success: false, summary: "Error: Failed to generate summary. Please try again or check your settings." };
        }
    }
```

- [ ] **Step 2: `testConnection()` を書き換え**

`OpenAIProvider.ts` の `testConnection()` を以下に置換:

```typescript
    async testConnection(): Promise<AIProviderConnectionResult> {
        if (!this.baseUrl) {
            return {
                success: false,
                message: 'Base URL is not set.',
                debug: { error: 'Base URL is missing' },
            };
        }

        const trimmedBaseUrl = this.baseUrl.replace(/\/$/, '');
        const url = `${trimmedBaseUrl}/models`;

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        try {
            const allowedUrls = await this._getAllowedUrls();

            const response = await fetchWithRetry(url, {
                method: 'GET',
                headers,
                allowedUrls,
                timeoutMs: this.timeoutMs
            }, {
                maxRetryCount: 1,
                initialDelayMs: 500,
                backoffMultiplier: 2,
                maxDelayMs: 3000
            });

            if (response.ok) {
                return {
                    success: true,
                    message: 'Connected to AI API.',
                    debug: { prompt: `GET ${url}`, response: `HTTP ${response.status} OK`, hasContent: true },
                };
            }

            // 共通HTTPステータスマッピング
            return this.mapConnectionError(response.status, 'OpenAI');
        } catch (e: unknown) {
            const msg = errorMessage(e);
            // 共通エラーパース
            return this.parseAndMapFetchError(msg, 'OpenAI');
        }
    }
```

- [ ] **Step 3: 不要なインポートを削除**

`OpenAIProvider.ts` から `checkHardLimit`, `checkRateLimit`, `checkUsageWarning`, `getRateLimitMessage` のインポートを削除。

- [ ] **Step 4: 既存テストがパスすることを確認**

Run: `npx vitest run src/background/ai/providers/__tests__/OpenAIProvider.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/background/ai/providers/OpenAIProvider.ts
git commit -m "refactor(ai): use base class methods in OpenAIProvider"
```

---

### Task 7: 全テスト実行 + 型チェック

**Files:** なし（検証のみ）

- [ ] **Step 1: 型チェックを実行**

Run: `npx tsc --noEmit`
Expected: PASS（型エラーなし）

- [ ] **Step 2: 全テストを実行**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 3: ビルドを実行**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: コミット（必要に応じて）**

型エラー修正等がある場合のみコミット。

---

## 検証チェックリスト

- [ ] `GeminiProvider.generateSummary()` の行数が ~80行 → ~50行以下に縮小
- [ ] `OpenAIProvider.generateSummary()` の行数が ~110行 → ~80行以下に縮小
- [ ] `GeminiProvider.testConnection()` の行数が ~130行 → ~50行以下に縮小
- [ ] `OpenAIProvider.testConnection()` の行数が ~120行 → ~50行以下に縮小
- [ ] `ProviderStrategy.ts` に `checkPreFlight`, `sanitizeContent`, `mapConnectionError`, `parseAndMapFetchError` が追加
- [ ] 既存テストが全てパスする
- [ ] 型チェックがパスする
- [ ] ビルドが成功する
