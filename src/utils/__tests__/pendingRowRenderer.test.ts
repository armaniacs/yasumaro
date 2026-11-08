// @vitest-environment node
/**
 * pendingRowRenderer.test.ts
 * Shared pending-row renderer (PBI 2026-11-07-17): checkbox fragment for the
 * popup and actions row for the dashboard, built from one PendingPage.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../i18n.js', async () => {
  const { mockGetMessage: i18nMock } = await import('../../../testDir/i18nMock.js');
  const getMessage = vi.fn((key: string) => key);
  return { ...i18nMock(getMessage), tOrKey: (key: string) => key };
});

import { buildPendingRowHtml, formatTimestamp } from '../pendingRowRenderer.js';
import { escapeHtml } from '../htmlEscape.js';
import type { PendingPage } from '../pendingStorage.js';

function makePage(overrides: Partial<PendingPage> = {}): PendingPage {
  return {
    url: 'https://example.com/page',
    title: 'Example',
    timestamp: 1700000000000,
    reason: 'cache-control',
    expiry: 1700086400000,
    ...overrides,
  };
}

describe('pendingRowRenderer', () => {
  describe('buildPendingRowHtml', () => {
    it('renders the popup checkbox fragment byte-identically (input, title, raw reason)', () => {
      const html = buildPendingRowHtml(makePage(), { mode: 'checkbox' });

      // The popup reason line keeps the raw reason/headerValue (no
      // renderPendingReason label mapping) — historical popup behavior.
      expect(html).toBe(`
          <input type="checkbox" value="https:&#x2F;&#x2F;example.com&#x2F;page" class="pending-checkbox">
          <div class="pending-item-content">
            <div class="pending-item-title pending-item-title--link">Example</div>
            <div class="pending-item-reason">cache-control</div>
          </div>
        `);
    });

    it('prefers headerValue over reason in the popup reason line', () => {
      const html = buildPendingRowHtml(makePage({ headerValue: 'max-age=0', reason: 'set-cookie' }), {
        mode: 'checkbox',
      });

      expect(html).toContain('<div class="pending-item-reason">max-age=0</div>');
    });

    it('escapes attacker-controlled title and url in the checkbox fragment', () => {
      const html = buildPendingRowHtml(
        makePage({ url: 'https://example.com/?q="<x>"', title: '<script>alert(1)</script>' }),
        { mode: 'checkbox' }
      );

      expect(html).toContain('value="https:&#x2F;&#x2F;example.com&#x2F;?q=&quot;&lt;x&gt;&quot;"');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;&#x2F;script&gt;');
      expect(html).not.toContain('<script>');
    });

    it('keeps the popup no-fallback behavior for an empty title', () => {
      const html = buildPendingRowHtml(makePage({ title: '' }), { mode: 'checkbox' });

      expect(html).toContain(
        '<div class="pending-item-title pending-item-title--link"></div>'
      );
    });

    it('renders the dashboard actions row with a link for secure urls', () => {
      const page = makePage();
      const html = buildPendingRowHtml(page, { mode: 'actions' });

      expect(html).toContain(
        '<a class="history-entry-url" href="https:&#x2F;&#x2F;example.com&#x2F;page" target="_blank" rel="noopener noreferrer">Example</a>'
      );
      expect(html).toContain('data-pending-action="record"');
      expect(html).toContain('data-pending-action="recordWithoutAi"');
      expect(html).toContain('data-pending-action="delete"');
      // i18n keys resolve through the same seam the view used.
      expect(html).toContain('>recordNow</button>');
      expect(html).toContain('>recordWithoutAi</button>');
      expect(html).toContain('>pendingDeleteForever</button>');
    });

    it('falls back to the url text when the dashboard title is empty', () => {
      const html = buildPendingRowHtml(makePage({ title: '' }), { mode: 'actions' });

      expect(html).toContain('>https:&#x2F;&#x2F;example.com&#x2F;page</a>');
    });

    it('renders a span instead of a link for non-secure urls', () => {
      const html = buildPendingRowHtml(makePage({ url: 'ftp://example.com/file', title: 'F' }), {
        mode: 'actions',
      });

      expect(html).toContain('<span class="history-entry-url">F</span>');
      expect(html).not.toContain('<a class="history-entry-url"');
    });

    it('shows the header value in parens only when present', () => {
      const withHeader = buildPendingRowHtml(makePage({ headerValue: 'no-store' }), { mode: 'actions' });
      const withoutHeader = buildPendingRowHtml(makePage({ headerValue: '' }), { mode: 'actions' });

      expect(withHeader).toContain('<span class="pending-entry-header"> (no-store)</span>');
      expect(withoutHeader).not.toContain('pending-entry-header');
    });

    it('passes unknown reasons through raw in the meta line', () => {
      const page = makePage({ reason: 'mystery' as PendingPage['reason'] });
      const html = buildPendingRowHtml(page, { mode: 'actions' });

      expect(html).toContain(` — mystery`);
    });

    it('escapes the row url in every dashboard data attribute', () => {
      const html = buildPendingRowHtml(makePage({ url: 'https://example.com/?q="<x>"' }), {
        mode: 'actions',
      });

      expect(html).toContain('data-pending-url="https:&#x2F;&#x2F;example.com&#x2F;?q=&quot;&lt;x&gt;&quot;"');
      expect(html).not.toContain('"<x>"');
    });

    it('keeps the meta timestamp composition order (timestamp, reason, header)', () => {
      const page = makePage({ headerValue: 'h' });
      const html = buildPendingRowHtml(page, { mode: 'actions' });

      const meta = html.match(/<div class="pending-entry-meta">(.*?)<\/div>/)?.[1] ?? '';
      // Composition order: formatted timestamp, em-dash separator, reason, header.
      expect(meta).toBe(
        `${escapeHtml(formatTimestamp(page.timestamp))} — ${escapeHtml('pendingReasonCache')}<span class="pending-entry-header"> (h)</span>`
      );
    });
  });
});
