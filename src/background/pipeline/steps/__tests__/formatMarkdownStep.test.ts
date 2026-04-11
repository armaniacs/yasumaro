/**
 * formatMarkdownStep のテスト
 *
 * 検証対象:
 * - sanitizedSummary が優先される
 * - privacyResult.summary がフォールバックとして使われる
 * - 両方ない場合は 'Summary not available.' が使われる
 * - sanitizeForObsidian で title と summary がサニタイズされる
 * - markdown 形式が正しい（タイムスタンプ + リンク + AI要約）
 */

import { jest } from '@jest/globals';

jest.mock('../../../../utils/localeUtils.js', () => ({
  getUserLocale: jest.fn().mockReturnValue('en-US'),
}));
jest.mock('../../../../utils/markdownSanitizer.js', () => ({
  sanitizeForObsidian: jest.fn((text: string) => text),
}));

import { formatMarkdownStep } from '../formatMarkdownStep.js';
import { sanitizeForObsidian } from '../../../../utils/markdownSanitizer.js';
import type { RecordingContext } from '../../types.js';

const mockSanitize = sanitizeForObsidian as jest.MockedFunction<typeof sanitizeForObsidian>;

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
  return {
    data: {
      title: 'Test Page',
      url: 'https://example.com/page',
      content: 'Some content',
    },
    settings: {} as any,
    force: false,
    errors: [],
    privacyResult: {
      summary: 'AI generated summary',
      maskedCount: 0,
    } as any,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSanitize.mockImplementation((text: string) => text);
});

describe('formatMarkdownStep', () => {
  describe('summary の優先順位', () => {
    it('extractedSentences (L0) が最優先で使われる', async () => {
      const context = makeContext({
        extractedSentences: ['L0 extracted sentence 1', 'L0 extracted sentence 2'],
        sanitizedSummary: 'AI summary from privacy pipeline',
        privacyResult: { summary: 'AI summary', maskedCount: 0 } as any,
      });

      const result = await formatMarkdownStep(context);

      // L0 extracted sentences should be used
      expect(result.markdown).toContain('L0 extracted sentence 1');
      expect(result.markdown).toContain('L0 extracted sentence 2');
      // AI summary should NOT be used
      expect(result.markdown).not.toContain('AI summary from privacy pipeline');
    });

    it('extractedSentences がない場合 sanitizedSummary が使われる', async () => {
      const context = makeContext({
        extractedSentences: undefined,
        sanitizedSummary: 'Prioritized summary',
        privacyResult: { summary: 'AI summary', maskedCount: 0 } as any,
      });

      const result = await formatMarkdownStep(context);

      expect(result.markdown).toContain('Prioritized summary');
      expect(mockSanitize).toHaveBeenCalledWith('Prioritized summary');
    });

    it('sanitizedSummary が最優先で使われる', async () => {
      const context = makeContext({
        sanitizedSummary: 'Prioritized summary',
        privacyResult: { summary: 'AI summary', maskedCount: 0 } as any,
      });

      const result = await formatMarkdownStep(context);

      expect(result.markdown).toContain('Prioritized summary');
      expect(mockSanitize).toHaveBeenCalledWith('Prioritized summary');
    });

    it('sanitizedSummary がない場合 privacyResult.summary が使われる', async () => {
      const context = makeContext({
        sanitizedSummary: undefined,
        privacyResult: { summary: 'AI summary', maskedCount: 0 } as any,
      });

      const result = await formatMarkdownStep(context);

      expect(result.markdown).toContain('AI summary');
      expect(mockSanitize).toHaveBeenCalledWith('AI summary');
    });

    it('両方ない場合 "Summary not available." が使われる', async () => {
      const context = makeContext({
        sanitizedSummary: undefined,
        privacyResult: undefined,
      });

      const result = await formatMarkdownStep(context);

      expect(result.markdown).toContain('Summary not available.');
    });
  });

  describe('sanitizeForObsidian 呼び出し', () => {
    it('title と summary の両方がサニタイズされる', async () => {
      mockSanitize.mockImplementation((text: string) => `[SANITIZED]${text}`);

      const context = makeContext({
        data: { title: 'Page [Title](link)', url: 'https://example.com', content: '' },
        sanitizedSummary: 'Summary [link](http://evil.com)',
      });

      await formatMarkdownStep(context);

      expect(mockSanitize).toHaveBeenCalledWith('Page [Title](link)');
      expect(mockSanitize).toHaveBeenCalledWith('Summary [link](http://evil.com)');
    });
  });

  describe('markdown 形式', () => {
    it('正しい markdown 形式で出力される（タグなし）', async () => {
      const context = makeContext({
        data: { title: 'My Page', url: 'https://example.com/page', content: '' },
        sanitizedSummary: 'Summary text',
      });

      const result = await formatMarkdownStep(context);

      // タイムスタンプ形式: - HH:MM [Title](url) or - HH:MM AM/PM [Title](url)
      expect(result.markdown).toMatch(/^- \d{1,2}:\d{2}\s*(AM|PM)?\s*\[My Page\]\(https:\/\/example\.com\/page\)/);
      // AI要約: プレフィックスなし
      expect(result.markdown).not.toContain('AI要約:');
      expect(result.markdown).toContain('Summary text');
    });

    it('タグがある場合、タグプレフィックス付きで出力される', async () => {
      const context = makeContext({
        data: { title: 'My Page', url: 'https://example.com/page', content: '' },
        sanitizedSummary: 'Summary text',
        privacyResult: {
          summary: 'Summary text',
          maskedCount: 0,
          tags: ['IT・プログラミング', 'インフラ・ネットワーク'],
        } as any,
      });

      const result = await formatMarkdownStep(context);

      expect(result.markdown).toContain('#IT・プログラミング #インフラ・ネットワーク Summary text');
      expect(result.markdown).not.toContain('AI要約:');
    });

    it('url がそのまま含まれる', async () => {
      const context = makeContext({
        data: { title: 'Test', url: 'https://long-domain.example.com/path?q=1#section', content: '' },
      });

      const result = await formatMarkdownStep(context);

      expect(result.markdown).toContain('https://long-domain.example.com/path?q=1#section');
    });
  });

  describe('sanitizedSummary 更新', () => {
    it('sanitizedSummary がサニタイズ後の値で更新される', async () => {
      mockSanitize.mockImplementation((text: string) => `escaped_${text}`);

      const context = makeContext({
        sanitizedSummary: 'Original summary',
      });

      const result = await formatMarkdownStep(context);

      expect(result.sanitizedSummary).toBe('escaped_Original summary');
    });
  });
});
