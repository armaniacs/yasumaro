// @vitest-environment wasm-quickjs-dom
/**
 * importLogsService-tolerant.test.ts
 * PBI 2026-11-23-05: 閲覧ログの寛容インポート本体 (AI修復は対象外)。
 * Outside-In の起点となる E2E 相当: 旧形の履歴ファイルを移行取込にかけ、
 * 有効行の取込と件数・理由内訳の報告までを通しで確認する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSqliteCall = vi.fn();
vi.mock('../dashboardSqliteService.js', () => ({
  sqliteClient: { call: (...args: unknown[]) => mockSqliteCall(...args) },
}));

vi.mock('../../utils/storage/encryptionSession.js', () => ({
  exportHmacSigner: {
    sign: vi.fn(async (payload: string) => `hmac(test-secret):${payload.length}:${payload.slice(0, 8)}`),
    verify: vi.fn(
      async (payload: string, sig: string) =>
        sig === `hmac(test-secret):${payload.length}:${payload.slice(0, 8)}`
    ),
  },
}));

const mockLogWarn = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../utils/logger/api.js', () => ({
  logError: vi.fn(async () => {}),
  logInfo: vi.fn(async () => {}),
  logWarn: mockLogWarn,
}));

const NOW = 1_700_000_000_000;

/** 旧形の履歴ファイル: 旧キー形式 + 別名 + 修正不能行の混在。 */
function legacyMigrationFile(): string {
  return JSON.stringify({
    version: 1,
    logs: {
      a: {
        url: 'https://a.test/',
        pageTitle: 'A',
        timestamp: NOW,
        description: 'summary-a',
        keywords: ['x'],
      },
      b: {
        url: 'https://b.test/',
        name: 'B',
        visited_at: NOW + 1,
        tag: 'y',
      },
      c: { pageTitle: 'url missing', timestamp: NOW + 2 },
      d: 'not a row',
    },
  });
}

describe('tolerant log import (E2E equivalent)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSqliteCall.mockResolvedValue({ data: { inserted: 2, skipped: 0, total: 2 } });
  });

  it('imports valid rows from a legacy file and reports counts with reasons', async () => {
    const { importFromJsonForMigration } = await import('../importLogsService.js');

    const result = await importFromJsonForMigration(legacyMigrationFile());

    expect(result).toEqual({
      inserted: 2,
      skipped: 0,
      total: 2,
      invalid: 2,
      invalidReasons: {
        'url must be a non-empty string': 1,
        'must be an object': 1,
      },
      invalidSamples: [
        { index: 2, reason: 'url must be a non-empty string' },
        { index: 3, reason: 'must be an object' },
      ],
    });
    expect(mockSqliteCall).toHaveBeenCalledTimes(1);
    expect(mockSqliteCall).toHaveBeenCalledWith(
      'import',
      expect.objectContaining({
        subtype: 'import',
        rows: [
          expect.objectContaining({ url: 'https://a.test/', created_at: NOW, title: 'A' }),
          expect.objectContaining({ url: 'https://b.test/', created_at: NOW + 1, title: 'B' }),
        ],
      })
    );
  });
});

