import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GistSyncTarget } from '../syncTargets/gistSyncTarget.js';
import { formatEntryToMarkdown, formatEntriesToMarkdown } from '../../utils/markdownFormatter.js';
import { toMarkdownTemplateEntryData } from '../../dashboard/markdownExport.js';
import { formatMarkdownStep } from '../pipeline/steps/formatMarkdownStep.js';
import type { RecordingContext } from '../pipeline/types.js';
import type { BrowsingLogEntry } from '../../utils/sqlite-types.js';

vi.mock('../../utils/localeUtils.js', () => ({
  getUserLocale: vi.fn().mockReturnValue('ja-JP'),
}));

const EVIL = 'https://evil.example';

/**
 * A "balanced markdown link" to the attacker destination is `](EVIL)` preceded
 * somewhere by an unescaped `[`. If every breakout `[` `]` `(` `)` is escaped
 * with a backslash, no such link can render.
 */
function hasUnescapedEvilLink(md: string): boolean {
  const idx = md.indexOf(`](${EVIL})`);
  if (idx === -1) return false;
  // the `]` at idx must be unescaped (not preceded by backslash)
  return md[idx - 1] !== '\\';
}

describe('markdown join safety - tag fragments cannot reassemble a link', () => {
  it('formatMarkdownStep: tag fragments "foo [" + "bar](EVIL)" do not form a link', async () => {
    const ctx: Partial<RecordingContext> = {
      data: { url: 'https://example.com', title: 'Example' },
      sanitizedSummary: 'clean summary',
      privacyResult: { summary: 'clean summary', tags: ['foo [', `bar](${EVIL})`] },
    } as unknown as RecordingContext;

    const result = await formatMarkdownStep(ctx as RecordingContext);
    const md = result.markdown as string;
    expect(hasUnescapedEvilLink(md)).toBe(false);
  });

  it('markdownFormatter legacy formatEntryToMarkdown: tag fragments do not form a link', () => {
    const entry = {
      url: 'https://example.com',
      title: 'Example',
      summary: 'clean',
      tags: `foo [,bar](${EVIL})`,
      created_at: Date.now(),
    } as unknown as BrowsingLogEntry;
    const md = formatEntryToMarkdown(entry);
    expect(hasUnescapedEvilLink(md)).toBe(false);
  });
});

describe('markdown join safety - title `](url)` suffix cannot break out', () => {
  const EVIL_TITLE = `Doc](${EVIL})`;

  it('markdownFormatter legacy: title suffix does not break out', () => {
    const entry = {
      url: 'https://example.com',
      title: EVIL_TITLE,
      summary: 'clean',
      tags: '',
      created_at: Date.now(),
    } as unknown as BrowsingLogEntry;
    const md = formatEntryToMarkdown(entry);
    expect(hasUnescapedEvilLink(md)).toBe(false);
  });

  it('GistSyncTarget: title suffix does not break out', async () => {
    const captured: string[] = [];
    const createSpy = vi
      .spyOn(GistSyncTarget.prototype as unknown as { createGist: (c: string, p: string) => Promise<string> }, 'createGist')
      .mockImplementation(async (content: string) => { captured.push(content); return 'gist-id'; });

    const mockSqliteClient = { mutate: vi.fn().mockResolvedValue({ success: true }) };
    const mockSettingsReader = {
      getMany: vi.fn().mockResolvedValue({ github_pat: 'x' }),
      getAll: vi.fn().mockResolvedValue({ github_pat: 'x' }),
    };
    // SettingsRepository is constructed internally for getAll/set; stub globally.
    const { SettingsRepository } = await import('../../utils/storage/SettingsRepository.js');
    vi.spyOn(SettingsRepository.prototype, 'getAll').mockResolvedValue({ github_pat: 'x' } as never);
    vi.spyOn(SettingsRepository.prototype, 'set').mockResolvedValue(undefined as never);

    const target = new GistSyncTarget(mockSqliteClient as never, mockSettingsReader as never);
    await target.sync(1, 'https://example.com', EVIL_TITLE, 'clean summary');
    createSpy.mockRestore();
    expect(captured).toHaveLength(1);
    expect(captured[0]).toBeDefined();
    expect(hasUnescapedEvilLink(captured[0]!)).toBe(false);
  });
});

/**
 * Parity pins for PBI-04 (entry -> Markdown SSOT).
 * WHY: each golden below records the CURRENT output byte-for-byte, so the
 * delegation refactor can prove zero behavior change by keeping this file
 * unmodified and green. Timestamps use the same Intl calls as production
 * (TZ-independent); every sanitized fragment is a fixed literal.
 */
