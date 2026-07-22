/**
 * obsidianFormatter.test.ts
 * VULN-007 regression tests — URL sanitization in Obsidian formatter
 */

import { formatEntriesToMarkdown } from '../obsidianFormatter.js';
import type { BrowsingLogEntry } from '../../utils/sqlite-types.js';

function makeEntry(overrides: Partial<BrowsingLogEntry> = {}): BrowsingLogEntry {
  return {
    id: 1,
    title: 'Test Page',
    url: 'https://example.com/page',
    domain: 'example.com',
    summary: 'A test summary',
    created_at: Date.now(),
    is_starred: false,
    content: null,
    ...overrides,
  };
}

describe('obsidianFormatter', () => {
  describe('formatEntriesToMarkdown', () => {
    it('should format a normal entry correctly', () => {
      const entries = [makeEntry()];
      const result = formatEntriesToMarkdown(entries);
      expect(result).toContain('[Test Page](https://example.com/page)');
      expect(result).toContain('A test summary');
    });

    it('should return empty string for empty array', () => {
      expect(formatEntriesToMarkdown([])).toBe('');
    });

    // VULN-007 regression tests
    it('should sanitize URL containing parentheses (VULN-007)', () => {
      const entries = [makeEntry({
        url: 'https://x) \n\n![evil](https://attacker/track.png)\n\n[click me](https://phish.example',
      })];
      const result = formatEntriesToMarkdown(entries);
      // The URL should be percent-encoded so it can't break out of the markdown link
      expect(result).not.toContain('![evil]');
      expect(result).toContain('%29'); // encoded )
    });

    it('should sanitize URL containing square brackets (VULN-007)', () => {
      const entries = [makeEntry({
        url: 'https://evil.com/path[test]',
      })];
      const result = formatEntriesToMarkdown(entries);
      expect(result).toContain('%5B');
      expect(result).toContain('%5D');
    });

    it('should sanitize URL containing exclamation marks (VULN-007)', () => {
      const entries = [makeEntry({
        url: 'https://evil.com/!inject',
      })];
      const result = formatEntriesToMarkdown(entries);
      expect(result).toContain('%21');
    });

    it('should sanitize title containing markdown links', () => {
      const entries = [makeEntry({
        title: 'Click [here](javascript:alert(1))',
      })];
      const result = formatEntriesToMarkdown(entries);
      expect(result).toContain('\\[here\\]');
    });

    it('should sanitize title containing Obsidian wikilinks', () => {
      const entries = [makeEntry({
        title: 'Deal ![[Passwords]]',
      })];
      const result = formatEntriesToMarkdown(entries);
      expect(result).toContain('!\\[\\[Passwords\\]\\]');
    });

    it('should sanitize summary containing markdown links', () => {
      const entries = [makeEntry({
        summary: 'See [evil](https://bad.com) for more',
      })];
      const result = formatEntriesToMarkdown(entries);
      expect(result).toContain('\\[evil\\]');
    });
  });
});