describe('tolerant shape acceptance (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSqliteCall.mockResolvedValue({ data: { inserted: 1, skipped: 0, total: 1 } });
  });

  it('accepts a legacy array key (logs) on the migration path', async () => {
    const { importFromJsonForMigration } = await import('../importLogsService.js');
    const file = JSON.stringify({
      version: 1,
      logs: [{ url: 'https://legacy.test/', timestamp: NOW, pageTitle: 'L' }],
    });

    const result = await importFromJsonForMigration(file);

    expect(result).toMatchObject({ inserted: 1, total: 1 });
    expect(mockSqliteCall).toHaveBeenCalledWith(
      'import',
      expect.objectContaining({
        rows: [{ url: 'https://legacy.test/', created_at: NOW, title: 'L', summary: '', tags: '' }],
      })
    );
  });

  it.each([['records'], ['items'], ['entries'], ['data']])(
    'accepts a legacy array key (%s) on the migration path',
    async (key) => {
      const { importFromJsonForMigration } = await import('../importLogsService.js');
      const file = JSON.stringify({
        version: 1,
        [key]: [{ url: 'https://legacy.test/', created_at: NOW }],
      });

      const result = await importFromJsonForMigration(file);

      expect(result).toMatchObject({ inserted: 1, total: 1 });
    }
  );

  it('accepts a bare top-level array on the migration path', async () => {
    const { importFromJsonForMigration } = await import('../importLogsService.js');
    const file = JSON.stringify([{ url: 'https://bare.test/', created_at: NOW, title: 'B' }]);

    const result = await importFromJsonForMigration(file);

    expect(result).toMatchObject({ inserted: 1, total: 1 });
  });

  it('accepts a keyed-object row container on the migration path', async () => {
    const { importFromJsonForMigration } = await import('../importLogsService.js');
    const file = JSON.stringify({
      version: 1,
      rows: {
        'row-1': { url: 'https://keyed.test/', visitedAt: NOW, heading: 'K' },
      },
    });

    const result = await importFromJsonForMigration(file);

    expect(result).toMatchObject({ inserted: 1, total: 1 });
    expect(mockSqliteCall).toHaveBeenCalledWith(
      'import',
      expect.objectContaining({
        rows: [expect.objectContaining({ url: 'https://keyed.test/', created_at: NOW, title: 'K' })],
      })
    );
  });

  it('keeps rejecting an unsigned legacy file on the normal path (VULN-035)', async () => {
    const { importFromJson } = await import('../importLogsService.js');

    const result = await importFromJson(legacyMigrationFile());

    expect(result).toEqual({
      error: 'This log file is unsigned and cannot be imported. Re-export it from this extension.',
    });
    expect(mockSqliteCall).not.toHaveBeenCalled();
  });

  it('applies tolerant shapes on the signed normal path too', async () => {
    const { importFromJson } = await import('../importLogsService.js');
    const body = {
      version: 2,
      table: 'browsing_logs',
      logs: [{ url: 'https://signed-legacy.test/', date: NOW, subject: 'S' }],
    };
    const { exportHmacSigner } = await import('../../utils/storage/encryptionSession.js');
    const signature = await exportHmacSigner.sign(JSON.stringify(body, null, 2));

    const result = await importFromJson(JSON.stringify({ ...body, signature }));

    expect(result).toMatchObject({ inserted: 1, total: 1 });
  });

  it('keeps the row cap on the extracted (not envelope) row count', async () => {
    const { importFromJsonForMigration, IMPORT_TOTAL_ROW_CAP } = await import(
      '../importLogsService.js'
    );
    const file = JSON.stringify({
      version: 1,
      logs: Array.from({ length: IMPORT_TOTAL_ROW_CAP + 1 }, (_, i) => ({
        url: `https://cap.test/${i}`,
        created_at: NOW,
      })),
    });

    const result = await importFromJsonForMigration(file);

    expect(result).toEqual({ error: `Import exceeds the ${IMPORT_TOTAL_ROW_CAP} row limit` });
    expect(mockSqliteCall).not.toHaveBeenCalled();
  });
});

describe('re-import idempotency (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends identical rows on re-import so duplicates collapse backend-side', async () => {
    const { importFromJsonForMigration } = await import('../importLogsService.js');
    mockSqliteCall
      .mockResolvedValueOnce({ data: { inserted: 2, skipped: 0, total: 2 } })
      .mockResolvedValueOnce({ data: { inserted: 0, skipped: 2, total: 2 } });
    const file = legacyMigrationFile();

    const first = await importFromJsonForMigration(file);
    const second = await importFromJsonForMigration(file);

    expect(first).toMatchObject({ inserted: 2, total: 2 });
    expect(second).toMatchObject({ inserted: 0, skipped: 2, total: 2 });
    expect(mockSqliteCall).toHaveBeenCalledTimes(2);
    const sentPayloads = mockSqliteCall.mock.calls;
    expect(sentPayloads).toHaveLength(2);
    expect(sentPayloads[1]?.[1]).toEqual(sentPayloads[0]?.[1]);
  });
});

