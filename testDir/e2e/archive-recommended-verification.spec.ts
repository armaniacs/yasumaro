/**
 * E2E: Archive recommended verifications Y3/Y4/Y6/G3/G4/G5
 * (PBI 2026-09-07-02) @extension
 *
 * Real extension + real OPFS SQLite. Y2 and G8 are asserted at the unit
 * level instead (see the manual-test doc for the coverage map):
 * - Y2: src/offscreen/__tests__/archiveFallbackRejection.test.ts
 * - G8: src/offscreen/__tests__/archivePurgeHandlers.test.ts
 *       ('keeps the main DB intact when VACUUM fails (vacuumOk=false)')
 *
 * Y3/G3 reuse the production temp-open flow: Phase A → export bytes →
 * archive_prepare_incoming → write bytes into the OPFS staging file from the
 * page (same origin, mirrors archivePanel.ts) → archive_open → query/update.
 */
import { test, expect } from './fixtures/extension.fixture.js';
import {
  createDashboardSqliteClient,
  isoDateOffset,
  migrationSettled,
  openOptionsPage,
  poll,
  runPhaseA,
  seedRows,
  type DashboardSqliteClient,
} from './fixtures/dashboardSqliteHelpers.js';
import { collectArchiveChunks, openArchiveDb } from './fixtures/archiveDbReader.js';

/** Export a staging file to bytes (token per chunk; staging scope). */
async function exportStagingBytes(
  { dashboardMsg, scopeHash, tokenFor }: DashboardSqliteClient,
  stagingName: string,
  chunkLength = 16 * 1024,
): Promise<Uint8Array> {
  return collectArchiveChunks(async (offset, length) => {
    const token = await tokenFor('archive_export', [stagingName]);
    const res = await dashboardMsg({
      subtype: 'archive_export',
      stagingName,
      offset,
      length,
      confirmToken: token,
      scopeHash: await scopeHash([stagingName]),
    });
    expect(res.success, `archive_export failed: ${JSON.stringify(res)}`).toBe(true);
    return {
      chunk: res.chunk as number[],
      nextOffset: Number(res.nextOffset),
      total: Number(res.total),
      done: Boolean(res.done),
    };
  }, chunkLength);
}

/**
 * Production temp-open flow, minus the file picker: prepare an incoming
 * staging name and write the bytes into the OPFS staging file from the page
 * (same origin — mirrors archivePanel.ts restoreFileInput handler).
 */
async function stageIncomingBytes(
  page: import('@playwright/test').Page,
  { dashboardMsg, tokenFor }: DashboardSqliteClient,
  bytes: Uint8Array,
): Promise<string> {
  const prepToken = await tokenFor('archive_prepare_incoming', []);
  const prep = await dashboardMsg({ subtype: 'archive_prepare_incoming', confirmToken: prepToken });
  expect(prep.success, `archive_prepare_incoming failed: ${JSON.stringify(prep)}`).toBe(true);
  const stagingName = prep.stagingName as string;
  expect(typeof stagingName, `stagingName missing in response: ${JSON.stringify(prep)}`).toBe('string');
  await page.evaluate(async ({ name, chunk }) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(new Uint8Array(chunk));
      await writable.close();
    } catch (err) {
      await writable.abort?.().catch(() => {});
      throw err;
    }
  }, { name: stagingName, chunk: Array.from(bytes) });
  return stagingName;
}

