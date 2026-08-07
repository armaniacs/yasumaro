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

import { vi } from 'vitest';;

vi.mock('../../../../utils/localeUtils.js', () => ({
  getUserLocale: vi.fn().mockReturnValue('en-US'),
}));
vi.mock('../../../../utils/markdownSanitizer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/markdownSanitizer.js')>();
  return {
    ...actual,
    sanitizeForObsidian: vi.fn((text: string) => text),
    sanitizeUrlForMarkdownTarget: vi.fn((url: string) => url),
    // Spy that calls through to the real implementation so link-breakout
    // escaping is exercised by integration tests while call-sites are assertable.
    sanitizeForMarkdownLinkText: vi.fn((text: string) => actual.sanitizeForMarkdownLinkText(text)),
  };
});

import { formatMarkdownStep } from '../formatMarkdownStep.js';
import { sanitizeForObsidian, sanitizeUrlForMarkdownTarget, sanitizeForMarkdownLinkText } from '../../../../utils/markdownSanitizer.js';
import type { RecordingContext } from '../../types.js';

const mockSanitize = sanitizeForObsidian as vi.MockedFunction<typeof sanitizeForObsidian>;
const mockSanitizeUrl = sanitizeUrlForMarkdownTarget as vi.MockedFunction<typeof sanitizeUrlForMarkdownTarget>;
const mockSanitizeLinkText = sanitizeForMarkdownLinkText as unknown as vi.MockedFunction<typeof sanitizeForMarkdownLinkText>;

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
  vi.clearAllMocks();
  mockSanitize.mockImplementation((text: string) => text);
  mockSanitizeUrl.mockImplementation((url: string) => url);
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
    it('title は sanitizeForMarkdownLinkText、summary は sanitizeForObsidian でサニタイズされる', async () => {
      mockSanitize.mockImplementation((text: string) => `[SANITIZED]${text}`);

      const context = makeContext({
        data: { title: 'Page [Title](link)', url: 'https://example.com', content: '' },
        sanitizedSummary: 'Summary [link](http://evil.com)',
      });

      await formatMarkdownStep(context);

      // Title now goes through the link-text sanitizer (VULN-001).
      expect(mockSanitizeLinkText).toHaveBeenCalledWith('Page [Title](link)');
      // Summary still goes through sanitizeForObsidian.
      expect(mockSanitize).toHaveBeenCalledWith('Summary [link](http://evil.com)');
    });
  });

  describe('VULN-001 title link-closure regression', () => {
    it('a title suffix `](url)` must not close the [title](url) wrapper', async () => {
      const context = makeContext({
        data: { title: 'foo](https://evil.example)', url: 'https://example.com/page', content: '' },
        sanitizedSummary: 'Summary text',
      });

      const result = await formatMarkdownStep(context);

      // The attacker-chosen destination must not appear as a live link target.
      expect(result.markdown).not.toContain('](https://evil.example)');
      // The legitimate page URL is still present as the link target.
      expect(result.markdown).toContain('](https://example.com/page)');
    });

    it('title is passed through sanitizeForMarkdownLinkText before wrapping', async () => {
      const context = makeContext({
        data: { title: 'foo](https://evil.example)', url: 'https://example.com/page', content: '' },
      });
      await formatMarkdownStep(context);
      expect(mockSanitizeLinkText).toHaveBeenCalledWith('foo](https://evil.example)');
    });
  });

  describe('VULN-008 AI-tag injection regression', () => {
    it('tags are sanitized before interpolation (wikilink / link injection blocked)', async () => {
      const context = makeContext({
        data: { title: 'My Page', url: 'https://example.com/page', content: '' },
        sanitizedSummary: 'Summary text',
        privacyResult: {
          summary: 'Summary text',
          maskedCount: 0,
          tags: ['[[evil]]', 'x](https://evil.example)'],
        } as any,
      });

      await formatMarkdownStep(context);

      // Each tag must be passed through sanitizeForObsidian.
      expect(mockSanitize).toHaveBeenCalledWith('[[evil]]');
      expect(mockSanitize).toHaveBeenCalledWith('x](https://evil.example)');
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

  describe('URL sanitization (VULN-001/004)', () => {
    it('url が sanitizeUrlForMarkdownTarget を通って埋め込まれる', async () => {
      mockSanitizeUrl.mockImplementation((url: string) => url.replace(/\)/g, '%29'));

      const context = makeContext({
        data: { title: 'Test', url: 'https://evil.tld/x)![beacon](https://evil.tld/exfil', content: '' },
      });

      const result = await formatMarkdownStep(context);

      expect(mockSanitizeUrl).toHaveBeenCalledWith('https://evil.tld/x)![beacon](https://evil.tld/exfil');
      // The markdown should not contain unescaped ) that could break the link syntax
      expect(result.markdown).toContain('%29');
    });

    it('sanitizeUrlForMarkdownTarget is called with the URL from data', async () => {
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com/page', content: '' },
      });

      await formatMarkdownStep(context);

      expect(mockSanitizeUrl).toHaveBeenCalledWith('https://example.com/page');
    });
  });

  describe('markdownEntryData', () => {
    it('context.markdownEntryData に生データをセットする', async () => {
      const context = makeContext({
        data: { title: 'Example Page', url: 'https://example.com/page', content: '' },
        sanitizedSummary: undefined,
        privacyResult: { summary: 'A summary.', maskedCount: 0, tags: ['tech', 'news'] } as any,
      });

      const result = await formatMarkdownStep(context);

      expect(result.markdownEntryData).toBeDefined();
      expect(result.markdownEntryData?.title).toBe('Example Page');
      expect(result.markdownEntryData?.url).toBe('https://example.com/page');
      expect(result.markdownEntryData?.summary).toBe('A summary.');
      // Fix 3: tags keeps its trailing space (tagPrefix is used as-is, not .trim()ed),
      // so the entryTemplate's `{{tags}}{{summary}}` produces exactly one separating space.
      expect(result.markdownEntryData?.tags).toBe('#tech #news ');
      expect(result.markdownEntryData?.domain).toBe('example.com');
      expect(typeof result.markdownEntryData?.timestamp).toBe('string');
    });

    it('既存の context.markdown 出力は変更されない(Obsidian用フォーマットの後方互換性)', async () => {
      const context = makeContext({
        data: { title: 'Example Page', url: 'https://example.com/page', content: '' },
        sanitizedSummary: undefined,
        privacyResult: { summary: 'A summary.', maskedCount: 0, tags: [] } as any,
      });

      const result = await formatMarkdownStep(context);

      expect(result.markdown).toMatch(/^- \d{1,2}:\d{2}\s*(AM|PM)?\s*\[Example Page\]\(https:\/\/example\.com\/page\)\n {4}- A summary\.$/);
    });

    it('URL が不正な場合 domain は空文字にフォールバックする', async () => {
      const context = makeContext({
        data: { title: 'Bad URL', url: 'not-a-valid-url', content: '' },
        sanitizedSummary: 'Summary text',
      });

      const result = await formatMarkdownStep(context);

      expect(result.markdownEntryData?.domain).toBe('');
    });
  });
});
