/**
 * E2E: Archive required verifications R1–R3 (PBI 2026-09-07-01) @extension
 *
 * Real extension + real OPFS SQLite, verifying the 🔴 required manual-test
 * items that are fully automatable:
 *
 * - R1  staging .db content: archive_export bytes → better-sqlite3 in the
 *       test process → schema/meta/row asserts (no FTS, id-preserving rows).
 * - R2  boundary-date timezone: fixed-epoch seeds vs a string cutoffDate —
 *       the *relative judgment* (included/excluded) must match the local
 *       end-of-day semantics per timezone. Seeding/cutoff both use fixed
 *       data so a UTC-vs-local conversion bug flips the expected counts.
 * - R3  Phase A leaves the main DB untouched: get_count before/after.
 *
 * R4 (single-flight) is covered at the worker unit level —
 * src/offscreen/__tests__/archiveCreateHandlers.test.ts
 * ('blocks a second concurrent create (single-flight)').
 */
import { test, expect } from './fixtures/extension.fixture.js';
import { createDashboardSqliteClient, localEndOfDayMs, poll } from './fixtures/dashboardSqliteHelpers.js';
import { collectArchiveChunks, openArchiveDb } from './fixtures/archiveDbReader.js';
import { ARCHIVE_FORMAT_VERSION } from '../../src/utils/archiveGuards.js';

