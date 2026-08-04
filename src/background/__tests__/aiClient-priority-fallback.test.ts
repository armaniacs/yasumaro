import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIClient } from '../aiClient.js';
import * as storage from '../../utils/storage.js';
import * as fetchModule from '../../utils/fetch.js';

const { fetchWithRetry } = vi.mocked(fetchModule);

vi.mock('../../utils/fetch.js', () => ({
  fetchWithRetry: vi.fn(),
  validateUrlForAIRequests: vi.fn(),
}));

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
vi.mock('../../utils/customPromptUtils.js', () => ({
  applyCustomPrompt: vi.fn((settings, provider, content) => ({
    userPrompt: `以下のWebページの内容を、日本語で簡潔に要約してください。1文または2文で、重要なポイントをまとめてください。改行しないこと。\n\nContent:\n${content}`,
    systemPrompt: "You are a helpful assistant that summarizes web pages effectively and concisely in Japanese."
  }))
}));
vi.mock('../../utils/promptSanitizer.js', () => ({
  sanitizePromptContent: vi.fn((content) => ({
    sanitized: content,
    warnings: [],
    dangerLevel: 'low' as const
  }))
}));

describe('AIClient: 優先度フォールバック', () => {
  let aiClient: AIClient;
  const mockGetSettings = storage.getSettings as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    aiClient = new AIClient();
    vi.clearAllMocks();
  });

  it('1位のプロバイダーがエラーを返した場合、2位のプロバイダーで再実行し成功を返す', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
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

    // @ts-expect-error - vi.fn() type narrowing issue
    fetchWithRetry.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'これは十分な長さの要約結果です。' } }] })
    });

    const result = await aiClient.generateSummary('some content to summarize');

    expect(result.success).toBe(true);
    expect(result.summary).toContain('十分な長さの要約結果');
  });

  it('1位の要約が最小長未満の場合、2位のプロバイダーにフォールバックする', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
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
    // @ts-expect-error - vi.fn() type narrowing issue
    fetchWithRetry.mockImplementation(async () => {
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
    // @ts-expect-error - vi.fn() type narrowing issue
    mockGetSettings.mockResolvedValue({
      ai_provider_priority_list: [
        { provider: 'gemini' },
        { provider: 'openai2' }
      ],
      summary_min_length: 10,
      gemini_api_key: '',
      openai_2_api_key: ''
    });

    // fetchWithRetryをモックしてGeminiプロバイダーがエラーを返すようにする
    // GeminiプロバイダーはAPIキーが空の場合、fetchWithRetryを呼ばずにエラーを返す
    // ただし、openai2プロバイダーはAPIキーが空でもfetchWithRetryを呼ぶ可能性がある
    // @ts-expect-error - vi.fn() type narrowing issue
    fetchWithRetry.mockRejectedValue(new Error('API key is missing'));

    const result = await aiClient.generateSummary('some content to summarize');

    expect(result.success).toBe(false);
  });

  it('AI_PROVIDER_PRIORITY_LISTが空配列の場合、旧AI_PROVIDER単一設定にフォールバックする', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
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

describe('AIClient.testConnection: 進捗コールバック', () => {
  let aiClient: AIClient;
  const mockGetSettings = storage.getSettings as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    aiClient = new AIClient();
    vi.clearAllMocks();
  });

  it('優先度リストの各プロバイダー開始時にonProgressが順番に呼ばれる', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
    mockGetSettings.mockResolvedValue({
      ai_provider_priority_list: [
        { provider: 'gemini' },
        { provider: 'openai2', model: 'gpt-4o-mini' }
      ],
      gemini_api_key: '',
      openai_2_api_key: ''
    });
    // @ts-expect-error - vi.fn() type narrowing issue
    fetchWithRetry.mockRejectedValue(new Error('connection failed'));

    const onProgress = vi.fn();
    await aiClient.testConnection(onProgress);

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, { provider: 'gemini', model: undefined, index: 0, total: 2 });
    expect(onProgress).toHaveBeenNthCalledWith(2, { provider: 'openai2', model: 'gpt-4o-mini', index: 1, total: 2 });
  });

  it('onProgressを省略しても従来通り動作する', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
    mockGetSettings.mockResolvedValue({
      ai_provider_priority_list: [{ provider: 'gemini' }],
      gemini_api_key: ''
    });

    const result = await aiClient.testConnection();

    expect(result).toBeDefined();
    expect(typeof result.success).toBe('boolean');
  });
});

