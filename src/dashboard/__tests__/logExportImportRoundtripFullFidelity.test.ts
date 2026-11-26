/**
 * logExportImportRoundtripFullFidelity.test.ts
 * Full-fidelity round-trip pin (PBI 2026-11-26-05): 50,000 realistic rows
 * (url/title/summary/tags/domain/is_starred at real-data lengths) exported
 * through the real exportJson (real HMAC signer) re-import through
 * importFromJson inside the 30 MiB text gate.
 *
 * Unlike logExportImportRoundtrip100k.test.ts (lightweight rows, 8 MB, fits
 * the old 10 MiB gate), this file intentionally lands between the old and new
 * gates: before MAX_IMPORT_TEXT_BYTES was widened, a full-fidelity export at
 * this scale was rejected by the size cap while the row cap allowed it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QUERY_CAPS, MAX_EXPORT_ROWS, MAX_IMPORT_TEXT_BYTES } from '../../utils/limits.js';

const OLD_GATE_BYTES = 10 * 1024 * 1024;

const mockQueryLogs = vi.fn();
const mockImportLogs = vi.fn();

vi.mock('../dashboardSqliteService.js', () => ({
  isServiceError: (result: object) => 'error' in result,
  sqliteClient: {
    call: (...args: unknown[]) => (args[0] === 'import' ? mockImportLogs(args[1]) : mockQueryLogs(args[1])),
  },
}));

import { exportJson } from '../exportLogsService.js';
import { importFromJson } from '../importLogsService.js';

const PAGE = QUERY_CAPS.plain;
const TOTAL = 50_000;
const BASE = 1_700_000_000_000;

// Realistic record: every optional schema column carries real-data-length
// text (~500 bytes per row pretty-printed), the shape a full-history export
// of an actively used profile produces.
const ALL_ROWS = Array.from({ length: TOTAL }, (_, i) => ({
  id: i + 1,
  url: `https://example.com/articles/why-testing-matters-in-large-codebases/entry-${i}`,
  title: `Article ${i}: why round-trip invariants keep browsing-log migrations honest`,
  summary:
    `Reading session ${i}: visited the article and stayed for the full read. ` +
    'The page covered keyset paging and how the recorder batches writes under load.',
  tags: JSON.stringify(['testing', 'migration', 'round-trip', 'long-term']),
  domain: 'example.com',
  created_at: BASE - i,
  is_starred: i % 10 === 0 ? 1 : 0,
}));

describe('full-fidelity export/import round-trip inside the 30 MiB gate (PBI 2026-11-26-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryLogs.mockImplementation((payload: { until?: number }) => {
      const until = typeof payload.until === 'number' ? payload.until : Number.POSITIVE_INFINITY;
      const page = ALL_ROWS.filter((row) => row.created_at <= until).slice(0, PAGE);
      return Promise.resolve({ data: { rows: page, total: TOTAL } });
    });
    mockImportLogs.mockImplementation((payload: { rows: Array<{ id: number }> }) =>
      Promise.resolve({ data: { inserted: payload.rows.length, skipped: 0, total: payload.rows.length } }),
    );
  });

  it('exports 50,000 full-fidelity rows past the old 10 MiB gate and re-imports all of them', async () => {
    const blob = await exportJson();
    const text = await blob.text();

    // The file exceeds the OLD cap (the scale this PBI unlocks) and fits the
    // new one: both sides of the widened gate are pinned here.
    expect(text.length).toBeGreaterThan(OLD_GATE_BYTES);
    expect(text.length).toBeLessThanOrEqual(MAX_IMPORT_TEXT_BYTES);

    const result = await importFromJson(text);
    expect(result).toEqual({ inserted: TOTAL, skipped: 0, total: TOTAL });

    // Batch pin: 200-row messages, so 50,000 rows take 250 calls.
    expect(mockImportLogs).toHaveBeenCalledTimes(TOTAL / 200);
    // Headroom proof: this scale is nowhere near the row cap that PBI 04
    // pinned (MAX_EXPORT_ROWS), so the byte gate is the effective first gate
    // for full-fidelity exports.
    expect(TOTAL).toBeLessThan(MAX_EXPORT_ROWS);
  });
});
