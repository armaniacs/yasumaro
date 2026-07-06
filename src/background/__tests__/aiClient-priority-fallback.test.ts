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
vi.mock('../localAiClient.js');
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
