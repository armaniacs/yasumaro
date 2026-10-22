// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { toTsvString } from '../utils/auditLogTsv.js';

// PBI 2026-10-21-09: the created_at column is the LOCAL calendar date, so a
// fixed UTC-epoch fixture would be timezone-dependent. Build it from local
// date components instead, which reads the runner's zone and keeps the pin
// green in any timezone (localDate.test.ts pattern). No fixed-time waits.
const CREATED_AT = new Date(2024, 6, 17, 12, 0, 0).getTime();

describe('toTsvString', () => {
  it('produces correct header and data rows', () => {
    const rows = [
      { id: 1, provider: 'gemini', url: 'https://example.com', created_at: CREATED_AT, char_count: 1234, policy: 'allowed' },
    ];
    const tsv = toTsvString(rows);
    const lines = tsv.split('\n');
    // PBI 2026-10-23-01: char_count/policy ride the same row.
    expect(lines[0]).toBe('id\tprovider\turl\tcreated_at\tchar_count\tpolicy');
    expect(lines[1]).toBe('1\tgemini\thttps://example.com\t2024-07-17\t1234\tallowed');
  });

  it('exports an empty field, never a literal null, for rows without char_count/policy', () => {
    const rows = [
      { id: 1, provider: 'gemini', url: 'https://example.com', created_at: CREATED_AT },
    ];
    const tsv = toTsvString(rows);
    const lines = tsv.split('\n');
    expect(lines[1]).toBe('1\tgemini\thttps://example.com\t2024-07-17\t\t');
  });

  it('escapes tabs in provider names', () => {
    const rows = [
      { id: 1, provider: 'open\tai', url: 'https://x.com', created_at: CREATED_AT },
    ];
    const tsv = toTsvString(rows);
    expect(tsv).toContain('"open\tai"');
  });

  it('neutralizes formula-trigger characters in fields', () => {
    const rows = [
      { id: 1, provider: '=1+1', url: '@SUM(A1)', created_at: CREATED_AT },
      { id: 2, provider: '+cmd', url: '-2+3', created_at: CREATED_AT },
    ];
    const tsv = toTsvString(rows);
    expect(tsv).toContain("1\t'=1+1\t'@SUM(A1)\t");
    expect(tsv).toContain("2\t'+cmd\t'-2+3\t");
  });

  it('handles empty rows', () => {
    const tsv = toTsvString([]);
    const lines = tsv.split('\n');
    expect(lines[0]).toBe('id\tprovider\turl\tcreated_at\tchar_count\tpolicy');
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});
