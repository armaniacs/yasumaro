import { describe, it, expect } from 'vitest';

// Import test exports from sqliteHistoryPanel
// These are exported via `_test` for testing purposes
import { _test } from '../sqliteHistoryPanel.js';

const { formatDate, escapeHtml } = _test;

describe('sqliteHistoryPanel utilities', () => {
  describe('formatDate', () => {
    it('formats a Date to YYYY-MM-DD', () => {
      const date = new Date(2026, 5, 9); // June 9, 2026
      expect(formatDate(date)).toBe('2026-06-09');
    });

    it('pads single-digit months and days', () => {
      const date = new Date(2026, 0, 1); // January 1, 2026
      expect(formatDate(date)).toBe('2026-01-01');
    });

    it('handles end of year', () => {
      const date = new Date(2026, 11, 31); // December 31, 2026
      expect(formatDate(date)).toBe('2026-12-31');
    });
  });

  describe('escapeHtml', () => {
    it('escapes & to &amp;', () => {
      expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('escapes < to &lt;', () => {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    });

    it('escapes > to &gt;', () => {
      expect(escapeHtml('>hello<')).toBe('&gt;hello&lt;');
    });

    it('escapes double quotes', () => {
      expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
    });

    it('escapes single quotes', () => {
      expect(escapeHtml("it's")).toBe('it&#039;s');
    });

    it('handles strings with no special characters', () => {
      expect(escapeHtml('plain text')).toBe('plain text');
    });

    it('handles empty strings', () => {
      expect(escapeHtml('')).toBe('');
    });

    it('handles strings with all special characters', () => {
      const input = '<a href="test" onclick="alert(\'xss\')">&</a>';
      const output = '&lt;a href=&quot;test&quot; onclick=&quot;alert(&#039;xss&#039;)&quot;&gt;&amp;&lt;/a&gt;';
      expect(escapeHtml(input)).toBe(output);
    });
  });
});
