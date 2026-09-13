import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiProvider } from '../GeminiProvider.js';
import type { Settings } from '../../../../utils/storage/types.js';

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

  it('returns an error without the provider name when the API key is empty', async () => {
    const provider = new GeminiProvider({ ...baseSettings, gemini_api_key: '' } as Settings);
    const result = await provider.generateSummary('content', false, '');

    expect(result.summary).toContain('Error:');
    expect(result.summary).not.toContain('Gemini');
    expect(result.summary).toContain('API key is missing');
  });

  it('omits the HTTP status code and response details on a 404 error', async () => {
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

  it('omits raw response data on a generic error', async () => {
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

  it('returns an error without allowing path traversal when the model name contains /', async () => {
    const provider = new GeminiProvider({
      ...baseSettings,
      gemini_model: '../../../etc/passwd',
    } as Settings);
    const result = await provider.generateSummary('content', false, '');

    expect(result.summary).toContain('Error:');
    expect(result.summary).toContain('Invalid AI model name');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('encodes special characters in the model name as a URL path segment', async () => {
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

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(calledUrl).toContain('/models/weird%20model%3Av1:generateContent');
  });

  it('omits internal error details on a network error', async () => {
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
