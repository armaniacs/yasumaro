/**
 * E2E: History Archive end-to-end (PBI 2026-09-06-02/03/04) @extension
 *
 * Real extension + real OPFS SQLite round-trip:
 *   seed → archive create (phase A, staging) → restore (duplicates skipped) →
 *   create again → purge (phase B deletes from main) → boundary count = 0.
 *
 * UI smoke: the Archive panel preview is driven through the real UI.
 * The bulk operations run via DASHBOARD_SQLITE with confirm tokens whose
 * scopeHash is derived in-page (mirroring dashboardGateway).
 *
 * Download verification (ARCHIVE_EXPORT chunk → download event) is covered by
 * unit tests; the Playwright download event does not fire for extension-page
 * anchor downloads in this setup (investigated 2026-09-06).
 */
import { test, expect } from './fixtures/extension.fixture.js';

async function poll<T>(
  fn: () => Promise<T>,
  check: (v: T) => boolean,
  maxAttempts = 8,
  delayMs = 500,
): Promise<T> {
  let last: T;
  for (let i = 0; i < maxAttempts; i++) {
    last = await fn();
    if (check(last)) return last;
    if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return last!;
}

const IMPORTED_URLS = ['https://archive-e2e.test/1', 'https://archive-e2e.test/2', 'https://archive-e2e.test/3'];

test.describe('History Archive E2E @extension', () => {
  // Pin the locale so chrome.i18n assertions are deterministic (headed
  // Chromium inherits the OS UI language — ja on this machine).
  test.use({ locale: 'en-US' });

  test('archive create → restore (duplicates skipped) → purge deletes from main', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');

    const dashboardMsg = (payload: Record<string, unknown>) =>
      page.evaluate(async (p) => {
        return (await chrome.runtime.sendMessage({ type: 'DASHBOARD_SQLITE', payload: p })) as Record<string, unknown>;
      }, payload);

    const scopeHash = (parts: (string | number | undefined)[]) =>
      page.evaluate(async (joined: string) => {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(joined));
        return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
      }, parts.map((p) => (p === undefined || p === null ? '' : String(p))).join('|'));

    const tokenFor = async (action: string, scopeParts: (string | number | undefined)[]): Promise<string> => {
      // Non-archive actions (e.g. import) derive no scope on the SW side —
      // sending a hash there would fail the strict compare. Omit it instead.
      const tokenScopeHash = scopeParts.length > 0 ? await scopeHash(scopeParts) : undefined;
      const res = await dashboardMsg({
        subtype: 'create_confirm_token',
        action,
        ...(tokenScopeHash !== undefined ? { scopeHash: tokenScopeHash } : {}),
      });
      expect(res.success).toBe(true);
      return res.confirmToken as string;
    };

    // --- Seed 3 records via import (create_confirm_token pattern) ---
    const seedToken = await tokenFor('import', []);
    const seed = await poll(
      () =>
        dashboardMsg({
          subtype: 'import',
          confirmToken: seedToken,
          rows: IMPORTED_URLS.map((url, i) => ({
            url,
            title: `archive e2e ${i + 1}`,
            summary: 'e2e seed',
            created_at: Date.now() - (3 - i) * 60000,
            domain: 'archive-e2e.test',
          })),
        }),
      (r) => r?.success === true && Number(r?.inserted) >= 3,
    );
    expect(seed?.success).toBe(true);

    // --- UI smoke: Archive panel preview through the real UI ---
    await page.locator('[data-panel="panel-archive"]').click();
    const dateInput = page.locator('#archive-date');
    await expect(dateInput).toBeVisible();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const isoTomorrow = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    await dateInput.fill(isoTomorrow);

    await page.locator('#archive-preview-btn').click();
    // Locale-agnostic: headed Chromium inherits the OS UI language.
    await expect(page.locator('#archive-preview-summary')).toContainText(
      /Records to archive: 3|対象: 3件/,
      { timeout: 15000 },
    );

    // --- Phase A: archive create (direct, scopeHash-bound token) ---
    const cutoffMs = new Date(
      tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59, 999,
    ).getTime();
    const createScope = await scopeHash([cutoffMs, false]);
    const createToken = await tokenFor('archive_create', [cutoffMs, false]);
    const createRes = await dashboardMsg({
      subtype: 'archive_create',
      cutoffDate: isoTomorrow,
      cutoffMs,
      includeDeleted: false,
      yasumaroVersion: '6.7.114',
      confirmToken: createToken,
      scopeHash: createScope,
    });
    expect(createRes.success).toBe(true);
    const stagingName = createRes.stagingName as string;
    expect(stagingName).toMatch(/^archive_outgoing_[A-Za-z0-9-]{36}\.db$/);
    expect(Number(createRes.recordCount)).toBe(3);

    // --- Restore from the staging (duplicates → all skipped) ---
    const restorePreviewToken = await tokenFor('archive_restore_preview', [stagingName]);
    const restorePreview = await dashboardMsg({
      subtype: 'archive_restore_preview',
      stagingName,
      confirmToken: restorePreviewToken,
      scopeHash: await scopeHash([stagingName]),
    });
    expect(restorePreview.success).toBe(true);
    expect(Number((restorePreview.preview as { recordCount: number }).recordCount)).toBe(3);

    const restoreToken = await tokenFor('archive_restore', [stagingName]);
    const restoreRes = await dashboardMsg({
      subtype: 'archive_restore',
      stagingName,
      confirmToken: restoreToken,
      scopeHash: await scopeHash([stagingName]),
    });
    expect(restoreRes.success).toBe(true);
    expect(Number(restoreRes.restored)).toBe(0);
    expect(Number(restoreRes.skipped)).toBe(3);

    // --- Phase A again (the rows are still in main) ---
    const createToken2 = await tokenFor('archive_create', [cutoffMs, false]);
    const createRes2 = await dashboardMsg({
      subtype: 'archive_create',
      cutoffDate: isoTomorrow,
      cutoffMs,
      includeDeleted: false,
      yasumaroVersion: '6.7.114',
      confirmToken: createToken2,
      scopeHash: createScope,
    });
    expect(createRes2.success).toBe(true);
    const stagingName2 = createRes2.stagingName as string;

    // --- Phase B: purge deletes the 3 rows from the main DB ---
    const purgeToken = await tokenFor('archive_delete_by_staging', [stagingName2]);
    const purgeRes = await dashboardMsg({
      subtype: 'archive_delete_by_staging',
      stagingName: stagingName2,
      confirmToken: purgeToken,
      scopeHash: await scopeHash([stagingName2]),
    });
    console.log('PURGE-RES:', JSON.stringify(purgeRes).slice(0, 300));
    expect(purgeRes.success).toBe(true);
    expect(Number(purgeRes.deleted)).toBe(3);

    // --- Boundary count drops to 0 for the seeded URLs ---
    const previewAfter = await poll(
      () =>
        page.evaluate(async ({ cutoffDate, cutoffMs }) => {
          return (await chrome.runtime.sendMessage({
            type: 'DASHBOARD_SQLITE',
            payload: { subtype: 'archive_preview', cutoffDate, cutoffMs, includeDeleted: true },
          })) as Record<string, unknown>;
        }, { cutoffDate: isoTomorrow, cutoffMs: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59, 999).getTime() }),
      (r) => r?.success === true,
      8,
      500,
    );
    console.log('PREVIEW-AFTER:', JSON.stringify(previewAfter).slice(0, 300));
    expect(previewAfter?.success).toBe(true);
    // 0 records from archive-e2e remain; other rows (if any) may exist.
    const previewData = (previewAfter?.preview as { oldest: number | null }) ?? { oldest: null };
    // The seeded rows were the only rows in this fresh test DB (unique prefix,
    // isolated per test run) — oldest should now be null.
    expect(previewData.oldest).toBeNull();
  });
});
