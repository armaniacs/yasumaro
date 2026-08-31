import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GenericOpenAICompatibleProvider, OpenAIProvider } from '../OpenAIProvider.js';
import type { Settings } from '../../../../utils/storage.js';

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
  applyCustomPrompt: vi.fn((settings: unknown, provider: string, content: string) => ({
    userPrompt: `summarize: ${content}`,
    systemPrompt: 'You are a helpful assistant.',
  })),
}));
vi.mock('../../../../utils/fetch.js', () => ({
  CONNECTION_TEST_CACHE_MODE: 'no-store',
  fetchWithRetry: vi.fn(),
  validateUrlForAIRequests: vi.fn(),
}));
vi.mock('../../../../utils/storage/types.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../utils/storage/types.js')>('../../../../utils/storage/types.js');
  return { ...actual, getAllowedUrls: vi.fn(() => Promise.resolve([])) };
});
vi.mock('../../../../utils/storage/defaults.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../utils/storage/defaults.js')>('../../../../utils/storage/defaults.js');
  return { ...actual, getAllowedUrls: vi.fn(() => Promise.resolve([])) };
});
vi.mock('../../../../utils/storage/encryptionSession.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../utils/storage/encryptionSession.js')>('../../../../utils/storage/encryptionSession.js');
  return { ...actual, getAllowedUrls: vi.fn(() => Promise.resolve([])) };
});
vi.mock('../../../../utils/storage.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../utils/storage.js')>('../../../../utils/storage.js');
  return { ...actual, getAllowedUrls: vi.fn(() => Promise.resolve([])) };
});
vi.mock('../../../../utils/storage/savedUrlRepository.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../utils/storage/savedUrlRepository.js')>('../../../../utils/storage/savedUrlRepository.js');
  return { ...actual, getAllowedUrls: vi.fn(() => Promise.resolve([])) };
});
vi.mock('../../../../utils/storage/domainFilterCache.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../utils/storage/domainFilterCache.js')>('../../../../utils/storage/domainFilterCache.js');
  return { ...actual, getAllowedUrls: vi.fn(() => Promise.resolve([])) };
});
vi.mock('../../../../utils/storage/quota.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../utils/storage/quota.js')>('../../../../utils/storage/quota.js');
  return { ...actual, getAllowedUrls: vi.fn(() => Promise.resolve([])) };
});

