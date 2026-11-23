/**
 * E2E: encrypted split-backup screen round-trip @extension
 *
 * The split export path (manifest plus part files) is driven with a few
 * history rows only: no heavy DB generation. The small multi-part shape is
 * forced with a small chunkChars (the same option the codec unit tests use),
 * because the panel's automatic single-to-split fallback only triggers past
 * the 50MB backup envelope cap, which is out of scope for an E2E run.
 * Crypto runs through the real split codec on real page state (real
 * settings plus real DB bytes); import and the forged-manifest guidance go
 * through the real panel UI (setInputFiles plus the password modal).
 * The written files use the exact panel download contract: the manifest and
 * part JSON wrappers with the unified filename stem (see
 * buildSplitDownloadNames in encryptedBackupPanel.ts).
 *
 * Waiting uses Playwright auto-wait and expect.poll only.
 */
import { testInteraction as test, expect } from './fixtures/dashboard.fixture.js';
import {
  createDashboardSqliteClient,
  migrationSettled,
} from './fixtures/dashboardSqliteHelpers.js';
import { createSplitBackup } from '../../src/dashboard/encryptedBackupSplitCodec.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

test.use({ locale: 'en-US' });

const PASSWORD = 'E2eSplitP@ss1';
// Mirrors BACKUP_PAYLOAD_VERSION in encryptedBackupService.ts. That module
// reaches chrome.storage at import time, so this spec pins the literal
// instead of importing it.
const BACKUP_PAYLOAD_VERSION = 1;
const MARKER_VALUE = 47;
const CHANGED_MARKER_VALUE = 99;
const SPLIT_FILE_MIME = 'application/json';
const HISTORY_DOMAIN = 'split-backup-e2e.test';
const HISTORY_URLS = [
  'https://split-backup-e2e.test/1',
  'https://split-backup-e2e.test/2',
  'https://split-backup-e2e.test/3',
];

interface SplitFileSet {
  dir: string;
  manifestName: string;
  manifestJson: string;
  partNames: string[];
  partJsons: string[];
  total: number;
}

async function gotoBackupPanel(page: Page): Promise<void> {
  await page.locator('[data-panel="panel-export-import"]').click();
  await expect(page.locator('#exportEncryptedBackupBtn')).toBeVisible();
}

/**
 * The encrypted-backup password modal verifies the master password first
 * (pre-existing product behavior: backup import/export requires master
 * protection). Register the same PASSWORD as the master password so the
 * modal verification passes and the backup decrypts with it.
 */
async function ensureMasterPassword(page: Page): Promise<void> {
  // Settings children stay collapsed until Initial Setup is pressed.
  await page.locator('button[data-panel="panel-general"]').click();
  await page.locator('button[data-panel="panel-privacy"]').click();
  await expect(page.locator('#masterPasswordEnabled')).toBeVisible();
  const enabled = await page.locator('#masterPasswordEnabled').isChecked();
  if (enabled) return;
  await page.locator('#masterPasswordEnabled').check();
  await expect(page.locator('#passwordModal')).toBeVisible();
  await page.locator('#masterPasswordInput').fill(PASSWORD);
  await page.locator('#masterPasswordConfirm').fill(PASSWORD);
  await page.locator('#savePasswordBtn').click();
  await expect(page.locator('#status')).toContainText(/kept|保持/, { timeout: 60_000 });
}

async function seedHistoryAndMarker(page: Page): Promise<void> {
  const client = createDashboardSqliteClient(page);
  await migrationSettled(page, client);
  const seedToken = await client.tokenFor('import', []);
  const seed = await client.dashboardMsg({
    subtype: 'import',
    confirmToken: seedToken,
    rows: HISTORY_URLS.map((url, index) => ({
      url,
      title: `split e2e ${index + 1}`,
      summary: 'split e2e seed',
      created_at: Date.UTC(2026, 5, 1, 12, index, 0),
      domain: HISTORY_DOMAIN,
    })),
  });
  expect(seed?.success, `seed failed: ${JSON.stringify(seed)}`).toBe(true);
  expect(Number(seed?.inserted)).toBeGreaterThanOrEqual(HISTORY_URLS.length);

  await page.evaluate((marker: number) => {
    return chrome.storage.local.get('settings').then((stored) => {
      const current = (stored['settings'] as Record<string, unknown>) ?? {};
      return chrome.storage.local.set({
        settings: { ...current, min_visit_duration: marker },
      });
    });
  }, MARKER_VALUE);
}

function bytesToBase64(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof Uint8Array) return Buffer.from(data).toString('base64');
  if (Array.isArray(data)) return Buffer.from(data as number[]).toString('base64');
  return Buffer.from(Object.values(data as Record<string, number>)).toString('base64');
}

