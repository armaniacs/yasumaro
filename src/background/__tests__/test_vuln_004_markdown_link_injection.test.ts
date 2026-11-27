/**
 * VULN-004 exploit test (fix pin) — markdown link injection at the citation
 * link-text position (CWE-79, Medium). Ported from
 * yasumaro_VULNHUNT_RESULTS_2026-11-27-190000/exploit_tests/ after the fix.
 *
 * Pre-fix, the citation's link-text position ran sanitizeForObsidian, whose
 * plain-text contract passes a bare `](` suffix byte-identical, so the
 * `[${title}](${url})` wrapper closed early and an attacker-chosen
 * `javascript:` destination landed in the delivered markdown. Post-fix pin:
 * the payload title is escaped by the position-specific
 * sanitizeForMarkdownLinkText, the wrapper's only link target is the record's
 * own URL, and normal titles still render un-escaped (no over-escaping).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildResearchReportMarkdown,
  createResearchReportGenerator,
} from '../researchReportGenerator.js';
import { sanitizeForMarkdownLinkText } from '../../utils/markdownSanitizer.js';
import type { ResearchReportScope } from '../../messaging/responseCanonical.js';

const PAYLOAD_TITLE = 'x](javascript:alert(1))';
const REAL_URL = 'https://example.com/page';
const ESCAPED_TITLE = 'x\\]\\(javascript:alert\\(1\\)\\)';
const SAFE_CITATION = `1. [${ESCAPED_TITLE}](${REAL_URL})`;

function citationsSection(markdown: string): string {
  return markdown.split('## 引用')[1]?.split('## 未読穴')[0] ?? '';
}

describe('VULN-004: citation wrapper injection is escaped at the link-text position (fix pin)', () => {
  it('the payload title is escaped by the position-specific sanitizer', () => {
    expect(sanitizeForMarkdownLinkText(PAYLOAD_TITLE)).toBe(ESCAPED_TITLE);
  });

  it('buildResearchReportMarkdown renders the payload as literal text with the record URL as the only link target', () => {
    const md = buildResearchReportMarkdown(
      [{ id: 1, title: PAYLOAD_TITLE, url: REAL_URL, createdAt: 1700000000000, summary: 'ok' }],
      { title: 't', now: 1700000100000 },
    );
    expect(md).not.toBeNull();
    const citations = citationsSection(md!);
    expect(citations).toContain(SAFE_CITATION);
    // No live link with an attacker-chosen destination: the rendered citation
    // must never contain the un-escaped `[x](javascript:`.
    expect(citations).not.toMatch(/\[x\]\(javascript:/);
    // The wrapper's link target is the record's URL only.
    expect(citations.match(/\]\([^)]*\)/g)).toEqual([`](https://example.com/page)`]);
  });

  it('end-to-end: the generator delivers the escaped citation to the export legs', async () => {
    const downloadMarkdown = vi.fn().mockResolvedValue(true);
    const deps = {
      sqliteClient: {
        query: vi.fn().mockResolvedValue({
          success: true,
          data: {
            rows: [{ id: 1, title: PAYLOAD_TITLE, url: REAL_URL, created_at: 1700000000000, summary: 'ok' }],
            total: 1,
          },
        }),
      },
      repo: { get: vi.fn().mockResolvedValue('Yasumaro') },
      obsidian: { appendToDailyNote: vi.fn().mockResolvedValue(undefined) },
      downloadMarkdown,
    };
    const generator = createResearchReportGenerator(deps);
    const result = await generator.generate({ scope: {} as ResearchReportScope });
    expect(result.success).toBe(true);
    const delivered = downloadMarkdown.mock.calls[0]?.[0] as string;
    expect(delivered).toContain(SAFE_CITATION);
    expect(delivered).not.toMatch(/\[x\]\(javascript:/);
  });

  it('a normal title still renders un-escaped (no over-escaping)', () => {
    const md = buildResearchReportMarkdown(
      [{ id: 1, title: 'Plain Page', url: REAL_URL, createdAt: 1700000000000, summary: 'ok' }],
      { title: 't', now: 1700000100000 },
    );
    expect(md).toContain(`1. [Plain Page](${REAL_URL})`);
  });
});