describe('validators.ts consistency (integration)', () => {
  it('every row accepted by the dashboard gate also passes validateImportRow', async () => {
    const { normalizeImportRow, validateImportRowReason } = await import(
      '../importLogsService.js'
    );
    const { validateImportRow } = await import('../../messaging/validators.js');
    const candidates: unknown[] = [
      { url: 'https://a.test/', created_at: NOW },
      { url: 'https://b.test/', created_at: NOW, title: 'T', summary: 'S', tags: '["x"]' },
      { url: 'https://c.test/', timestamp: NOW, pageTitle: 'P', description: 'D', keywords: ['k'] },
      { url: 'https://d.test/', visited_at: NOW, name: 'N', snippet: 's', tag: 't' },
      { url: 'https://e.test/', date: NOW, heading: 'H', excerpt: 'e', labels: 'l' },
      {
        url: 'https://g.test/',
        created_at: NOW,
        visit_duration: 1000,
        scroll_ratio: 0.5,
        is_starred: 1,
        is_deleted: 0,
      },
    ];

    for (const raw of candidates) {
      const normalized = normalizeImportRow(raw);
      expect(normalized).not.toBeNull();
      expect(validateImportRowReason(normalized!)).toBeNull();
      expect(validateImportRow(normalized)).toBeNull();
    }
  });
});

describe('normalizeImportRow boundaries (unit)', () => {
  it('passes canonical rows through untouched (current path keeps its bytes)', async () => {
    const { normalizeImportRow } = await import('../importLogsService.js');
    const row = { url: 'https://a.test/', created_at: NOW };

    expect(normalizeImportRow(row)).toBe(row);
  });

  it('prefers canonical keys over aliases', async () => {
    const { normalizeImportRow } = await import('../importLogsService.js');

    const normalized = normalizeImportRow({
      url: 'https://a.test/',
      created_at: NOW,
      timestamp: NOW + 100,
      title: 'canonical',
      pageTitle: 'alias',
    });

    expect(normalized).toMatchObject({ created_at: NOW, title: 'canonical' });
  });

  it.each([
    ['createdAt', { createdAt: NOW }],
    ['timestamp', { timestamp: NOW }],
    ['time', { time: NOW }],
    ['date', { date: NOW }],
    ['visited_at', { visited_at: NOW }],
    ['visitedAt', { visitedAt: NOW }],
  ])('maps the %s datetime alias', async (_name, datetime) => {
    const { normalizeImportRow } = await import('../importLogsService.js');

    expect(normalizeImportRow({ url: 'https://a.test/', ...datetime })).toMatchObject({
      created_at: NOW,
    });
  });

  it.each([
    ['name', { name: 'N' }, 'title', 'N'],
    ['pageTitle', { pageTitle: 'P' }, 'title', 'P'],
    ['description', { description: 'D' }, 'summary', 'D'],
    ['snippet', { snippet: 'S' }, 'summary', 'S'],
    ['tag', { tag: 't' }, 'tags', 't'],
    ['labels', { labels: 'l' }, 'tags', 'l'],
    ['keywords', { keywords: 'k' }, 'tags', 'k'],
  ])('maps the %s alias to %s', async (_alias, source, field, value) => {
    const { normalizeImportRow } = await import('../importLogsService.js');

    expect(normalizeImportRow({ url: 'https://a.test/', created_at: NOW, ...source })).toMatchObject({
      [field]: value,
    });
  });

  it('never complements url or created_at', async () => {
    const { normalizeImportRow, validateImportRowReason } = await import(
      '../importLogsService.js'
    );

    expect(validateImportRowReason(normalizeImportRow({ link: 'https://a.test/', created_at: NOW })!))
      .toBe('url must be a non-empty string');
    expect(validateImportRowReason(normalizeImportRow({ url: 'https://a.test/' })!))
      .toBe('created_at must be a finite number');
  });

  it('stringifies a tags array and fills missing text with empty strings', async () => {
    const { normalizeImportRow } = await import('../importLogsService.js');

    expect(
      normalizeImportRow({ url: 'https://a.test/', timestamp: NOW, keywords: ['x', 'y'] })
    ).toMatchObject({ tags: '["x","y"]', title: '', summary: '' });
  });

  it('leaves mistyped alias values for validation to reject with a reason', async () => {
    const { normalizeImportRow, validateImportRowReason } = await import(
      '../importLogsService.js'
    );

    expect(
      validateImportRowReason(normalizeImportRow({ url: 'https://a.test/', created_at: NOW, pageTitle: 123 })!)
    ).toBe('title must be a string');
  });

  it('rejects non-objects as must be an object', async () => {
    const { normalizeImportRow } = await import('../importLogsService.js');

    expect(normalizeImportRow(null)).toBeNull();
    expect(normalizeImportRow('https://a.test/')).toBeNull();
    expect(normalizeImportRow([{ url: 'https://a.test/', created_at: NOW }])).toBeNull();
  });
});

