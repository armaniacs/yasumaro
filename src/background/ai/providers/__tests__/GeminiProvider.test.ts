import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiProvider } from '../GeminiProvider.js';
import type { Settings } from '../../../../utils/storage.js';

vi.mock('../../../../utils/aiUsageTracker.js', () => ({
  checkHardLimit: vi.fn(async () => ({ blocked: false })),
  checkUsageWarning: vi.fn(async () => ({ warning: false })),
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetTime: Date.now() + 60000 })),
  getRateLimitMessage: vi.fn(() => 'Rate limit exceeded'),
}));
vi.mock('../../../../utils/promptSanitizer.js', () => ({
  sanitizePromptContent: vi.fn((content: string) => ({ sanitized: content, warnings: [], dangerLevel: 'low' })),
}));

describe('GeminiProvider: エラーハンドリング', () => {
  const baseSettings = {
    gemini_api_key: 'test_key',
    gemini_model: 'gemini-3.1-flash-lite',
  } as unknown as Settings;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRestore();
  });

  it('APIキーが空の場合、プロバイダー名を含まないエラーを返す', async () => {
    const provider = new GeminiProvider({ ...baseSettings, gemini_api_key: '' } as Settings);
    const result = await provider.generateSummary('content', false, '');

    expect(result.summary).toContain('Error:');
    expect(result.summary).not.toContain('Gemini');
    expect(result.summary).toContain('API key is missing');
  });

  it('404エラー時、HTTPステータスコードやレスポンス詳細を含まない', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not found'),
      json: () => Promise.resolve({}),
    });

    const provider = new GeminiProvider(baseSettings);
    const result = await provider.generateSummary('content', false, '');

    expect(result.summary).toContain('Error:');
    expect(result.summary).not.toContain('404');
    expect(result.summary).not.toContain('Not found');
  });

  it('一般エラー時、レスポンスの生データを含まない', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Detailed error message from API: Invalid request'),
    });

    const provider = new GeminiProvider(baseSettings);
    const result = await provider.generateSummary('content', false, '');

    expect(result.summary).toContain('Error:');
    expect(result.summary).not.toContain('400');
    expect(result.summary).not.toContain('Detailed error message');
    expect(result.summary).not.toContain('Invalid request');
  });

  it('model 名に / を含む場合、パストラバーサルを許さずエラーを返す', async () => {
    const provider = new GeminiProvider({
      ...baseSettings,
      gemini_model: '../../../etc/passwd',
    } as Settings);
    const result = await provider.generateSummary('content', false, '');

    expect(result.summary).toContain('Error:');
    expect(result.summary).toContain('Invalid AI model name');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('model 名の特殊文字は URL パスセグメントとしてエンコードされる', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    });

    const provider = new GeminiProvider({
      ...baseSettings,
      gemini_model: 'weird model:v1',
    } as Settings);
    await provider.generateSummary('content', false, '');

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/models/weird%20model%3Av1:generateContent');
  });

  it('ネットワークエラー時、内部エラー詳細を含まない', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Failed to fetch: Network request failed'),
    );

    const provider = new GeminiProvider(baseSettings);
    const result = await provider.generateSummary('content', false, '');

    expect(result.summary).toContain('Error:');
    expect(result.summary).toContain('try again');
    expect(result.summary).not.toContain('Failed to fetch');
    expect(result.summary).not.toContain('Network request');
  });
});
