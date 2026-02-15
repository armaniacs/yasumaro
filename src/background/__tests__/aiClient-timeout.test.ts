// fetchWithTimeoutをモック
jest.mock('../../utils/fetch.ts', () => ({
  fetchWithTimeout: jest.fn(),
}));

import { AIClient } from '../aiClient.ts';
import * as logger from '../../utils/logger.ts';
import { fetchWithTimeout } from '../../utils/fetch.ts';

jest.mock('../../utils/logger.ts');

describe('AIClient timeout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('generateGeminiSummary：fetchWithTimeoutに適切なタイムアウトを渡す', async () => {
    fetchWithTimeout.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ text: 'テスト要約' }]
          }
        }]
      })
    });

    const aiClient = new AIClient();
    const result = await aiClient.generateGeminiSummary('test content', 'test-key', 'gemini-1.5-flash');

    expect(result).toBe('テスト要約');
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);

    // 第3引数が30000であることを確認
    const callArgs = fetchWithTimeout.mock.calls[0];
    expect(callArgs[2]).toBe(30000);
    expect(callArgs[1].method).toBe('POST');
  });

  test('generateGeminiSummary：タイムアウトエラーを適切に処理', async () => {
    fetchWithTimeout.mockRejectedValue(new Error('Request timed out after 30000ms'));

    const aiClient = new AIClient();
    const result = await aiClient.generateGeminiSummary('test content', 'test-key', 'gemini-1.5-flash');

    expect(result).toMatch(/timed out/);
    expect(logger.addLog).toHaveBeenCalledWith(
      logger.LogType.ERROR,
      expect.stringContaining('timed out'),
      expect.any(Object)
    );
  });

  test('generateOpenAISummary：fetchWithTimeoutに適切なタイムアウトを渡す', async () => {
    fetchWithTimeout.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: { content: 'OpenAI要約' }
        }]
      })
    });

    const aiClient = new AIClient();
    const result = await aiClient.generateOpenAISummary('test', 'https://api.openai.com/v1', 'test-key', 'gpt-3.5-turbo');

    expect(result).toBe('OpenAI要約');
    expect(fetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining('/chat/completions'),
      expect.any(Object),
      30000
    );
  });

  test('generateOpenAISummary：タイムアウトエラーを適切に処理', async () => {
    fetchWithTimeout.mockRejectedValue(new Error('Request timed out after 30000ms'));

    const aiClient = new AIClient();
    const result = await aiClient.generateOpenAISummary('test', 'https://api.openai.com/v1', 'test-key', 'gpt-3.5-turbo');

    expect(result).toMatch(/timed out/);
    expect(logger.addLog).toHaveBeenCalledWith(
      logger.LogType.ERROR,
      expect.stringContaining('OpenAI'),
      expect.any(Object)
    );
  });
});