/** Real page state (settings plus DB bytes) for the split export. */
async function readBackupPayload(page: Page): Promise<{ settings: unknown; historyDbBase64: string }> {
  const settings = await page.evaluate(() => {
    return chrome.storage.local.get('settings').then((stored) => stored['settings'] ?? {});
  });
  const client = createDashboardSqliteClient(page);
  const backupToken = await client.tokenFor('backup_db', []);
  const backup = await client.dashboardMsg({ subtype: 'backup_db', confirmToken: backupToken });
  expect(backup?.success, `backup_db failed: ${JSON.stringify(backup)?.slice(0, 200)}`).toBe(true);
  return { settings, historyDbBase64: bytesToBase64(backup?.data) };
}

/**
 * Split export through the real codec on real page state. chunkChars starts
 * small and adapts until a tiny DB yields a genuine multi-part container
 * (2..16 parts), so the manifest-plus-parts shape holds at small scale.
 */
async function buildSplitFileSet(page: Page, password: string): Promise<SplitFileSet> {
  const payload = await readBackupPayload(page);
  let chunkChars = 1024;
  let total = 0;
  let container = await createSplitBackup(
    {
      version: BACKUP_PAYLOAD_VERSION,
      exportedAt: new Date().toISOString(),
      settings: payload.settings,
      historyDbBase64: payload.historyDbBase64,
    },
    password,
    { chunkChars },
  );
  for (let attempt = 0; attempt < 5 && container.parts.length < 2; attempt += 1) {
    chunkChars = Math.max(16, Math.floor(chunkChars / 4));
    container = await createSplitBackup(
      {
        version: BACKUP_PAYLOAD_VERSION,
        exportedAt: new Date().toISOString(),
        settings: payload.settings,
        historyDbBase64: payload.historyDbBase64,
      },
      password,
      { chunkChars },
    );
  }
  total = container.parts.length;

  const dir = await mkdtemp(join(tmpdir(), 'split-backup-e2e-'));
  // Filename rule mirrors buildSplitDownloadNames in encryptedBackupPanel.ts.
  const stem = 'yasumaro-backup-e2e.encrypted.json'.replace(/\.encrypted\.json$/, '');
  const manifestName = `${stem}.manifest.encrypted.json`;
  const partNames = container.parts.map((_, index) => `${stem}.part-${index}-of-${total}.encrypted.json`);
  const manifestJson = JSON.stringify(
    {
      kind: 'yasumaro-split-backup-manifest',
      formatVersion: 1,
      total,
      manifest: container.manifest,
    },
    null,
    2,
  );
  const partJsons = container.parts.map((part, index) =>
    JSON.stringify(
      {
        kind: 'yasumaro-split-backup-part',
        formatVersion: 1,
        index,
        total,
        part,
      },
      null,
      2,
    ),
  );
  await writeFile(join(dir, manifestName), manifestJson);
  for (const [index, partJson] of partJsons.entries()) {
    await writeFile(join(dir, partNames[index]!), partJson);
  }
  return { dir, manifestName, manifestJson, partNames, partJsons, total };
}

async function setSplitInputFiles(page: Page, files: SplitFileSet): Promise<void> {
  await page
    .locator('#importEncryptedBackupFileInput')
    .evaluate((el) => el.setAttribute('multiple', ''));
  await page.locator('#importEncryptedBackupFileInput').setInputFiles([
    { name: files.manifestName, mimeType: SPLIT_FILE_MIME, buffer: Buffer.from(files.manifestJson) },
    ...files.partJsons.map((json, index) => ({
      name: files.partNames[index]!,
      mimeType: SPLIT_FILE_MIME,
      buffer: Buffer.from(json),
    })),
  ]);
}

async function submitImportPassword(page: Page, password: string): Promise<void> {
  await expect(page.locator('#passwordAuthModal')).toBeVisible();
  await page.locator('#masterPasswordAuthInput').fill(password);
  await page.locator('#submitPasswordAuthBtn').click();
}

async function readMarker(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    return chrome.storage.local.get('settings').then((stored) => {
      return (stored['settings'] as Record<string, unknown>)?.['min_visit_duration'];
    });
  });
}

async function queryHistoryUrls(page: Page): Promise<string[]> {
  const client = createDashboardSqliteClient(page);
  const res = await client.dashboardMsg({ subtype: 'query', limit: 50, domain: HISTORY_DOMAIN });
  const data = (res?.data ?? res) as { rows?: Array<{ url?: string }> };
  return (data.rows ?? []).map((row) => String(row.url ?? ''));
}

