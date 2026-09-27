/**
 * The rollout gate is a user-facing setting, so every layer that can silently
 * drop one is pinned here: the storage key name, the default, the schema entry
 * (an unregistered key is dropped on save), the HTML binding, and both locales.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { GENERAL_SETTINGS_SCHEMA } from '../settingsSchemas.js';
import { StorageKeys } from '../storage/types.js';
import { DEFAULT_SETTINGS } from '../storage/defaults.js';

const ROOT = join(__dirname, '../../..');
const OPTIONS_HTML_PATH = join(ROOT, 'entrypoints/options/index.html');

function localeMessages(locale: string): Record<string, { message?: string }> {
  return JSON.parse(
    readFileSync(join(ROOT, `public/_locales/${locale}/messages.json`), 'utf8'),
  ) as Record<string, { message?: string }>;
}

describe('AI provider breaker rollout gate (PBI 27-07)', () => {
  it('stores the flag under its documented key', () => {
    expect(StorageKeys.AI_PROVIDER_BREAKER_ENABLED).toBe('ai_provider_breaker_enabled');
  });

  it('defaults to enabled so the agreed breaker behaviour is unchanged', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.AI_PROVIDER_BREAKER_ENABLED]).toBe(true);
  });

  it('contains AI_PROVIDER_BREAKER_ENABLED as a checkbox binding', () => {
    const entry = GENERAL_SETTINGS_SCHEMA.find((s) => s.key === StorageKeys.AI_PROVIDER_BREAKER_ENABLED);
    expect(entry).toBeDefined();
    expect(entry?.type).toBe('checkbox');
  });

  it('binds ai_provider_breaker_enabled in the dashboard options HTML (typo guard)', () => {
    const html = readFileSync(OPTIONS_HTML_PATH, 'utf8');
    expect(html).toContain(`data-storage-key="${StorageKeys.AI_PROVIDER_BREAKER_ENABLED}"`);
  });

  it('places the toggle inside the AI provider settings section', () => {
    const html = readFileSync(OPTIONS_HTML_PATH, 'utf8');
    const section = html.slice(html.indexOf('id="aiProviderSection"'));
    const end = section.indexOf('<!-- 記録条件・AI設定 -->');
    expect(end).toBeGreaterThan(0);
    expect(section.slice(0, end)).toContain(`data-storage-key="${StorageKeys.AI_PROVIDER_BREAKER_ENABLED}"`);
  });

  it('has the label and help keys in both locales (en/ja)', () => {
    for (const locale of ['en', 'ja']) {
      const messages = localeMessages(locale);
      expect(messages.aiProviderBreakerEnabledLabel?.message, `${locale} label`).toBeTruthy();
      expect(messages.aiProviderBreakerEnabledHelp?.message, `${locale} help`).toBeTruthy();
    }
  });

  it('explains in help text that turning the gate off stops the pausing', () => {
    for (const locale of ['en', 'ja']) {
      const help = localeMessages(locale).aiProviderBreakerEnabledHelp?.message ?? '';
      expect(help, `${locale} help describes the OFF effect`).not.toBe('');
      expect(help.length, `${locale} help is a real explanation`).toBeGreaterThan(20);
    }
  });
});
