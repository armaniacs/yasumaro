// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../dashboardSqliteService.js', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    purgeOldRecordsNow: vi.fn(),
    purgeContentNow: vi.fn(),
  };
});

import { handlePurgeNow, handleContentPurgeNow } from '../settingsForm.js';
import * as sqliteService from '../../dashboardSqliteService.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const enMessages = JSON.parse(
  readFileSync(join(repoRoot, 'public', '_locales', 'en', 'messages.json'), 'utf-8'),
) as Record<string, { message: string }>;
const jaMessages = JSON.parse(
  readFileSync(join(repoRoot, 'public', '_locales', 'ja', 'messages.json'), 'utf-8'),
) as Record<string, { message: string }>;

function localeMessage(table: Record<string, { message: string }>, key: string): string {
  const entry = table[key];
  if (!entry) throw new Error(`missing locale key: ${key}`);
  return entry.message;
}

let activeLocale: 'en' | 'ja' = 'en';

function stubChromeI18n(): void {
  const tables = { en: enMessages, ja: jaMessages };
  vi.stubGlobal('chrome', {
    i18n: {
      getMessage: (key: string) => tables[activeLocale][key]?.message ?? '',
    },
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('settingsForm purge failure locales', () => {
  describe('locale pin', () => {
    it('registers purgeNowFailed in both locales with non-empty copy', () => {
      expect(localeMessage(enMessages, 'purgeNowFailed')).toBeTruthy();
      expect(localeMessage(jaMessages, 'purgeNowFailed')).toBeTruthy();
    });

    it('registers contentPurgeNowFailed in both locales with non-empty copy', () => {
      expect(localeMessage(enMessages, 'contentPurgeNowFailed')).toBeTruthy();
      expect(localeMessage(jaMessages, 'contentPurgeNowFailed')).toBeTruthy();
    });
  });

  describe('handlePurgeNow', () => {
    it('shows the Japanese copy with the technical reason when purge rejects', async () => {
      activeLocale = 'ja';
      stubChromeI18n();
      document.body.innerHTML = '<button id="purgeNowBtn"></button><span id="purgeNowStatus"></span>';
      vi.mocked(sqliteService.purgeOldRecordsNow).mockRejectedValue(new Error('boom'));
      await handlePurgeNow();
      const status = document.getElementById('purgeNowStatus')!;
      expect(status.textContent).toBe(`${localeMessage(jaMessages, 'purgeNowFailed')}: boom`);
    });

    it('shows the English copy with the technical reason when purge rejects', async () => {
      activeLocale = 'en';
      stubChromeI18n();
      document.body.innerHTML = '<button id="purgeNowBtn"></button><span id="purgeNowStatus"></span>';
      vi.mocked(sqliteService.purgeOldRecordsNow).mockRejectedValue(new Error('boom'));
      await handlePurgeNow();
      const status = document.getElementById('purgeNowStatus')!;
      expect(status.textContent).toBe(`${localeMessage(enMessages, 'purgeNowFailed')}: boom`);
    });

    it('falls back to the English default and keeps the reason when the key is missing', async () => {
      vi.stubGlobal('chrome', { i18n: { getMessage: () => '' } });
      document.body.innerHTML = '<button id="purgeNowBtn"></button><span id="purgeNowStatus"></span>';
      vi.mocked(sqliteService.purgeOldRecordsNow).mockRejectedValue(new Error('boom'));
      await handlePurgeNow();
      expect(document.getElementById('purgeNowStatus')!.textContent).toBe('Purge failed: boom');
    });

    it('shows only the localized copy when the service reason is empty', async () => {
      activeLocale = 'ja';
      stubChromeI18n();
      document.body.innerHTML = '<button id="purgeNowBtn"></button><span id="purgeNowStatus"></span>';
      vi.mocked(sqliteService.purgeOldRecordsNow).mockResolvedValue({ error: '' } as never);
      await handlePurgeNow();
      expect(document.getElementById('purgeNowStatus')!.textContent).toBe(
        localeMessage(jaMessages, 'purgeNowFailed'),
      );
    });
  });

  describe('handleContentPurgeNow', () => {
    it('shows the Japanese copy with the technical reason when content purge rejects', async () => {
      activeLocale = 'ja';
      stubChromeI18n();
      document.body.innerHTML =
        '<button id="contentPurgeNowBtn"></button><span id="contentPurgeNowStatus"></span>';
      vi.mocked(sqliteService.purgeContentNow).mockRejectedValue(new Error('boom'));
      await handleContentPurgeNow();
      const status = document.getElementById('contentPurgeNowStatus')!;
      expect(status.textContent).toBe(`${localeMessage(jaMessages, 'contentPurgeNowFailed')}: boom`);
    });

    it('shows the English copy with the technical reason when content purge rejects', async () => {
      activeLocale = 'en';
      stubChromeI18n();
      document.body.innerHTML =
        '<button id="contentPurgeNowBtn"></button><span id="contentPurgeNowStatus"></span>';
      vi.mocked(sqliteService.purgeContentNow).mockRejectedValue(new Error('boom'));
      await handleContentPurgeNow();
      const status = document.getElementById('contentPurgeNowStatus')!;
      expect(status.textContent).toBe(`${localeMessage(enMessages, 'contentPurgeNowFailed')}: boom`);
    });

    it('falls back to the English default and keeps the reason when the key is missing', async () => {
      vi.stubGlobal('chrome', { i18n: { getMessage: () => '' } });
      document.body.innerHTML =
        '<button id="contentPurgeNowBtn"></button><span id="contentPurgeNowStatus"></span>';
      vi.mocked(sqliteService.purgeContentNow).mockRejectedValue(new Error('boom'));
      await handleContentPurgeNow();
      expect(document.getElementById('contentPurgeNowStatus')!.textContent).toBe(
        'Content purge failed: boom',
      );
    });
  });
});