describe('markdown entry parity - golden pins (PBI-04 SSOT)', () => {
  const FIXED_NOW = new Date('2026-03-15T09:30:00.000Z').getTime();
  const FIXED_CREATED = new Date('2026-03-10T12:34:56').getTime();
  const tsFor = (t: number): string =>
    new Date(t).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formatEntriesToMarkdown: obsidianList line without tags', () => {
    const entry = {
      url: 'https://example.com/article',
      title: 'Example Article',
      summary: 'Line1\n\nLine2  with   spaces',
      created_at: FIXED_CREATED,
    } as unknown as BrowsingLogEntry;
    expect(formatEntriesToMarkdown([entry])).toBe(
      `- ${tsFor(FIXED_NOW)} [Example Article](https://example.com/article)\n    - Line1 Line2 with spaces`,
    );
  });

  it('formatEntryToMarkdown: heading style with tags', () => {
    const entry = {
      url: 'https://example.com/article',
      title: 'Example Article',
      summary: 'This is a summary.',
      tags: 'tech,ai',
      created_at: FIXED_CREATED,
    } as unknown as BrowsingLogEntry;
    const dateStr = new Date(FIXED_CREATED).toLocaleString();
    expect(formatEntryToMarkdown(entry)).toBe(
      `# Example Article\n- URL: https://example.com/article\n- Date: ${dateStr}\n- Tags: #tech #ai\n## Summary\nThis is a summary.`,
    );
  });

  it('toMarkdownTemplateEntryData: template entry data with tags', () => {
    expect(
      toMarkdownTemplateEntryData({
        url: 'https://example.com/a',
        title: 'T',
        summary: 'line1\n\nline2',
        tags: 'ai, dev',
        created_at: FIXED_CREATED,
      }),
    ).toEqual({
      timestamp: tsFor(FIXED_CREATED),
      title: 'T',
      url: 'https://example.com/a',
      summary: 'line1 line2',
      tags: '#ai #dev ',
      domain: 'example.com',
    });
  });

  it('formatMarkdownStep: obsidianList line with tag prefix and entry data', async () => {
    const ctx = {
      data: { url: 'https://example.com/page', title: 'My Page' },
      sanitizedSummary: 'Summary text',
      privacyResult: { summary: 'Summary text', maskedCount: 0, tags: ['tech', 'news'] },
    } as unknown as RecordingContext;
    const result = await formatMarkdownStep(ctx);
    const ts = tsFor(FIXED_NOW);
    expect(result.markdown).toBe(
      `- ${ts} [My Page](https://example.com/page)\n    - #tech #news Summary text`,
    );
    expect(result.markdownEntryData).toEqual({
      timestamp: ts,
      title: 'My Page',
      url: 'https://example.com/page',
      summary: 'Summary text',
      tags: '#tech #news ',
      domain: 'example.com',
    });
  });

  it('GistSyncTarget defaultEntry: plain line with and without summary', async () => {
    const captured: string[] = [];
    const createSpy = vi
      .spyOn(GistSyncTarget.prototype as unknown as { createGist: (c: string, p: string) => Promise<string> }, 'createGist')
      .mockImplementation(async (content: string) => { captured.push(content); return 'gist-id'; });
    const mockSqliteClient = { mutate: vi.fn().mockResolvedValue({ success: true }) };
    const mockSettingsReader = {
      getMany: vi.fn().mockResolvedValue({ github_pat: 'x' }),
      getAll: vi.fn().mockResolvedValue({ github_pat: 'x' }),
    };
    const { SettingsRepository } = await import('../../utils/storage/SettingsRepository.js');
    vi.spyOn(SettingsRepository.prototype, 'getAll').mockResolvedValue({ github_pat: 'x' } as never);
    vi.spyOn(SettingsRepository.prototype, 'set').mockResolvedValue(undefined as never);

    const target = new GistSyncTarget(mockSqliteClient as never, mockSettingsReader as never);
    await target.sync(1, 'https://example.com', 'Example', 'clean summary');
    await target.sync(2, 'https://example.com', 'Example', null);
    createSpy.mockRestore();
    expect(captured).toEqual([
      '- [Example](https://example.com): clean summary',
      '- [Example](https://example.com)',
    ]);
  });

  it('obsidianList boundary: breakout tag is neutralized after the # prefix', async () => {
    const ctx = {
      data: { url: 'https://example.com', title: 'Example' },
      sanitizedSummary: 'clean summary',
      privacyResult: { summary: 'clean summary', maskedCount: 0, tags: ['x](https://evil.example)'] },
    } as unknown as RecordingContext;
    const md = (await formatMarkdownStep(ctx)).markdown as string;
    expect(md).toContain('#x\\]\\(https://evil.example\\) ');
    expect(hasUnescapedEvilLink(md)).toBe(false);
  });
});