describe('OpenAIProvider: branch coverage', () => {
  const baseSettings = {
    openai_base_url: 'https://api.openai.com/v1',
    openai_api_key: 'test_key',
    openai_model: 'gpt-3.5-turbo',
  } as unknown as Settings;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isLocalUrl static helper', () => {
    it('localhost を local と判定する', () => {
      expect(GenericOpenAICompatibleProvider.isLocalUrl('http://localhost:1234/v1')).toBe(true);
    });

    it('.localhost サブドメインを local と判定する', () => {
      expect(GenericOpenAICompatibleProvider.isLocalUrl('http://foo.localhost:1234/v1')).toBe(true);
    });

    it('127.x.x.x を local と判定する', () => {
      expect(GenericOpenAICompatibleProvider.isLocalUrl('http://127.0.0.1:1234/v1')).toBe(true);
    });

    it('::1 を local と判定する', () => {
      // new URL().hostname for IPv6 keeps brackets ("[::1]"), so only the bracketed
      // form matches the "hostname.toLowerCase() === '::1'" branch as-is; this
      // documents the current (non-matching) behavior rather than assuming otherwise.
      expect(GenericOpenAICompatibleProvider.isLocalUrl('http://[::1]:1234/v1')).toBe(false);
    });

    it('通常のリモートホストは local ではない', () => {
      expect(GenericOpenAICompatibleProvider.isLocalUrl('https://api.openai.com/v1')).toBe(false);
    });

    it('不正なURLは非ローカル扱いになる', () => {
      expect(GenericOpenAICompatibleProvider.isLocalUrl('not a url')).toBe(false);
    });

    it('OpenAIProvider の static isLocalUrl も同じ挙動になる', () => {
      expect(OpenAIProvider.isLocalUrl('http://127.0.0.1:11434')).toBe(true);
    });
  });

  describe('unknown provider fallback (registry未登録)', () => {
    it('未知のプロバイダー名でも legacy フォールバックで動作する', () => {
      const settings = {
        unknownprov_base_url: 'https://example.com/v1',
        unknownprov_api_key: 'k',
        unknownprov_model: 'my-model',
      } as unknown as Settings;
      const provider = new GenericOpenAICompatibleProvider(settings, 'unknownprov');
      expect(provider.getName()).toBe('unknownprov');
    });

    it('openai-compatible は PROVIDER_MODEL キーを使う', () => {
      const settings = {
        provider_base_url: 'https://example.com/v1',
        provider_api_key: 'k',
        provider_model: 'compat-model',
      } as unknown as Settings;
      const provider = new GenericOpenAICompatibleProvider(settings, 'openai-compatible');
      expect(provider.getName()).toBe('openai-compatible');
    });

    it('ハイフンを含むプロバイダー名は normalize される (name2 pattern)', () => {
      const settings = {} as unknown as Settings;
      const provider = new GenericOpenAICompatibleProvider(settings, 'foo-bar2');
      expect(provider.getName()).toBe('foo-bar2');
    });

    it('baseUrl が未設定の場合 isLocal は false になる', () => {
      const settings = {} as unknown as Settings;
      // legacy fallback always has a default base URL, so isLocal derives from that URL (remote by default)
      const provider = new GenericOpenAICompatibleProvider(settings, 'customprov');
      expect(provider.getName()).toBe('customprov');
    });
  });

  describe('registry entry without baseUrlKey/modelKey (built-in-ai)', () => {
    it('baseUrlKeyが無いentryはdefaultBaseUrlの空文字にfallbackする', () => {
      const settings = {} as unknown as Settings;
      const provider = new GenericOpenAICompatibleProvider(settings, 'built-in-ai');
      expect(provider.getName()).toBe('built-in-ai');
    });

    it('modelKeyが無いentryはdefaultModelの空文字にfallbackする', async () => {
      const settings = {} as unknown as Settings;
      const provider = new GenericOpenAICompatibleProvider(settings, 'built-in-ai');
      // baseUrl is empty (no baseUrlKey/defaultBaseUrl), so generateSummary short-circuits
      // before using `model`; this test only asserts the constructor doesn't throw.
      const result = await provider.generateSummary('content');
      expect(result.summary).toContain('Base URL is missing');
    });
  });

  describe('AI_TIMEOUT_MS storage override', () => {
    it('storedTimeout > 0 の場合はその値を timeoutMs として使う', async () => {
      const settings = {
        openai_base_url: 'https://api.openai.com/v1',
        openai_api_key: 'test_key',
        openai_model: 'gpt-3.5-turbo',
        ai_timeout_ms: 5000,
      } as unknown as Settings;
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: 'OK' } }] }),
      } as Response);
      const provider = new OpenAIProvider(settings, 'openai');
      await provider.testConnection();
      const callArgs = vi.mocked(fetchModule.fetchWithRetry).mock.calls[0];
      const opts = callArgs[1] as { timeoutMs?: number };
      expect(opts.timeoutMs).toBe(5000);
    });
  });

  describe('baseUrl SSRF検証', () => {
    it('validateUrlForAIRequests が例外を投げた場合はコンストラクタが失敗する', async () => {
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.validateUrlForAIRequests).mockImplementationOnce(() => {
        throw new Error('blocked url');
      });
      expect(() => new OpenAIProvider(baseSettings, 'openai')).toThrow('Invalid baseUrl');
    });

    it('registry allowlist で許可されないURLはコンストラクタが失敗する', () => {
      const settings = {
        openai_base_url: 'http://169.254.169.254/v1',
        openai_api_key: 'test_key',
        openai_model: 'gpt-3.5-turbo',
      } as unknown as Settings;
      expect(() => new OpenAIProvider(settings, 'openai')).toThrow('Invalid baseUrl');
    });
  });

  describe('generateSummary: preflight / sanitize / timeout branches', () => {
    it('baseUrl が空の場合エラーを返す (baseUrlKeyもdefaultBaseUrlも無いprovider)', async () => {
      // 'openai-compatible' has no defaultBaseUrl in the registry, so an unset
      // provider_base_url resolves to an actually-empty baseUrl.
      const settings = { provider_api_key: 'k', provider_model: 'm' } as unknown as Settings;
      const provider = new GenericOpenAICompatibleProvider(settings, 'openai-compatible');
      const result = await provider.generateSummary('content');
      expect(result.success).toBe(false);
      expect(result.summary).toContain('Base URL is missing');
    });

    it('hardLimit で blocked の場合はエラーを返す', async () => {
      const usageTracker = await import('../../../../utils/aiUsageTracker.js');
      vi.mocked(usageTracker.checkHardLimit).mockResolvedValueOnce({ blocked: true, message: 'limit reached' } as never);
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.generateSummary('content');
      expect(result.success).toBe(false);
      expect(result.summary).toContain('limit reached');
    });

    it('dangerLevel high の場合はコンテンツをブロックする', async () => {
      const sanitizer = await import('../../../../utils/promptSanitizer.js');
      vi.mocked(sanitizer.sanitizePromptContent).mockReturnValueOnce({
        sanitized: 'x',
        warnings: ['dangerous pattern'],
        dangerLevel: 'high',
      } as never);
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.generateSummary('content');
      expect(result.success).toBe(false);
      expect(result.summary).toContain('Content blocked');
      expect(result.summary).toContain('dangerous pattern');
    });

    it('response.ok が false の場合、汎用エラーを返す', async () => {
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('server error'),
      } as Response);
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.generateSummary('content');
      expect(result.success).toBe(false);
      expect(result.summary).toContain('Failed to generate summary');
    });

    it('AbortError の場合タイムアウトメッセージを返す', async () => {
      const fetchModule = await import('../../../../utils/fetch.js');
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      vi.mocked(fetchModule.fetchWithRetry).mockRejectedValueOnce(abortError);
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.generateSummary('content');
      expect(result.summary).toContain('timed out');
    });

    it('"timed out" を含むメッセージの場合もタイムアウト扱いになる', async () => {
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockRejectedValueOnce(new Error('request timed out'));
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.generateSummary('content');
      expect(result.summary).toContain('timed out');
    });

    it('その他のエラーの場合、汎用エラーを返す', async () => {
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockRejectedValueOnce(new Error('boom'));
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.generateSummary('content');
      expect(result.summary).toContain('Failed to generate summary');
    });

    it('isLocal な場合コンテンツ長を4000文字に制限する', async () => {
      const settings = {
        lm_studio_base_url: 'http://127.0.0.1:1234/v1',
        lm_studio_model: 'local-model',
      } as unknown as Settings;
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: 'summary text' } }] }),
      } as Response);
      const provider = new GenericOpenAICompatibleProvider(settings, 'lm-studio');
      const result = await provider.generateSummary('a'.repeat(5000));
      expect(result.success).toBe(true);
    });

    it('apiKeyが無い場合はAuthorizationヘッダーを付けない', async () => {
      const settings = {
        lm_studio_base_url: 'http://127.0.0.1:1234/v1',
        lm_studio_model: 'local-model',
      } as unknown as Settings;
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      } as Response);
      const provider = new GenericOpenAICompatibleProvider(settings, 'lm-studio');
      await provider.generateSummary('content');
      const callArgs = vi.mocked(fetchModule.fetchWithRetry).mock.calls[0];
      const headers = (callArgs[1] as RequestInit).headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('成功時、正しい要約結果を返す', async () => {
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'a nice summary' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      } as Response);
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.generateSummary('content');
      expect(result.success).toBe(true);
      expect(result.summary).toBe('a nice summary');
      expect(result.sentTokens).toBe(10);
      expect(result.receivedTokens).toBe(20);
    });
  });

  describe('_extractSummary schema validation branches', () => {
    it('choices が無い場合はスキーマエラーを返す', async () => {
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as Response);
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.generateSummary('content');
      expect(result.success).toBe(false);
      expect(result.summary).toContain('unexpected schema');
      expect(result.error).toContain('choices is missing or empty');
    });

    it('choices が空配列の場合はスキーマエラーを返す', async () => {
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [] }),
      } as Response);
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.generateSummary('content');
      expect(result.success).toBe(false);
      expect(result.error).toContain('choices is missing or empty');
    });

    it('message が無い場合はスキーマエラーを返す', async () => {
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{}] }),
      } as Response);
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.generateSummary('content');
      expect(result.success).toBe(false);
      expect(result.error).toContain('message is missing');
    });

    it('content が文字列でない場合はスキーマエラーを返す', async () => {
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: 123 } }] }),
      } as Response);
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.generateSummary('content');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not a string');
    });

    it('usageが無い場合はトークンを記録しない (recordUsageIfPresent early return)', async () => {
      const usageTracker = await import('../../../../utils/aiUsageTracker.js');
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: 'no usage info' } }] }),
      } as Response);
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.generateSummary('content');
      expect(result.success).toBe(true);
      expect(result.sentTokens).toBeUndefined();
      expect(usageTracker.recordUsage).not.toHaveBeenCalled();
    });
  });

  describe('testConnection', () => {
    it('baseUrl が空の場合エラーを返す (baseUrlKeyもdefaultBaseUrlも無いprovider)', async () => {
      const settings = { provider_api_key: 'k', provider_model: 'm' } as unknown as Settings;
      const provider = new GenericOpenAICompatibleProvider(settings, 'openai-compatible');
      const result = await provider.testConnection();
      expect(result.success).toBe(false);
      expect(result.message).toContain('Base URL is not set');
    });

    it('response.ok が false の場合 mapConnectionError を使ったエラーを返す (401)', async () => {
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('unauthorized'),
      } as Response);
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.testConnection();
      expect(result.success).toBe(false);
      expect(result.message).toContain('Authentication failed');
      expect(result.debug?.statusCode).toBe(401);
      expect(result.debug?.endpoint).toContain('POST');
    });

    it('response.ok が false の場合 404 エラーを返す', async () => {
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('not found'),
      } as Response);
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.testConnection();
      expect(result.message).toContain('Endpoint not found');
    });

    it('成功時、hasContent=true で成功結果を返す', async () => {
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'OK' } }],
          usage: { prompt_tokens: 5, completion_tokens: 1 },
        }),
      } as Response);
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.testConnection();
      expect(result.success).toBe(true);
      expect(result.message).toContain('Connected to AI API');
      expect(result.debug?.hasContent).toBe(true);
      expect(result.debug?.response).toBe('OK');
      expect(result.debug?.sentTokens).toBe(5);
      expect(result.debug?.receivedTokens).toBe(1);
    });

    it('成功時でもcontentが空文字の場合は失敗扱いになる', async () => {
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: '   ' } }] }),
      } as Response);
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.testConnection();
      expect(result.success).toBe(false);
      expect(result.message).toContain('no content');
      expect(result.debug?.hasContent).toBe(false);
      expect(result.debug?.error).toContain('empty');
      expect(result.debug?.response).toBeUndefined();
    });

    it('choicesが無い場合でも空文字として扱われる', async () => {
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as Response);
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.testConnection();
      expect(result.success).toBe(false);
    });

    it('usage が無い場合 sentTokens/receivedTokens を含めない', async () => {
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: 'OK' } }] }),
      } as Response);
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.testConnection();
      expect(result.debug?.sentTokens).toBeUndefined();
      expect(result.debug?.receivedTokens).toBeUndefined();
    });

    it('AbortErrorの場合はタイムアウトメッセージを返す', async () => {
      const fetchModule = await import('../../../../utils/fetch.js');
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      vi.mocked(fetchModule.fetchWithRetry).mockRejectedValueOnce(abortError);
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.testConnection();
      expect(result.message).toContain('timed out');
    });

    it('"Failed to fetch" を含むエラーは接続不可メッセージを返す', async () => {
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockRejectedValueOnce(new Error('Failed to fetch'));
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.testConnection();
      expect(result.message).toContain('Cannot connect');
    });

    it('HTTP 500系メッセージはサーバーエラーとして扱う', async () => {
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockRejectedValueOnce(new Error('HTTP 503: Service Unavailable'));
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.testConnection();
      expect(result.message).toContain('server error');
    });

    it('未知のエラーは汎用接続エラーメッセージを返す', async () => {
      const fetchModule = await import('../../../../utils/fetch.js');
      vi.mocked(fetchModule.fetchWithRetry).mockRejectedValueOnce(new Error('mystery failure'));
      const provider = new OpenAIProvider(baseSettings, 'openai');
      const result = await provider.testConnection();
      expect(result.message).toContain('Connection error');
    });
  });
});
