import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { GENERAL_SETTINGS_SCHEMA } from '../settingsSchemas.js';
import { StorageKeys } from '../storage/types.js';

const ROOT = join(__dirname, '../../..');
const OPTIONS_HTML_PATH = join(ROOT, 'entrypoints/options/index.html');

describe('GENERAL_SETTINGS_SCHEMA', () => {
  it('contains CONTENT_STORAGE_ENABLED as a checkbox binding', () => {
    const entry = GENERAL_SETTINGS_SCHEMA.find((s) => s.key === StorageKeys.CONTENT_STORAGE_ENABLED);
    expect(entry).toBeDefined();
    expect(entry?.type).toBe('checkbox');
  });

  it('binds content_storage_enabled in the dashboard options HTML (typo guard)', () => {
    const html = readFileSync(OPTIONS_HTML_PATH, 'utf8');
    expect(html).toContain(`data-storage-key="${StorageKeys.CONTENT_STORAGE_ENABLED}"`);
  });

  it('has contentStorageEnabledLabel in both locales (en/ja)', () => {
    for (const locale of ['en', 'ja']) {
      const messages = JSON.parse(
        readFileSync(join(ROOT, `public/_locales/${locale}/messages.json`), 'utf8'),
      );
      expect(messages.contentStorageEnabledLabel?.message, `${locale} label`).toBeTruthy();
    }
  });
});
