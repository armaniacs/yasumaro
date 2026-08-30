import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObsidianSyncService } from '../obsidianSyncService.js';
import { GistSyncTarget } from '../syncTargets/gistSyncTarget.js';
import { formatEntryToMarkdown } from '../../utils/markdownFormatter.js';
import { formatMarkdownStep } from '../pipeline/steps/formatMarkdownStep.js';
import type { RecordingContext } from '../pipeline/types.js';
import type { BrowsingLogEntry } from '../../utils/sqlite-types.js';

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

  it('ObsidianSyncService: title suffix does not break out', async () => {
    const appended: string[] = [];
    const mockObsidianClient = {
      appendToDailyNote: vi.fn(async (m: string) => { appended.push(m); }),
      testConnection: vi.fn().mockResolvedValue({ success: true }),
    };
    const mockSqliteClient = {
      mutate: vi.fn().mockResolvedValue({ success: true }),
      query: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
      getStatus: vi.fn().mockResolvedValue({ initialized: true }),
    };
    const mockSettingsReader = {
      getMany: vi.fn().mockResolvedValue({ obsidian_api_key: 'test-api-key-1234567' }),
      getAll: vi.fn(),
    };
    const service = new ObsidianSyncService(
      mockObsidianClient as never,
      mockSqliteClient as never,
      mockSettingsReader as never,
    );
    await service.sync(1, 'https://example.com', EVIL_TITLE, 'clean summary');
    expect(appended).toHaveLength(1);
    expect(hasUnescapedEvilLink(appended[0])).toBe(false);
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
    expect(hasUnescapedEvilLink(captured[0])).toBe(false);
  });
});