describe('AIClient: built-in-ai スロットのディスパッチ', () => {
  let aiClient: AIClient;
  const mockGetSettings = storage.getSettings as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1位が built-in-ai の場合、registerBuiltInAiService で登録した AIService に委譲する', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
    mockGetSettings.mockResolvedValue({
      ai_provider_priority_list: [{ provider: 'built-in-ai' }],
      summary_min_length: 10,
    });

    const builtInAiService = {
      generateSummary: vi.fn().mockResolvedValue({ summary: '端末内で生成された十分な長さの要約です。', success: true }),
      getSupportedModes: vi.fn().mockReturnValue(['local_only']),
    };

    aiClient = new AIClient();
    aiClient.registerBuiltInAiService(builtInAiService);

    const result = await aiClient.generateSummary('some content to summarize');

    expect(builtInAiService.generateSummary).toHaveBeenCalledWith('some content to summarize', { traceId: '' });
    expect(result.success).toBe(true);
    expect(result.summary).toBe('端末内で生成された十分な長さの要約です。');
  });

  it('built-in-ai が失敗した場合、2位の外部プロバイダーへフォールバックする', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
    mockGetSettings.mockResolvedValue({
      ai_provider_priority_list: [
        { provider: 'built-in-ai' },
        { provider: 'openai2' },
      ],
      summary_min_length: 10,
      openai_2_api_key: 'dummy-test-apikey-value',
      openai_2_base_url: 'https://api.openai.com/v1',
      openai_2_model: 'gpt-4o-mini',
    });

    // @ts-expect-error - vi.fn() type narrowing issue
    fetchWithRetry.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'これは十分な長さの要約結果です。' } }] }),
    });

    const builtInAiService = {
      generateSummary: vi.fn().mockRejectedValue(new Error('Built-in AI is currently unavailable')),
      getSupportedModes: vi.fn().mockReturnValue(['local_only']),
    };

    aiClient = new AIClient();
    aiClient.registerBuiltInAiService(builtInAiService);

    const result = await aiClient.generateSummary('some content to summarize');

    expect(result.success).toBe(true);
    expect(result.summary).toContain('十分な長さの要約結果');
  });

  it('built-in-ai が success:false を返した場合（例外なし）、2位へフォールバックする', async () => {
    // This tests the Edge bug scenario where BuiltInAIClient returns success:false
    // without throwing an exception.
    // @ts-expect-error - vi.fn() type narrowing issue
    mockGetSettings.mockResolvedValue({
      ai_provider_priority_list: [
        { provider: 'built-in-ai' },
        { provider: 'openai2' },
      ],
      summary_min_length: 10,
      openai_2_api_key: 'dummy-test-apikey-value',
      openai_2_base_url: 'https://api.openai.com/v1',
      openai_2_model: 'gpt-4o-mini',
    });

    // @ts-expect-error - vi.fn() type narrowing issue
    fetchWithRetry.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'これは十分な長さの要約結果です。' } }] }),
    });

    const builtInAiService = {
      generateSummary: vi.fn().mockResolvedValue({ summary: '', success: false, error: 'Built-in AI is currently downloadable' }),
      getSupportedModes: vi.fn().mockReturnValue(['local_only']),
    };

    aiClient = new AIClient();
    aiClient.registerBuiltInAiService(builtInAiService);

    const result = await aiClient.generateSummary('some content to summarize');

    expect(result.success).toBe(true);
    expect(result.summary).toContain('十分な長さの要約結果');
    expect(builtInAiService.generateSummary).toHaveBeenCalled();
  });

  it('registerBuiltInAiService を呼んでいない場合、built-in-ai スロットは未知プロバイダーとして扱われる', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
    mockGetSettings.mockResolvedValue({
      ai_provider_priority_list: [{ provider: 'built-in-ai' }],
      summary_min_length: 10,
    });

    aiClient = new AIClient();

    const result = await aiClient.generateSummary('some content to summarize');

    expect(result.success).toBe(false);
  });

  it('testConnection: built-in-ai スロットが成功した場合、success として報告する', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
    mockGetSettings.mockResolvedValue({
      ai_provider_priority_list: [{ provider: 'built-in-ai' }],
    });

    const builtInAiService = {
      generateSummary: vi.fn().mockResolvedValue({ summary: 'ok', success: true }),
      getSupportedModes: vi.fn().mockReturnValue(['local_only']),
    };

    aiClient = new AIClient();
    aiClient.registerBuiltInAiService(builtInAiService);

    const result = await aiClient.testConnection();

    expect(result.success).toBe(true);
    expect(result.providers[0]).toMatchObject({ provider: 'built-in-ai', success: true });
    expect(result.providers[0].debug).toBeDefined();
    expect(result.providers[0].debug?.hasContent).toBe(true);
  });

  it('testConnection: built-in-ai が success:false を返した場合（例外なし）、failure として報告する', async () => {
    // This is the Edge bug scenario: BuiltInAIClient returns { success: false, error: '...' }
    // without throwing. The test must detect this as a failure.
    // @ts-expect-error - vi.fn() type narrowing issue
    mockGetSettings.mockResolvedValue({
      ai_provider_priority_list: [{ provider: 'built-in-ai' }],
    });

    const builtInAiService = {
      generateSummary: vi.fn().mockResolvedValue({ summary: '', success: false, error: 'Built-in AI is currently downloadable' }),
      getSupportedModes: vi.fn().mockReturnValue(['local_only']),
    };

    aiClient = new AIClient();
    aiClient.registerBuiltInAiService(builtInAiService);

    const result = await aiClient.testConnection();

    expect(result.success).toBe(false);
    expect(result.providers[0]).toMatchObject({ provider: 'built-in-ai', success: false });
    expect(result.providers[0].message).toContain('downloadable');
    expect(result.providers[0].debug?.hasContent).toBe(false);
  });

  it('testConnection: built-in-ai が空の要約を返した場合、failure として報告する', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
    mockGetSettings.mockResolvedValue({
      ai_provider_priority_list: [{ provider: 'built-in-ai' }],
    });

    const builtInAiService = {
      generateSummary: vi.fn().mockResolvedValue({ summary: '', success: true }),
      getSupportedModes: vi.fn().mockReturnValue(['local_only']),
    };

    aiClient = new AIClient();
    aiClient.registerBuiltInAiService(builtInAiService);

    const result = await aiClient.testConnection();

    expect(result.success).toBe(false);
    expect(result.providers[0].success).toBe(false);
    expect(result.providers[0].debug?.hasContent).toBe(false);
  });

  it('testConnection: built-in-ai が失敗した場合、failure として報告する', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
    mockGetSettings.mockResolvedValue({
      ai_provider_priority_list: [{ provider: 'built-in-ai' }],
    });

    const builtInAiService = {
      generateSummary: vi.fn().mockRejectedValue(new Error('Built-in AI is currently unavailable')),
      getSupportedModes: vi.fn().mockReturnValue(['local_only']),
    };

    aiClient = new AIClient();
    aiClient.registerBuiltInAiService(builtInAiService);

    const result = await aiClient.testConnection();

    expect(result.success).toBe(false);
    expect(result.providers[0]).toMatchObject({ provider: 'built-in-ai', success: false });
    expect(result.providers[0].message).toContain('unavailable');
  });

  it('testConnection: registerBuiltInAiService 未登録の場合、Unknown provider として報告する', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
    mockGetSettings.mockResolvedValue({
      ai_provider_priority_list: [{ provider: 'built-in-ai' }],
    });

    aiClient = new AIClient();

    const result = await aiClient.testConnection();

    expect(result.success).toBe(false);
    expect(result.providers[0].message).toContain('Unknown provider');
  });
});
