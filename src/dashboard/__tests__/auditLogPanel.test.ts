// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { toTsvString } from '../panels/asyncData/auditLogPanel.js';

describe('toTsvString', () => {
  it('produces correct header and data rows', () => {
    const rows = [
      { id: 1, provider: 'gemini', url: 'https://example.com', created_at: 1721203200000 },
    ];
    const tsv = toTsvString(rows);
    const lines = tsv.split('\n');
    expect(lines[0]).toBe('id\tprovider\turl\tcreated_at');
    expect(lines[1]).toContain('1\tgemini\thttps://example.com\t');
    expect(lines[1]).toContain('2024-07-17');
  });

  it('escapes tabs in provider names', () => {
    const rows = [
      { id: 1, provider: 'open\tai', url: 'https://x.com', created_at: 1721203200000 },
    ];
    const tsv = toTsvString(rows);
    expect(tsv).toContain('"open\tai"');
  });

  it('handles empty rows', () => {
    const tsv = toTsvString([]);
    const lines = tsv.split('\n');
    expect(lines[0]).toBe('id\tprovider\turl\tcreated_at');
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});
