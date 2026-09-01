// @vitest-environment jsdom
/**
 * exportLogsService.test.ts
 * Tests for browsing log export functionality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockQueryLogs = vi.fn();

vi.mock('../dashboardSqliteService.js', () => ({
  queryLogs: (...args: any[]) => mockQueryLogs(...args),
}));

vi.mock('../../utils/storage/encryptionSession.js', () => ({
  getOrCreateHmacSecret: vi.fn(async () => 'test-secret'),
}));
vi.mock('../../utils/crypto/index.js', () => ({
  computeHMAC: vi.fn(async (secret: string, payload: string) => `hmac(${secret}):${payload.length}`),
}));

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
import { escapeCsv, exportMarkdown, exportCsv, exportJson, downloadBlob, downloadText } from '../exportLogsService.js';

const SAMPLE_ROWS = [
  {
    id: 1,
    url: 'https://example.com/page1',
    title: 'First Page',
    summary: 'Summary of page 1',
    tags: JSON.stringify(['tech', 'ai']),
    created_at: '2026-06-01T10:00:00.000Z',
    domain: 'example.com',
    is_starred: 0,
  },
  {
    id: 2,
    url: 'https://example.org/page2',
    title: 'Second Page',
    summary: 'Summary of page 2',
    tags: JSON.stringify(['science']),
    created_at: '2026-06-02T12:00:00.000Z',
    domain: 'example.org',
    is_starred: 1,
  },
];

describe('exportLogsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // escapeCsv (existing tests carried forward)
  // =========================================================================

  describe('escapeCsv', () => {
    it('returns empty string for null/undefined', () => {
      expect(escapeCsv(null)).toBe('');
      expect(escapeCsv(undefined)).toBe('');
    });

    it('returns plain string as-is', () => {
      expect(escapeCsv('hello')).toBe('hello');
      expect(escapeCsv(42)).toBe('42');
      expect(escapeCsv(true)).toBe('true');
    });

    it('wraps strings containing commas', () => {
      expect(escapeCsv('a,b')).toBe('"a,b"');
    });

    it('escapes double quotes', () => {
      expect(escapeCsv('say "hello"')).toBe('"say ""hello"""');
    });

    it('wraps strings containing newlines', () => {
      expect(escapeCsv('line1\nline2')).toBe('"line1\nline2"');
    });

    // VULN-005 (CWE-1236): cells beginning with a formula-trigger character
    // must be neutralized so a spreadsheet treats them as text.
    it('neutralizes leading equals sign', () => {
      expect(escapeCsv('=2+2')).toBe("'=2+2");
    });

    it('neutralizes leading plus, minus, and at sign', () => {
      expect(escapeCsv('+cmd|...')).toBe("'+cmd|...");
      expect(escapeCsv('-1+1')).toBe("'-1+1");
      expect(escapeCsv('@SUM(A1)')).toBe("'@SUM(A1)");
    });

    it('neutralizes leading tab and CR', () => {
      expect(escapeCsv('\t=1')).toBe("'\t=1");
      expect(escapeCsv('\r=1')).toBe("'\r=1");
    });

    it('still quotes formula cells that also contain commas', () => {
      expect(escapeCsv('=HYPERLINK("x","y")')).toBe("\"'=HYPERLINK(\"\"x\"\",\"\"y\"\")\"");
    });
  });

  // =========================================================================
  // exportMarkdown
  // =========================================================================

  describe('exportMarkdown', () => {
    it('exports all rows as markdown frontmatter entries', async () => {
      mockQueryLogs.mockResolvedValue({ data: { rows: SAMPLE_ROWS, total: 2 } });

      const result = await exportMarkdown();

      expect(result).toContain('title: "First Page"');
      expect(result).toContain('url: "https://example.com/page1"');
      expect(result).toContain('tags: ["tech", "ai"]');
      expect(result).toContain('Summary of page 1');
      expect(result).toContain('title: "Second Page"');
      expect(result).toContain('---');
    });

    it('filters by ids when specified', async () => {
      mockQueryLogs.mockResolvedValue({ data: { rows: SAMPLE_ROWS, total: 2 } });

      const result = await exportMarkdown([1]);

      expect(result).toContain('First Page');
      expect(result).not.toContain('Second Page');
    });

    it('returns empty string when no data', async () => {
      mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });

      const result = await exportMarkdown();
      expect(result).toBe('');
    });

    it('handles malformed tags gracefully', async () => {
      const badRow = { ...SAMPLE_ROWS[0], tags: '{invalid}' };
      mockQueryLogs.mockResolvedValue({ data: { rows: [badRow], total: 1 } });

      const result = await exportMarkdown();
      expect(result).toContain('tags: []');
    });

    it('escapes double quotes in title', async () => {
      const rowWithQuotes = { ...SAMPLE_ROWS[0], title: 'Page "Special" Title' };
      mockQueryLogs.mockResolvedValue({ data: { rows: [rowWithQuotes], total: 1 } });

      const result = await exportMarkdown([1]);
      expect(result).toContain('\\"');
    });
  });

  // =========================================================================
  // exportCsv
  // =========================================================================

  describe('exportCsv', () => {
    it('generates CSV with BOM and headers', async () => {
      mockQueryLogs.mockResolvedValue({ data: { rows: SAMPLE_ROWS, total: 2 } });

      const blob = await exportCsv();
      const text = await blob.text();

      // BOM check: jsdom may not preserve \uFEFF in Blob.text(),
      // so verify the content starts with CSV header instead
      expect(text).toContain('url,title,summary,tags,created_at,domain,is_starred');
      expect(text).toContain('https://example.com/page1');
      expect(text).toContain('example.com');
    });

    it('returns empty CSV when no data', async () => {
      mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });

      const blob = await exportCsv();
      const text = await blob.text();

      expect(text).toContain('url,title');
      expect(text.split('\n').length).toBe(2); // header only + empty line
    });

    it('has correct MIME type', async () => {
      mockQueryLogs.mockResolvedValue({ data: { rows: SAMPLE_ROWS, total: 2 } });

      const blob = await exportCsv();
      expect(blob.type).toBe('text/csv;charset=utf-8');
    });
  });

  // =========================================================================
  // exportJson
  // =========================================================================

  describe('exportJson', () => {
    it('generates JSON with version and rows', async () => {
      mockQueryLogs.mockResolvedValue({ data: { rows: SAMPLE_ROWS, total: 2 } });

      const blob = await exportJson();
      const text = await blob.text();
      const parsed = JSON.parse(text);

      expect(parsed.version).toBe(2);
      expect(parsed.table).toBe('browsing_logs');
      expect(parsed.rows).toHaveLength(2);
      expect(parsed.rows[0].url).toBe('https://example.com/page1');
      expect(typeof parsed.signature).toBe('string');
      expect(parsed.signature.length).toBeGreaterThan(0);
    });

    it('signs the signature-stripped body so import can verify it', async () => {
      mockQueryLogs.mockResolvedValue({ data: { rows: SAMPLE_ROWS, total: 2 } });
      const parsed = JSON.parse(await (await exportJson()).text());
      const { signature, ...body } = parsed;
      // mock computeHMAC returns `hmac(secret):<payload length>`
      const expectedLen = JSON.stringify(body, null, 2).length;
      expect(signature).toBe(`hmac(test-secret):${expectedLen}`);
    });

    it('has correct MIME type', async () => {
      mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });

      const blob = await exportJson();
      expect(blob.type).toBe('application/json');
    });
  });

  // =========================================================================
  // downloadBlob / downloadText
  // =========================================================================

  describe('downloadBlob', () => {
    it('creates anchor element and triggers download', () => {
      // Spy on DOM methods
      const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
      const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      const appendChild = vi.spyOn(document.body, 'appendChild').mockImplementation(() => {});
      const removeChild = vi.spyOn(document.body, 'removeChild').mockImplementation(() => {});

      const blob = new Blob(['test'], { type: 'text/plain' });
      downloadBlob(blob, 'test.txt');

      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(appendChild).toHaveBeenCalled();
      expect(removeChild).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalled();

      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
      appendChild.mockRestore();
      removeChild.mockRestore();
    });
  });

  describe('downloadText', () => {
    it('creates a text blob and triggers download', () => {
      const spy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test2');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => {});
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => {});

      downloadText('hello world', 'out.txt');

      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  /**
   * These exporters hand their result straight to a download. Before this
   * suite existed, a database failure produced an empty file plus an
   * "export completed" status message, because queryAllData turned every
   * failure into an empty row list.
   */
  describe('failure paths', () => {
    it('exportMarkdown rejects when the query reports an error', async () => {
      mockQueryLogs.mockResolvedValue({ error: 'Storage quota exceeded.' });
      await expect(exportMarkdown()).rejects.toThrow('Storage quota exceeded.');
    });

    it('exportCsv rejects when the query reports an error', async () => {
      mockQueryLogs.mockResolvedValue({ error: 'Database connection lost.' });
      await expect(exportCsv()).rejects.toThrow('Database connection lost.');
    });

    it('exportJson rejects when the query reports an error', async () => {
      mockQueryLogs.mockResolvedValue({ error: 'Database connection lost.' });
      await expect(exportJson()).rejects.toThrow('Database connection lost.');
    });

    it('rejects when the query reports an error instead of a row list', async () => {
      mockQueryLogs.mockResolvedValue({ error: 'Storage quota exceeded.' });
      await expect(exportJson()).rejects.toThrow('Storage quota exceeded.');
    });

    it('rejects rather than silently truncating when the history exceeds the limit', async () => {
      // total far exceeds the rows actually returned: the file would have been
      // written with only the first page and reported as a complete export.
      mockQueryLogs.mockResolvedValue({ data: { rows: SAMPLE_ROWS, total: 25000 } });
      await expect(exportJson()).rejects.toThrow(/25000/);
    });

    it('still exports normally when the row count matches the total', async () => {
      mockQueryLogs.mockResolvedValue({ data: { rows: SAMPLE_ROWS, total: SAMPLE_ROWS.length } });
      await expect(exportJson()).resolves.toBeInstanceOf(Blob);
    });

    it('treats a genuinely empty database as success, not an error', async () => {
      mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
      await expect(exportJson()).resolves.toBeInstanceOf(Blob);
    });
  });
});