async function queryHistoryCount(page: Page): Promise<number> {
  const client = createDashboardSqliteClient(page);
  const res = await client.dashboardMsg({ subtype: 'get_count' });
  const raw = (res?.data ?? res?.count ?? res?.total) as unknown;
  return Number(raw);
}

test.describe('Encrypted split backup round-trip @extension', () => {
  test('split export of a few rows produces manifest plus part files', async ({
    dashboardPage: page,
  }) => {
    test.setTimeout(120_000);
    await seedHistoryAndMarker(page);
    const files = await buildSplitFileSet(page, PASSWORD);

    expect(files.total).toBeGreaterThan(1);

    const manifest = JSON.parse(files.manifestJson) as Record<string, unknown>;
    expect(manifest['kind']).toBe('yasumaro-split-backup-manifest');
    expect(manifest['formatVersion']).toBe(1);
    expect(manifest['total']).toBe(files.total);
    expect(files.manifestName).toMatch(/\.manifest\.encrypted\.json$/);

    const stem = files.manifestName.replace(/\.manifest\.encrypted\.json$/, '');
    expect(files.partNames).toHaveLength(files.total);
    for (const [index, partJson] of files.partJsons.entries()) {
      const part = JSON.parse(partJson) as Record<string, unknown>;
      expect(part['kind']).toBe('yasumaro-split-backup-part');
      expect(part['index']).toBe(index);
      expect(part['total']).toBe(files.total);
      expect(files.partNames[index]).toBe(`${stem}.part-${index}-of-${files.total}.encrypted.json`);
    }
  });

  test('restoring the split files brings back settings and history', async ({
    dashboardPage: page,
  }) => {
    test.setTimeout(180_000);
    await seedHistoryAndMarker(page);
    const files = await buildSplitFileSet(page, PASSWORD);
    expect(files.total).toBeGreaterThan(1);

    // Diverge from the exported state so the import must restore it.
    await page.evaluate((marker: number) => {
      return chrome.storage.local.get('settings').then((stored) => {
        const current = (stored['settings'] as Record<string, unknown>) ?? {};
        return chrome.storage.local.set({
          settings: { ...current, min_visit_duration: marker },
        });
      });
    }, CHANGED_MARKER_VALUE);
    const client = createDashboardSqliteClient(page);
    const clearToken = await client.tokenFor('clear_all', []);
    const cleared = await client.dashboardMsg({ subtype: 'clear_all', confirmToken: clearToken });
    expect(cleared?.success, `clear_all failed: ${JSON.stringify(cleared)}`).toBe(true);
    await expect.poll(() => queryHistoryCount(page), { timeout: 30_000 }).toBe(0);

    await ensureMasterPassword(page);
    await gotoBackupPanel(page);
    await setSplitInputFiles(page, files);
    await submitImportPassword(page, PASSWORD);
    await expect(page.locator('#encryptedBackupStatus')).toContainText(/Restored from backup|復元/, {
      timeout: 60_000,
    });

    await expect.poll(() => readMarker(page), { timeout: 60_000 }).toBe(MARKER_VALUE);
    await expect
      .poll(() => queryHistoryUrls(page), { timeout: 60_000 })
      .toEqual(expect.arrayContaining(HISTORY_URLS));
  });

  test('a forged manifest is guided before any decryption', async ({
    dashboardPage: page,
  }) => {
    await seedHistoryAndMarker(page);
    const files = await buildSplitFileSet(page, PASSWORD);
    expect(files.total).toBeGreaterThan(1);

    // Forge the outer wrapper totals (2 -> 3) while keeping both part
    // envelopes untouched: the panel must report the missing part before
    // the password prompt, without touching the KDF.
    const forgedTotal = files.total + 1;
    const forgedManifest = JSON.stringify({
      ...(JSON.parse(files.manifestJson) as Record<string, unknown>),
      total: forgedTotal,
    });
    const forgedParts = files.partJsons.map((json) =>
      JSON.stringify({
        ...(JSON.parse(json) as Record<string, unknown>),
        total: forgedTotal,
      }),
    );

    await gotoBackupPanel(page);
    await page
      .locator('#importEncryptedBackupFileInput')
      .evaluate((el) => el.setAttribute('multiple', ''));
    await page.locator('#importEncryptedBackupFileInput').setInputFiles([
      { name: files.manifestName, mimeType: SPLIT_FILE_MIME, buffer: Buffer.from(forgedManifest) },
      ...forgedParts.map((json, index) => ({
        name: files.partNames[index]!,
        mimeType: SPLIT_FILE_MIME,
        buffer: Buffer.from(json),
      })),
    ]);

    await expect(page.locator('#encryptedBackupStatus')).toContainText(/missing part/, {
      timeout: 15_000,
    });
    await expect(page.locator('#passwordAuthModal')).not.toBeVisible();
  });
});
