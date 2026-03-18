// fetchWithRetryをモック
jest.mock('../../utils/fetch.js', () => ({
  fetchWithRetry: jest.fn(),
  validateUrlForAIRequests: jest.fn(),
}));

import { GeminiProvider, OpenAIProvider } from '../ai/providers/index.js';
import * as logger from '../../utils/logger.js';
import { fetchWithRetry } from '../../utils/fetch.js';
import { StorageKeys } from '../../utils/storage.js';

jest.mock('../../utils/logger.js');
jest.mock('../../utils/customPromptUtils.js', () => ({
  applyCustomPrompt: jest.fn((settings, provider, content) => ({
    userPrompt: `以下のWebページの内容を、日本語で簡潔に要約してください。1文または2文で、重要なポイントをまとめてください。改行しないこと。\n\nContent:\n${content}`,
    systemPrompt: "You are a helpful assistant that summarizes web pages effectively and concisely in Japanese."
  }))
}));
jest.mock('../../utils/promptSanitizer.js', () => ({
  sanitizePromptContent: jest.fn((content) => ({
    sanitized: content,
    warnings: [],
    dangerLevel: 'low' as const
  }))
}));

describe('AI Provider timeout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GeminiProvider：fetchWithRetryに適切なタイムアウトを渡す', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue

    fetchWithRetry.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ text: 'テスト要約' }]
          }
        }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50
        }
      })
    });

    const settings: any = {
      [StorageKeys.GEMINI_API_KEY]: 'test-key',
      [StorageKeys.GEMINI_MODEL]: 'gemini-1.5-flash'
    };
    const provider = new GeminiProvider(settings);
    const result = await provider.generateSummary('test content');

    expect(result.summary).toBe('テスト要約');
    expect(result.sentTokens).toBe(100);
    expect(result.receivedTokens).toBe(50);
    expect(fetchWithRetry).toHaveBeenCalledTimes(1);

    // 第2引数のoptionsにtimeoutMsが含まれていることを確認
    // @ts-expect-error - jest.fn() type narrowing issue

    const callArgs = fetchWithRetry.mock.calls[0];
    expect(callArgs[1].timeoutMs).toBe(30000);
    expect(callArgs[1].method).toBe('POST');
  });

  test('GeminiProvider：タイムアウトエラーを適切に処理', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue

    fetchWithRetry.mockRejectedValue(new Error('Request timed out after 30000ms'));

    const settings: any = {
      [StorageKeys.GEMINI_API_KEY]: 'test-key',
      [StorageKeys.GEMINI_MODEL]: 'gemini-1.5-flash'
    };
    const provider = new GeminiProvider(settings);
    const result = await provider.generateSummary('test content');

    expect(result.summary).toMatch(/timed out/);
  });

  test('OpenAIProvider：fetchWithRetryに適切なタイムアウトを渡す', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue

    fetchWithRetry.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: { content: 'OpenAI要約' }
        }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50
        }
      })
    });

    const settings: any = {
      [StorageKeys.OPENAI_BASE_URL]: 'https://api.openai.com/v1',
      [StorageKeys.OPENAI_API_KEY]: 'test-key',
      [StorageKeys.OPENAI_MODEL]: 'gpt-3.5-turbo'
    };
    const provider = new OpenAIProvider(settings, 'openai');
    const result = await provider.generateSummary('test');

    expect(result.summary).toBe('OpenAI要約');
    expect(result.sentTokens).toBe(100);
    expect(result.receivedTokens).toBe(50);
    expect(fetchWithRetry).toHaveBeenCalledWith(
      expect.stringContaining('/chat/completions'),
      expect.objectContaining({
        timeoutMs: 30000
      }),
      expect.any(Object)
    );
  });

  test('OpenAIProvider：タイムアウトエラーを適切に処理', async () => {
    // @ts-expect-error - jest.fn() type narrowing issue

    fetchWithRetry.mockRejectedValue(new Error('Request timed out after 30000ms'));

    const settings: any = {
      [StorageKeys.OPENAI_BASE_URL]: 'https://api.openai.com/v1',
      [StorageKeys.OPENAI_API_KEY]: 'test-key',
      [StorageKeys.OPENAI_MODEL]: 'gpt-3.5-turbo'
    };
    const provider = new OpenAIProvider(settings, 'openai');
    const result = await provider.generateSummary('test');

    expect(result.summary).toMatch(/timed out/);
  });
});