describe('extractImportRows shapes (unit)', () => {
  it('prefers rows over later legacy keys', async () => {
    const { extractImportRows } = await import('../importLogsService.js');
    const rows = [{ url: 'https://a.test/', created_at: NOW }];

    expect(extractImportRows({ rows, logs: [{ url: 'https://b.test/', created_at: NOW }] })).toEqual({
      rows,
    });
  });

  it('reports no records when no row container exists', async () => {
    const { extractImportRows } = await import('../importLogsService.js');

    expect(extractImportRows({ version: 2, table: 'browsing_logs' })).toEqual({
      error: 'No records found in file',
    });
  });
});

describe('tolerant report content (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSqliteCall.mockResolvedValue({ data: { inserted: 1, skipped: 0, total: 1 } });
  });

  it('omits the report when every row is valid', async () => {
    const { importFromJsonForMigration } = await import('../importLogsService.js');

    const result = await importFromJsonForMigration(
      JSON.stringify({ logs: [{ url: 'https://a.test/', created_at: NOW }] })
    );

    expect(result).toEqual({ inserted: 1, skipped: 0, total: 1 });
  });

  it('caps invalid samples at three while counting every reason', async () => {
    const { importFromJsonForMigration } = await import('../importLogsService.js');
    const file = JSON.stringify({
      logs: [
        { url: 'https://ok.test/', created_at: NOW },
        { title: 'bad-0' },
        { title: 'bad-1' },
        { title: 'bad-2' },
        { title: 'bad-3' },
        { title: 'bad-4' },
      ],
    });

    const result = await importFromJsonForMigration(file);

    expect(result).toMatchObject({
      total: 1,
      invalid: 5,
      invalidReasons: { 'url must be a non-empty string': 5 },
    });
    expect(result).toHaveProperty('invalidSamples');
    expect((result as { invalidSamples: unknown[] }).invalidSamples).toHaveLength(3);
  });

  it('phrases the zero-valid message with reasons and the first sample', async () => {
    const { importFromJsonForMigration } = await import('../importLogsService.js');
    const file = JSON.stringify({ logs: [{ title: 'no url' }, { url: '', created_at: NOW }] });

    const result = await importFromJsonForMigration(file);

    expect(result).toEqual({
      error:
        'No valid records found (url and created_at required). ' +
        'Invalid rows: 2 (url must be a non-empty string x2). ' +
        'First invalid row at index 0: url must be a non-empty string.',
    });
    expect(mockSqliteCall).not.toHaveBeenCalled();
  });
});
