/**
 * markdownTagNewline.test.ts
 * Adversary tests for the export/pipeline tag chain (Red-Team finding on
 * 0917a): an AI-supplied tag containing a newline must not split the `#tags`
 * line and inject Markdown rows. Tags are forced single-line in the SSOT.
 */
import { describe, it, expect } from 'vitest';
import { buildEntryMarkdown, buildTemplateEntryData } from '../markdownFormatter.js';

describe('tag newline injection (SSOT single-line enforcement)', () => {
  it('export chain (obsidian-only) keeps an adversarial tag on one line', () => {
    const data = buildTemplateEntryData(
      {
        title: 'T',
        url: 'https://example.com',
        summary: 's',
        tags: 'ok\n[evil](https://evil.example)',
        createdAt: Date.now(),
      },
      { tagChain: 'obsidian' },
    );

    expect(data.tags).not.toContain('\n');
    expect(data.tags).not.toContain('\r');
    // The injected link must not survive as a live Markdown link.
    expect(data.tags).not.toContain('[evil](https://evil.example)');
  });

  it('export chain strips CRLF injection vectors', () => {
    const data = buildTemplateEntryData(
      {
        title: 'T',
        url: 'https://example.com',
        summary: 's',
        tags: 'x](https://evil.example)\r\n# injected heading',
        createdAt: Date.now(),
      },
      { tagChain: 'obsidian' },
    );

    // Single line: the injected heading cannot break out onto its own row.
    // A bare `](u)` suffix without `[` cannot form a live Markdown link, and
    // complete `[t](u)` links are escaped by sanitizeForObsidian (see above).
    expect(data.tags).not.toMatch(/[\r\n]/);
    expect(data.tags.split('\n')).toHaveLength(1);
  });

  it('pipeline chain (linkText-wrapped array path) is single-line too', () => {
    const md = buildEntryMarkdown(
      {
        title: 'T',
        url: 'https://example.com',
        summary: 's',
        tags: ['a\n[evil](https://evil.example)', 'b'],
        createdAt: 0,
      },
      'heading',
      { urlMode: 'obsidian' },
    );

    const tagsLine = md.split('\n').find((line) => line.startsWith('- Tags:'));
    expect(tagsLine).toBeDefined();
    expect(tagsLine).not.toContain('[evil](https://evil.example)');
  });

  it('ordinary tags are unaffected', () => {
    const data = buildTemplateEntryData(
      {
        title: 'T',
        url: 'https://example.com',
        summary: 's',
        tags: 'a, b',
        createdAt: Date.now(),
      },
      { tagChain: 'obsidian' },
    );

    expect(data.tags).toBe('#a #b ');
  });
});
