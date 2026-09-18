/**
 * aiExtract-twins-parity.test.ts
 * PBI 2026-09-18-09: pins byte-identical invalid-schema messages and
 * test-debug base shapes of Gemini/OpenAI extract paths before consolidation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiProvider } from '../GeminiProvider.js';
import { GenericOpenAICompatibleProvider } from '../OpenAIProvider.js';
import type { Settings } from '../../../../utils/storage/types.js';
import type { AISummaryResult } from '../ProviderStrategy.js';

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
vi.mock('../../../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { WARN: 'warn', ERROR: 'error', INFO: 'info', DEBUG: 'debug' },
}));
vi.mock('../../../../utils/fetch.js', () => ({
  fetchWithRetry: vi.fn(),
  validateUrlForAIRequests: vi.fn(),
}));
vi.mock('../../../../utils/storage/urlWhitelist.js', () => ({
  getAllowedUrls: vi.fn(async () => new Set<string>()),
}));
vi.mock('../../../../utils/readBodyCapped.js', () => ({
  readJsonCapped: vi.fn(),
}));

const geminiSettings = { gemini_api_key: 'k', gemini_model: 'm' } as unknown as Settings;
const openaiSettings = {
  openai_base_url: 'https://api.openai.com/v1',
  openai_api_key: 'k',
  openai_model: 'm',
} as unknown as Settings;

type Extractor = { _extractSummary: (data: unknown, traceId: string) => Promise<AISummaryResult> };
const extractOf = (p: object): Extractor => p as unknown as Extractor;

describe('ai extract twins parity (PBI 09)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects invalid schemas with identical user messages', async () => {
    const gemini = extractOf(new GeminiProvider(geminiSettings));
    const openai = extractOf(new GenericOpenAICompatibleProvider(openaiSettings, 'openai'));
    const g1 = await gemini._extractSummary({}, 't');
    const g2 = await gemini._extractSummary({ candidates: [{}] }, 't');
    const o1 = await openai._extractSummary({}, 't');
    const o2 = await openai._extractSummary({ choices: [{}] }, 't');
    for (const r of [g1, g2, o1, o2]) {
      expect(r.success).toBe(false);
      expect(r.summary).toBe('Error: Invalid API response format - unexpected schema.');
      expect(typeof r.error).toBe('string');
    }
    expect(g1.error).toBe('Gemini schema validation failed: candidates is missing or empty');
    expect(g2.error).toBe('Gemini schema validation failed: candidates[0].content is missing');
    expect(o1.error).toBe('OpenAI schema validation failed: choices is missing or empty');
    expect(o2.error).toBe('OpenAI schema validation failed: choices[0].message is missing');
  });

  it('shares the test-debug base field set on empty responses', async () => {
    const { fetchWithRetry } = await import('../../../../utils/fetch.js');
    const { readJsonCapped } = await import('../../../../utils/readBodyCapped.js');
    vi.mocked(fetchWithRetry).mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.mocked(readJsonCapped)
      .mockResolvedValueOnce({ candidates: [{ content: { parts: [] } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: '' } }] });
    const g = await new GeminiProvider(geminiSettings).testConnection();
    const o = await new GenericOpenAICompatibleProvider(openaiSettings, 'openai').testConnection();
    expect(g.success).toBe(false);
    expect(o.success).toBe(false);
    for (const d of [g.debug, o.debug]) {
      expect(d).toMatchObject({ hasContent: false });
      for (const key of ['prompt', 'endpoint', 'statusCode', 'hasContent', 'modelName', 'error'] as const) {
        expect(d).toHaveProperty(key);
      }
      expect(d).not.toHaveProperty('response');
    }
  });
});
