import { describe, it, expect } from 'vitest';
import { buildExportEnvelope, projectExportRow, EXPORT_COLUMNS } from '../exportEnvelope.js';
import { BROWSING_LOG_COLUMNS } from '../rowCodec.js';

describe('exportEnvelope (PBI 2026-09-12-22)', () => {
  it('produces the canonical {version, table, rows} envelope', () => {
    const data = buildExportEnvelope([{ id: 1, url: 'https://a.com' }]);
    const parsed = JSON.parse(new TextDecoder().decode(data));
    expect(parsed.version).toBe(1);
    expect(parsed.table).toBe('browsing_logs');
    expect(parsed.rows[0]).toMatchObject({ id: 1, url: 'https://a.com' });
    // Every export column is present (missing values are null, SQLite parity)
    expect(Object.keys(parsed.rows[0]).sort()).toEqual([...EXPORT_COLUMNS].sort());
  });

  it('projects every export column; missing values become null (SQLite parity)', () => {
    const row = projectExportRow({ id: 5, url: 'https://a.com' });
    for (const col of EXPORT_COLUMNS) {
      expect(row).toHaveProperty(col);
    }
    expect(row.title).toBeNull();
    expect(row.gist_synced).toBeNull();
  });

  it('keeps EXPORT_COLUMNS a subset of the schema columns (drift guard)', () => {
    const schemaSet = new Set<string>(BROWSING_LOG_COLUMNS);
    for (const col of EXPORT_COLUMNS) {
      expect(schemaSet.has(col), `${col} must exist in BROWSING_LOG_COLUMNS`).toBe(true);
    }
  });
});