test.describe('Archive recommended verifications (Y3/Y4/Y6/G3/G4/G5) @extension', () => {
  // Pin the locale so chrome.i18n assertions are deterministic.
  test.use({ locale: 'en-US' });

  test('Y3: edited title is written back into the archive .db', async ({ context, extensionId }) => {
    const page = await openOptionsPage(context, extensionId);
    const client = createDashboardSqliteClient(page);
    const stamp = Date.now();
    const editedTitle = `edited-title-${stamp}`;

    await seedRows(client, [
      { url: `https://archive-y3.test/${stamp}`, title: 'original title', summary: 'y3 seed', created_at: Date.UTC(2026, 0, 5, 1, 0, 0), domain: 'archive-y3.test' },
    ]);

    const { stagingName } = await runPhaseA(page, client, isoDateOffset(1));
    const bytes = await exportStagingBytes(client, stagingName);
    const incomingName = await stageIncomingBytes(page, client, bytes);

    const openToken = await client.tokenFor('archive_open', []);
    const openRes = await client.dashboardMsg({ subtype: 'archive_open', stagingName: incomingName, confirmToken: openToken });
    expect(openRes.success, `archive_open failed: ${JSON.stringify(openRes)}`).toBe(true);

    // The staging is incoming now — export the OPEN session bytes (still
    // registered under the incoming name).
    const query = await client.dashboardMsg({
      subtype: 'archive_query', stagingName: incomingName, query: '', limit: 100, offset: 0,
    });
    expect(query.success).toBe(true);
    const row = (query.rows as Array<{ id: number; url: string }>)[0];
    expect(row.url).toBe(`https://archive-y3.test/${stamp}`);

    // archive_update's token binds the row id (same binding as the SW verify).
    const updateToken = await client.tokenFor('archive_update', [], row.id);
    const update = await client.dashboardMsg({
      subtype: 'archive_update', stagingName: incomingName, id: row.id, changes: { title: editedTitle }, confirmToken: updateToken,
    });
    expect(update.success, `archive_update failed: ${JSON.stringify(update)}`).toBe(true);

    const saveToken = await client.tokenFor('archive_save', []);
    const save = await client.dashboardMsg({ subtype: 'archive_save', stagingName: incomingName, confirmToken: saveToken });
    expect(save.success).toBe(true);

    const savedBytes = await exportStagingBytes(client, incomingName);
    const db = openArchiveDb(savedBytes);
    try {
      const titles = db.query<{ title: string | null }>('SELECT title FROM browsing_logs');
      expect(titles.map((r) => r.title)).toContain(editedTitle);
    } finally {
      db.close();
    }

    const closeToken = await client.tokenFor('archive_close', []);
    await client.dashboardMsg({ subtype: 'archive_close', stagingName: incomingName, confirmToken: closeToken });
  });

  test('Y4: restored records match title/url/is_starred at value level', async ({ context, extensionId }) => {
    const page = await openOptionsPage(context, extensionId);
    const client = createDashboardSqliteClient(page);
    const stamp = Date.now();

    await seedRows(client, [
      { url: `https://archive-y4.test/a/${stamp}`, title: 'y4 starred', is_starred: 1, created_at: Date.UTC(2026, 0, 6, 1, 0, 0), domain: 'archive-y4.test' },
      { url: `https://archive-y4.test/b/${stamp}`, title: 'y4 plain', is_starred: 0, created_at: Date.UTC(2026, 0, 5, 1, 0, 0), domain: 'archive-y4.test' },
    ]);

    // Phase A archives both rows; clear_all empties the main DB WITHOUT
    // releasing the staging (Phase B would release it — restore would fail).
    // The restore must re-insert the rows with values intact.
    const { stagingName } = await runPhaseA(page, client, isoDateOffset(1));
    const clearToken = await client.tokenFor('clear_all', []);
    const cleared = await client.dashboardMsg({ subtype: 'clear_all', confirmToken: clearToken });
    expect(cleared.success).toBe(true);

    const restoreToken = await client.tokenFor('archive_restore', [stagingName]);
    const restore = await client.dashboardMsg({
      subtype: 'archive_restore', stagingName, confirmToken: restoreToken, scopeHash: await client.scopeHash([stagingName]),
    });
    expect(restore.success, `archive_restore failed: ${JSON.stringify(restore)}`).toBe(true);
    expect(Number(restore.restored)).toBe(2);

    const queried = await poll(
      () => client.dashboardMsg({ subtype: 'query', domain: 'archive-y4.test', limit: 50 }),
      (r) => r?.success === true && Number(r?.total) >= 2,
    );
    expect(queried.success).toBe(true);
    const byUrl = new Map(
      (queried.rows as Array<{ url: string; title: string | null; is_starred: number }>).map((r) => [r.url, r]),
    );
    const starred = byUrl.get(`https://archive-y4.test/a/${stamp}`);
    const plain = byUrl.get(`https://archive-y4.test/b/${stamp}`);
    expect(starred?.title).toBe('y4 starred');
    expect(Number(starred?.is_starred)).toBe(1);
    expect(plain?.title).toBe('y4 plain');
    expect(Number(plain?.is_starred)).toBe(0);
  });

  test('Y6: restore with deleted rows reports restoredDeleted', async ({ context, extensionId }) => {
    const page = await openOptionsPage(context, extensionId);
    const client = createDashboardSqliteClient(page);
    const stamp = Date.now();

    await seedRows(client, [
      { url: `https://archive-y6.test/live/${stamp}`, title: 'y6 live', created_at: Date.UTC(2026, 0, 6, 1, 0, 0), domain: 'archive-y6.test' },
      { url: `https://archive-y6.test/gone/${stamp}`, title: 'y6 deleted', is_deleted: 1, created_at: Date.UTC(2026, 0, 5, 1, 0, 0), domain: 'archive-y6.test' },
    ]);

    // includeDeleted: the deleted row is archived too.
    const { stagingName, recordCount } = await runPhaseA(page, client, isoDateOffset(1), true);
    expect(recordCount).toBe(2);

    // Empty the main DB so INSERT OR IGNORE cannot skip the deleted row.
    const clearToken = await client.tokenFor('clear_all', []);
    const cleared = await client.dashboardMsg({ subtype: 'clear_all', confirmToken: clearToken });
    expect(cleared.success).toBe(true);

    const restoreToken = await client.tokenFor('archive_restore', [stagingName]);
    const restore = await client.dashboardMsg({
      subtype: 'archive_restore', stagingName, confirmToken: restoreToken, scopeHash: await client.scopeHash([stagingName]),
    });
    expect(restore.success, `archive_restore failed: ${JSON.stringify(restore)}`).toBe(true);
    expect(Number(restore.restored)).toBe(2);
    expect(Number(restore.restoredDeleted)).toBe(1);
  });

  test('G3: archive_query treats % and _ as literals', async ({ context, extensionId }) => {
    const page = await openOptionsPage(context, extensionId);
    const client = createDashboardSqliteClient(page);
    const stamp = Date.now();

    await seedRows(client, [
      { url: `https://archive-g3.test/wild/${stamp}`, title: '100%_done', summary: 'g3 wildcard literal', created_at: Date.UTC(2026, 0, 7, 1, 0, 0), domain: 'archive-g3.test' },
      { url: `https://archive-g3.test/plain/${stamp}`, title: '100Xdone', summary: 'g3 plain', created_at: Date.UTC(2026, 0, 6, 1, 0, 0), domain: 'archive-g3.test' },
    ]);

    const { stagingName } = await runPhaseA(page, client, isoDateOffset(1));
    const bytes = await exportStagingBytes(client, stagingName);
    const incomingName = await stageIncomingBytes(page, client, bytes);

    const openToken = await client.tokenFor('archive_open', []);
    await client.dashboardMsg({ subtype: 'archive_open', stagingName: incomingName, confirmToken: openToken });

    // Literal query "%_": only the verbatim title matches — a broken escape
    // would let "100%_done" as a LIKE pattern also hit "100Xdone".
    const literal = await client.dashboardMsg({
      subtype: 'archive_query', stagingName: incomingName, query: '100%_done', limit: 100, offset: 0,
    });
    expect(literal.success).toBe(true);
    expect(Number(literal.total)).toBe(1);
    expect(((literal.rows as Array<{ title: string }>)[0]).title).toBe('100%_done');

    // Control: a plain substring matches both rows.
    const both = await client.dashboardMsg({
      subtype: 'archive_query', stagingName: incomingName, query: 'done', limit: 100, offset: 0,
    });
    expect(Number(both.total)).toBe(2);
  });

  test('G4: Phase B leaves the legacy savedUrlsWithTimestamps entries intact', async ({ context, extensionId }) => {
    const page = await openOptionsPage(context, extensionId);
    const client = createDashboardSqliteClient(page);
    const stamp = Date.now();
    const legacyUrls = [
      `https://archive-g4.test/1/${stamp}`,
      `https://archive-g4.test/2/${stamp}`,
    ];

    // Settle the deferred legacy migration while the legacy store is still
    // empty, then seed it (the recording-flow write path is the metadataPatch
    // queue; import subtype never touches chrome.storage). Seeding before
    // settling would let the migration move our entries into SQLite and
    // double the purge count.
    await migrationSettled(page, client);
    await page.evaluate((urls) => {
      return chrome.storage.local.set({
        savedUrlsWithTimestamps: urls.map((url) => ({ url, timestamp: Date.now() })),
      });
    }, legacyUrls);

    // The same URLs must exist in SQLite so Phase B actually deletes rows.
    await seedRows(client, legacyUrls.map((url) => ({
      url, title: 'g4 seed', created_at: Date.UTC(2026, 0, 8, 1, 0, 0), domain: 'archive-g4.test',
    })));

    const { stagingName } = await runPhaseA(page, client, isoDateOffset(1));
    const purgeToken = await client.tokenFor('archive_delete_by_staging', [stagingName]);
    const purge = await client.dashboardMsg({
      subtype: 'archive_delete_by_staging', stagingName, confirmToken: purgeToken, scopeHash: await client.scopeHash([stagingName]),
    });
    expect(purge.success).toBe(true);
    expect(Number(purge.deleted)).toBe(2);

    // Legacy store is untouched by the purge (SQLite-only deletion).
    const stored = await page.evaluate(() => chrome.storage.local.get('savedUrlsWithTimestamps'));
    const entries = (stored.savedUrlsWithTimestamps as Array<{ url: string }>) ?? [];
    for (const url of legacyUrls) {
      expect(entries.some((e) => e.url === url), `legacy entry for ${url} must survive`).toBe(true);
    }
  });

  test('G5: archive create runs while a recording is in flight — both succeed', async ({ context, extensionId }) => {
    // Seed privacy consent + settings so the service worker processes the
    // VALID_VISIT (same pre-seed as recording-traceId.spec.ts).
    const sw = context.serviceWorkers()[0];
    await sw.evaluate(async () => {
      await chrome.storage.local.set({
        privacy_consent: { hasConsented: true, consentVersion: '2026-07-31', consentDate: Date.now() },
        privacy_consent_version: '2026-07-31',
        settings_migrated: true,
        settings: {
          obsidian_protocol: 'http',
          obsidian_host: '127.0.0.1',
          obsidian_port: 27123,
          obsidian_daily_path: '',
          ai_provider: 'gemini',
          min_visit_duration: 5,
          min_scroll_depth: 50,
        },
      });
    });

    const page = await openOptionsPage(context, extensionId);
    const client = createDashboardSqliteClient(page);

    const recordingPage = await context.newPage();
    await recordingPage.goto('http://localhost:8080/long-page.html');
    await expect(async () => {
      const attr = await recordingPage.evaluate(() => document.documentElement.getAttribute('data-ow-test-state'));
      if (!attr) throw new Error('extractor not ready');
    }).toPass({ timeout: 10_000, intervals: [200] });

    // Trigger the engagement while archive_create is in flight: the worker
    // serial-queues both, so neither may block or fail the other. The cutoff
    // is yesterday — the in-flight recording lands after it, recordCount=0.
    await recordingPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.7));
    const createPromise = runPhaseA(page, client, isoDateOffset(-1));

    // VALID_VISIT fires after 50% scroll + 5s stay.
    await expect(async () => {
      const state = await recordingPage.evaluate(() => {
        const attr = document.documentElement.getAttribute('data-ow-test-state');
        return attr ? JSON.parse(attr) : null;
      });
      expect(state?.isValidVisitReported).toBe(true);
    }).toPass({ timeout: 15_000, intervals: [1000] });

    const createRes = await createPromise;
    expect(createRes.recordCount).toBe(0);

    // The recording was not blocked by the archive operation: its row lands
    // in SQLite (cloud AI fails gracefully without keys — the row still saves).
    const found = await poll(
      () => client.dashboardMsg({ subtype: 'query', domain: 'localhost', limit: 50 }),
      (r) =>
        r?.success === true &&
        (r.rows as Array<{ url: string }>)?.some((row) => row.url === 'http://localhost:8080/long-page.html'),
      20,
      1500,
    );
    expect(found?.success).toBe(true);
    expect((found.rows as Array<{ url: string }>).some((r) => r.url === 'http://localhost:8080/long-page.html')).toBe(true);
  });
});