test.describe('Archive required verifications (R1-R3) @extension', () => {
  // Pin the locale so chrome.i18n assertions are deterministic (headed
  // Chromium inherits the OS UI language — ja on this machine).
  test.use({ locale: 'en-US' });

  async function openOptionsPage(context: import('@playwright/test').BrowserContext, extensionId: string) {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');
    return page;
  }

  test('R1: exported staging .db matches the archive schema spec', async ({ context, extensionId }) => {
    const page = await openOptionsPage(context, extensionId);
    const { dashboardMsg, scopeHash, tokenFor } = createDashboardSqliteClient(page);

    // --- Seed 3 records (run-unique prefix keeps runs isolated) ---
    const seededUrls = [
      'https://archive-r1.test/1',
      'https://archive-r1.test/2',
      'https://archive-r1.test/3',
    ];
    const seedToken = await tokenFor('import', []);
    const seed = await poll(
      () =>
        dashboardMsg({
          subtype: 'import',
          confirmToken: seedToken,
          rows: seededUrls.map((url, i) => ({
            url,
            title: `r1 seed ${i + 1}`,
            summary: 'r1 e2e seed',
            created_at: Date.UTC(2026, 0, 10, i + 1, 0, 0),
            domain: 'archive-r1.test',
          })),
        }),
      (r) => r?.success === true && Number(r?.inserted) >= 3,
    );
    expect(seed?.success).toBe(true);

    // --- Phase A: archive create with a cutoff covering all seeds ---
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const cutoffDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const cutoffMs = await localEndOfDayMs(page, cutoffDate);
    const createToken = await tokenFor('archive_create', [cutoffMs, false]);
    const createRes = await dashboardMsg({
      subtype: 'archive_create',
      cutoffDate,
      cutoffMs,
      includeDeleted: false,
      yasumaroVersion: '6.7.114',
      confirmToken: createToken,
      scopeHash: await scopeHash([cutoffMs, false]),
    });
    expect(createRes.success).toBe(true);
    const stagingName = createRes.stagingName as string;
    expect(Number(createRes.recordCount)).toBe(3);

    // --- archive_export chunk loop → one byte array ---
    const bytes = await collectArchiveChunks(async (offset, length) => {
      const exportToken = await tokenFor('archive_export', [stagingName]);
      const res = await dashboardMsg({
        subtype: 'archive_export',
        stagingName,
        offset,
        length,
        confirmToken: exportToken,
        scopeHash: await scopeHash([stagingName]),
      });
      expect(res.success, `archive_export failed: ${JSON.stringify(res)}`).toBe(true);
      return {
        chunk: res.chunk as number[],
        nextOffset: Number(res.nextOffset),
        total: Number(res.total),
        done: Boolean(res.done),
      };
    }, 16 * 1024);
    expect(bytes.length).toBeGreaterThan(0);

    // --- Open the exported bytes with real SQLite in the test process ---
    const db = openArchiveDb(bytes);
    try {
      expect(db.countBrowsingLogs()).toBe(3);

      const meta = db.getMeta();
      expect(Number(meta.record_count)).toBe(3);
      expect(Number(meta.archive_format_version)).toBe(ARCHIVE_FORMAT_VERSION);
      expect(Number(meta.include_deleted)).toBe(0);
      expect(meta.cutoff_date).toBe(cutoffDate);
      expect(Number(meta.cutoff_created_at)).toBe(cutoffMs);
      expect(Number(meta.max_id_at_archive)).toBeGreaterThan(0);

      // id-preserving rows: the seeded urls land verbatim, ids ascending.
      const rows = db.query<{ id: number; url: string; title: string }>(
        'SELECT id, url, title FROM browsing_logs ORDER BY id',
      );
      expect(rows.map((r) => r.url)).toEqual(seededUrls);

      // Archive schema: browsing_logs + yasumaro_archive_meta + indexes —
      // NO FTS tables, NO triggers (main-DB FTS5 must never leak into archives).
      const objects = db.getSchemaObjects();
      expect(objects.filter((o) => o.name.includes('fts'))).toEqual([]);
      expect(objects.filter((o) => o.type === 'trigger')).toEqual([]);
      expect(objects.map((o) => o.name)).toEqual(
        expect.arrayContaining(['browsing_logs', 'yasumaro_archive_meta']),
      );
    } finally {
      db.close();
    }
  });

  for (const [tz, expectedTotal, expectsNewest] of [
    ['Asia/Tokyo', 1, false], // UTC+9: B (18:00Z) is already Jan 16 local → excluded
    ['Pacific/Kiritimati', 1, false], // UTC+14: B is Jan 16 08:00 local → excluded
    ['America/Los_Angeles', 2, true], // UTC-8: B is Jan 15 10:00 local → included
  ] as const) {
    test.describe(`R2: boundary-date judgment in ${tz}`, () => {
      test.use({ timezoneId: tz });

      test(`fixed-epoch seeds vs string cutoffDate → total=${expectedTotal}`, async ({ context, extensionId }) => {
        const page = await openOptionsPage(context, extensionId);
        const { dashboardMsg, scopeHash, tokenFor } = createDashboardSqliteClient(page);

        // Fixed epochs — absolute instants, TZ-independent by construction.
        // A = 2026-01-15T00:00:00Z, B = 2026-01-15T18:00:00Z. The judgment
        // under test: with cutoffDate='2026-01-15' (local end-of-day), A is
        // included in every TZ while B is included ONLY in western TZs —
        // a cutoff derived as UTC end-of-day would include B everywhere.
        const epochA = Date.UTC(2026, 0, 15, 0, 0, 0);
        const epochB = Date.UTC(2026, 0, 15, 18, 0, 0);
        const seedToken = await tokenFor('import', []);
        const seed = await poll(
          () =>
            dashboardMsg({
              subtype: 'import',
              confirmToken: seedToken,
              rows: [
                { url: 'https://archive-r2.test/a', title: 'r2 A', created_at: epochA, domain: 'archive-r2.test' },
                { url: 'https://archive-r2.test/b', title: 'r2 B', created_at: epochB, domain: 'archive-r2.test' },
              ],
            }),
          (r) => r?.success === true && Number(r?.inserted) >= 2,
        );
        expect(seed?.success).toBe(true);

        // The client derives cutoffMs from the string with the page-local
        // formula (production behavior); the worker re-derives and requires
        // an exact match — resolveCutoffMs is the TZ-sensitive code path.
        const cutoffDate = '2026-01-15';
        const cutoffMs = await localEndOfDayMs(page, cutoffDate);

        const preview = await poll(
          () =>
            dashboardMsg({
              subtype: 'archive_preview',
              cutoffDate,
              cutoffMs,
              includeDeleted: false,
            }),
          (r) => r?.success === true,
        );
        expect(preview?.success).toBe(true);
        const data = preview?.preview as { total: number; oldest: number | null; newest: number | null };
        expect(Number(data.total)).toBe(expectedTotal);
        expect(data.oldest).toBe(epochA);
        expect(data.newest).toBe(expectsNewest ? epochB : epochA);
      });
    });
  }

  test('R3: Phase A does not delete anything from the main DB', async ({ context, extensionId }) => {
    const page = await openOptionsPage(context, extensionId);
    const { dashboardMsg, scopeHash, tokenFor } = createDashboardSqliteClient(page);

    const seedToken = await tokenFor('import', []);
    const seed = await poll(
      () =>
        dashboardMsg({
          subtype: 'import',
          confirmToken: seedToken,
          rows: Array.from({ length: 5 }, (_, i) => ({
            url: `https://archive-r3.test/${i + 1}`,
            title: `r3 seed ${i + 1}`,
            created_at: Date.UTC(2026, 0, 20, i + 1, 0, 0),
            domain: 'archive-r3.test',
          })),
        }),
      (r) => r?.success === true && Number(r?.inserted) >= 5,
    );
    expect(seed?.success).toBe(true);

    const getCount = () => dashboardMsg({ subtype: 'get_count' });
    const before = await poll(getCount, (r) => r?.success === true);
    expect(before?.success).toBe(true);
    const countBefore = Number(before?.count);

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const cutoffDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const cutoffMs = await localEndOfDayMs(page, cutoffDate);
    const createToken = await tokenFor('archive_create', [cutoffMs, false]);
    const createRes = await dashboardMsg({
      subtype: 'archive_create',
      cutoffDate,
      cutoffMs,
      includeDeleted: false,
      yasumaroVersion: '6.7.114',
      confirmToken: createToken,
      scopeHash: await scopeHash([cutoffMs, false]),
    });
    expect(createRes.success).toBe(true);
    expect(Number(createRes.recordCount)).toBe(5);

    const after = await getCount();
    expect(after?.success).toBe(true);
    // Phase A is SELECT-only: the main DB row count is untouched.
    expect(Number(after?.count)).toBe(countBefore);
  });
});
