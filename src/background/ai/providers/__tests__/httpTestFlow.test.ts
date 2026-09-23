/**
 * httpTestFlow.test.ts
 * PBI 2026-09-17-10: executeHttpTestFlow parity + contentCharsKey SSOT pin.
 *
 * Parity: testConnection results (success/message/debug shape) are byte-identical
 * to the pre-template implementations. Any wording drift fails here; wording
 * improvements belong to a separate PBI.
 *
 * SSOT: the truncation-limit key comes from the catalog entry handed in by
 * createProviderStrategy, not from a provider-side hardcode. Swapping the key
 * changes the observed truncation limit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiProvider } from '../GeminiProvider.js';
import { GenericOpenAICompatibleProvider } from '../OpenAIProvider.js';
import { createProviderStrategy } from '../../providerCatalog.js';
import { CONNECTION_TEST_PROMPT } from '../ProviderStrategy.js';
import { StorageKeys } from '../../../../utils/storage/types.js';
import type { Settings } from '../../../../utils/storage/types.js';

vi.mock('../../../../utils/aiUsageTracker.js', () => ({
  checkHardLimit: vi.fn(async () => ({ blocked: false })),
  checkUsageWarning: vi.fn(async () => ({ warning: false })),
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetTime: Date.now() + 60000 })),
  getRateLimitMessage: vi.fn(() => 'Rate limit exceeded'),
  recordUsage: vi.fn(),
}));
vi.mock('../../../../utils/promptSanitizer.js', () => ({
  sanitizePromptContent: vi.fn((content: string) => ({ sanitized: content, warnings: [], dangerLevel: 'low' })),
}));
vi.mock('../../../../utils/customPromptUtils.js', () => ({
  applyCustomPrompt: vi.fn((_settings: unknown, _provider: string, content: string) => ({
    userPrompt: `summarize: ${content}`,
    systemPrompt: 'You are a helpful assistant.',
  })),
  getDefaultSystemPrompt: vi.fn(() => 'Default system prompt.'),
}));
vi.mock('../../../../utils/fetch.js', () => ({
  CONNECTION_TEST_CACHE_MODE: 'no-store',
  fetchWithRetry: vi.fn(),
  validateUrlForAIRequests: vi.fn(),
}));
vi.mock('../../../../utils/storage/urlWhitelist.js', () => ({
  buildAllowedUrls: vi.fn((): Set<string> => new Set<string>()),
}));

async function fetchMock() {
  const mod = await import('../../../../utils/fetch.js');
  return vi.mocked(mod.fetchWithRetry);
}

const geminiSettings = {
  gemini_api_key: 'test-key',
  gemini_model: 'gemini-test',
} as unknown as Settings;

const openaiSettings = {
  openai_base_url: 'https://api.openai.com/v1',
  openai_api_key: 'test-key',
  openai_model: 'gpt-3.5-turbo',
} as unknown as Settings;

const lmStudioSettings = {
  lm_studio_base_url: 'http://127.0.0.1:1234/v1',
  lm_studio_model: 'local-model',
} as unknown as Settings;

const GEMINI_ENDPOINT = 'POST https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent';
const OPENAI_ENDPOINT = 'POST https://api.openai.com/v1/chat/completions';
const LM_STUDIO_ENDPOINT = 'POST http://127.0.0.1:1234/v1/chat/completions';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeHttpTestFlow parity — Gemini', () => {
  it('returns the exact success shape', async () => {
    const fetch = await fetchMock();
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        candidates: [{ content: { parts: [{ text: 'OK' }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
      }),
    } as Response);

    const result = await new GeminiProvider(geminiSettings).testConnection();

    expect(result).toEqual({
      success: true,
      message: 'Connected to Gemini API.',
      debug: {
        prompt: CONNECTION_TEST_PROMPT,
        endpoint: GEMINI_ENDPOINT,
        modelName: 'gemini-test',
        statusCode: 200,
        hasContent: true,
        response: 'OK',
        sentTokens: 5,
        receivedTokens: 2,
      },
    });
  });

  it('maps HTTP 401 through mapConnectionError with the Gemini label', async () => {
    const fetch = await fetchMock();
    fetch.mockResolvedValueOnce({ ok: false, status: 401 } as Response);

    const result = await new GeminiProvider(geminiSettings).testConnection();

    expect(result).toEqual({
      success: false,
      message: 'Authentication failed (401). Check your Gemini API key.',
      debug: {
        statusCode: 401,
        prompt: CONNECTION_TEST_PROMPT,
        endpoint: GEMINI_ENDPOINT,
      },
    });
  });

  it('reports an empty response with the exact legacy wording', async () => {
    const fetch = await fetchMock();
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ candidates: [{}] }),
    } as Response);

    const result = await new GeminiProvider(geminiSettings).testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toBe('Response contained no content.');
    expect(result.debug?.error).toContain('candidates[0].content.parts had no text');
    expect(result.debug?.response).toBeUndefined();
  });

  it('maps a network failure through parseAndMapFetchError', async () => {
    const fetch = await fetchMock();
    fetch.mockRejectedValueOnce(new Error('Failed to fetch'));

    const result = await new GeminiProvider(geminiSettings).testConnection();

    expect(result).toEqual({
      success: false,
      message: 'Cannot connect. Check your Base URL and network.',
      debug: {
        error: 'Failed to fetch',
        prompt: CONNECTION_TEST_PROMPT,
        endpoint: GEMINI_ENDPOINT,
      },
    });
  });

  it('keeps the missing-key early return without fetching', async () => {
    const fetch = await fetchMock();
    const provider = new GeminiProvider({ ...geminiSettings, gemini_api_key: '' } as unknown as Settings);

    const result = await provider.testConnection();

    expect(result).toEqual({
      success: false,
      message: 'Gemini API Key is not set. Please enter it in the AI provider settings.',
      debug: { error: 'API key is missing' },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the invalid-model early return without fetching', async () => {
    const fetch = await fetchMock();
    const provider = new GeminiProvider({ ...geminiSettings, gemini_model: '../../../etc/passwd' } as Settings);

    const result = await provider.testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid model name');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the shared connection-test retry policy', async () => {
    const fetch = await fetchMock();
    fetch.mockResolvedValueOnce({ ok: false, status: 401 } as Response);

    await new GeminiProvider(geminiSettings).testConnection();

    const retry = fetch.mock.calls[0]![2] as Record<string, unknown>;
    expect(retry).toEqual({
      maxRetryCount: 1,
      initialDelayMs: 500,
      backoffMultiplier: 2,
      maxDelayMs: 3000,
    });
  });
});

describe('executeHttpTestFlow parity — OpenAI-compatible', () => {
  it('returns the exact success shape', async () => {
    const fetch = await fetchMock();
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'OK' } }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      }),
    } as Response);

    const result = await new GenericOpenAICompatibleProvider(openaiSettings, 'openai').testConnection();

    expect(result).toEqual({
      success: true,
      message: 'Connected to AI API.',
      debug: {
        prompt: CONNECTION_TEST_PROMPT,
        endpoint: OPENAI_ENDPOINT,
        modelName: 'gpt-3.5-turbo',
        statusCode: 200,
        hasContent: true,
        response: 'OK',
        sentTokens: 5,
        receivedTokens: 1,
      },
    });
  });

  it('maps HTTP 401 with the provider id label (PBI 01 behavior)', async () => {
    const fetch = await fetchMock();
    fetch.mockResolvedValueOnce({ ok: false, status: 401 } as Response);

    const result = await new GenericOpenAICompatibleProvider(openaiSettings, 'openai').testConnection();

    expect(result).toEqual({
      success: false,
      message: 'Authentication failed (401). Check your openai API key.',
      debug: {
        statusCode: 401,
        prompt: CONNECTION_TEST_PROMPT,
        endpoint: OPENAI_ENDPOINT,
      },
    });
  });

  it('uses the provider id label on the fetch-error path (PBI 11: fetchErrorLabel removed)', async () => {
    const fetch = await fetchMock();
    fetch.mockRejectedValueOnce(new Error('HTTP 503: Service Unavailable'));

    const result = await new GenericOpenAICompatibleProvider(openaiSettings, 'openai').testConnection();

    expect(result).toEqual({
      success: false,
      message: 'openai API server error (503). Please try again later.',
      debug: {
        error: 'HTTP 503: Service Unavailable',
        statusCode: 503,
        prompt: CONNECTION_TEST_PROMPT,
        endpoint: OPENAI_ENDPOINT,
      },
    });
  });

  it('reports an empty response with the exact legacy wording', async () => {
    const fetch = await fetchMock();
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content: '   ' } }] }),
    } as Response);
    const result = await new GenericOpenAICompatibleProvider(openaiSettings, 'openai').testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toBe('Response contained no content.');
    expect(result.debug?.error).toBe('choices[0].message.content was empty');
    expect(result.debug?.response).toBeUndefined();
  });

  it('keeps the missing-baseUrl early return without fetching', async () => {
    const fetch = await fetchMock();
    const provider = new GenericOpenAICompatibleProvider(
      { provider_api_key: 'k', provider_model: 'm' } as unknown as Settings,
      'openai-compatible',
    );

    const result = await provider.testConnection();

    expect(result).toEqual({
      success: false,
      message: 'Base URL is not set.',
      debug: { error: 'Base URL is missing' },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the shared connection-test retry policy', async () => {
    const fetch = await fetchMock();
    fetch.mockResolvedValueOnce({ ok: false, status: 401 } as Response);

    await new GenericOpenAICompatibleProvider(openaiSettings, 'openai').testConnection();

    const retry = fetch.mock.calls[0]![2] as Record<string, unknown>;
    expect(retry).toEqual({
      maxRetryCount: 1,
      initialDelayMs: 500,
      backoffMultiplier: 2,
      maxDelayMs: 3000,
    });
  });
});

describe('fetch-error provider label — lm-studio regression (PBI 11)', () => {
  it('names lm-studio (not OpenAI) when fetch throws an HTTP 401', async () => {
    const fetch = await fetchMock();
    fetch.mockRejectedValueOnce(new Error('HTTP 401: Unauthorized'));

    const result = await new GenericOpenAICompatibleProvider(lmStudioSettings, 'lm-studio').testConnection();

    expect(result).toEqual({
      success: false,
      message: 'Invalid API key (401). Check your lm-studio API key settings.',
      debug: {
        error: 'HTTP 401: Unauthorized',
        statusCode: 401,
        prompt: CONNECTION_TEST_PROMPT,
        endpoint: LM_STUDIO_ENDPOINT,
      },
    });
    expect(result.message).not.toContain('OpenAI');
  });

  it('names lm-studio (not OpenAI) when fetch throws an HTTP 5xx', async () => {
    const fetch = await fetchMock();
    fetch.mockRejectedValueOnce(new Error('HTTP 503: Service Unavailable'));

    const result = await new GenericOpenAICompatibleProvider(lmStudioSettings, 'lm-studio').testConnection();

    expect(result.message).toBe('lm-studio API server error (503). Please try again later.');
    expect(result.message).not.toContain('OpenAI');
  });

  it('never shows OpenAI on Failed to fetch (unlabeled wording, byte-identical)', async () => {
    const fetch = await fetchMock();
    fetch.mockRejectedValueOnce(new Error('Failed to fetch'));

    const result = await new GenericOpenAICompatibleProvider(lmStudioSettings, 'lm-studio').testConnection();

    expect(result).toEqual({
      success: false,
      message: 'Cannot connect. Check your Base URL and network.',
      debug: {
        error: 'Failed to fetch',
        prompt: CONNECTION_TEST_PROMPT,
        endpoint: LM_STUDIO_ENDPOINT,
      },
    });
    expect(result.message).not.toContain('OpenAI');
  });

  it('never shows OpenAI on timeout (unlabeled wording, byte-identical)', async () => {
    const fetch = await fetchMock();
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetch.mockRejectedValueOnce(abortError);

    const result = await new GenericOpenAICompatibleProvider(lmStudioSettings, 'lm-studio').testConnection();

    expect(result.message).toBe('Connection timed out. Check your network or increase timeout.');
    expect(result.message).not.toContain('OpenAI');
    expect(result.message).not.toContain('lm-studio');
  });
});

describe('contentCharsKey SSOT', () => {
  async function sentUserPrompt(provider: { generateSummary(c: string, t?: boolean, tid?: string): Promise<unknown> }, content: string): Promise<string> {
    const fetch = await fetchMock();
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    } as Response);
    await provider.generateSummary(content, false, '');
    const body = (fetch.mock.calls[0]![1] as { body: string }).body;
    return (JSON.parse(body) as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0]!.parts[0]!.text;
  }

  async function sentOpenAIPrompt(provider: { generateSummary(c: string, t?: boolean, tid?: string): Promise<unknown> }, content: string): Promise<string> {
    const fetch = await fetchMock();
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
    } as Response);
    await provider.generateSummary(content, false, '');
    const body = (fetch.mock.calls[0]![1] as { body: string }).body;
    const messages = (JSON.parse(body) as { messages: Array<{ content: string }> }).messages;
    return messages[1]!.content;
  }

  it('Gemini follows an injected contentCharsKey instead of the hardcode', async () => {
    const settings = {
      ...geminiSettings,
      [StorageKeys.SUMMARY_MIN_LENGTH]: 100,
    } as unknown as Settings;
    const provider = new GeminiProvider(settings, StorageKeys.SUMMARY_MIN_LENGTH);

    const text = await sentUserPrompt(provider, 'y'.repeat(5000));

    expect(text).toBe(`summarize: ${'y'.repeat(100)}`);
  });

  it('OpenAI-compatible follows an injected contentCharsKey instead of the hardcode', async () => {
    const settings = {
      ...openaiSettings,
      [StorageKeys.SUMMARY_MIN_LENGTH]: 100,
    } as unknown as Settings;
    const provider = new GenericOpenAICompatibleProvider(settings, 'openai', StorageKeys.SUMMARY_MIN_LENGTH);

    const text = await sentOpenAIPrompt(provider, 'x'.repeat(5000));

    expect(text).toBe(`summarize: ${'x'.repeat(100)}`);
  });

  it('createProviderStrategy routes the catalog key for gemini', async () => {
    const settings = {
      gemini_api_key: 'k',
      gemini_model: 'm',
      [StorageKeys.GEMINI_CONTENT_CHARS]: 100,
      [StorageKeys.OPENAI_CONTENT_CHARS]: 99999,
    } as unknown as Settings;
    const provider = createProviderStrategy('gemini', settings);

    const text = await sentUserPrompt(provider, 'y'.repeat(5000));

    expect(text).toBe(`summarize: ${'y'.repeat(100)}`);
  });

  it('createProviderStrategy routes the catalog key for openai2', async () => {
    const settings = {
      openai_2_base_url: 'https://api.openai.com/v1',
      openai_2_api_key: 'k',
      openai_2_model: 'm',
      [StorageKeys.OPENAI_CONTENT_CHARS]: 100,
    } as unknown as Settings;
    const provider = createProviderStrategy('openai2', settings);

    const text = await sentOpenAIPrompt(provider, 'x'.repeat(5000));

    expect(text).toBe(`summarize: ${'x'.repeat(100)}`);
  });
});
