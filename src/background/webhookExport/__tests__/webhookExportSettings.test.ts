/**
 * webhookExportSettings.test.ts
 * PBI 2026-10-22-05 box (a) ― transfer-condition settings normalize + round-trip.
 */
import { describe, it, expect } from 'vitest';
import {
  defaultWebhookExportSettings,
  loadWebhookExportSettings,
  normalizeWebhookExportSettings,
  saveWebhookExportSettings,
  WEBHOOK_EXPORT_SETTINGS_KEY,
  WebhookDestinationBlockedError,
  type WebhookExportStore,
} from '../webhookExportSettings.js';

function memoryStore(seed: Record<string, string> = {}): WebhookExportStore & { data: Record<string, string> } {
  const data: Record<string, string> = { ...seed };
  return {
    data,
    get: async (key: string): Promise<string | null> => (typeof data[key] === 'string' ? (data[key] as string) : null),
    set: async (key: string, value: string): Promise<void> => {
      data[key] = value;
    },
  };
}

describe('normalizeWebhookExportSettings (fail-closed)', () => {
  it('disables export on null / garbage shapes', () => {
    expect(normalizeWebhookExportSettings(null)).toEqual(defaultWebhookExportSettings());
    expect(normalizeWebhookExportSettings(undefined)).toEqual(defaultWebhookExportSettings());
  });

  it('keeps an enabled setting with trimmed url and tag', () => {
    const normalized = normalizeWebhookExportSettings({
      enabled: true,
      url: '  https://hooks.example.com/x  ',
      condition: { tag: ' obsidian ' },
    });
    expect(normalized).toEqual({ enabled: true, url: 'https://hooks.example.com/x', condition: { tag: 'obsidian' } });
  });

  it('clamps engagement thresholds and drops non-boolean enabled', () => {
    const raw = JSON.parse(
      '{"enabled":"yes","url":"https://hooks.example.com/x","condition":{"minScrollDepth":500,"minVisitDuration":-3}}',
    );
    const normalized = normalizeWebhookExportSettings(raw);
    expect(normalized.enabled).toBe(false);
    expect(normalized.condition.minScrollDepth).toBe(100);
    expect(normalized.condition.minVisitDuration).toBe(0);
  });

  it('truncates overlong destination URLs (quota hygiene)', () => {
    const normalized = normalizeWebhookExportSettings({
      enabled: true,
      url: `https://hooks.example.com/${'x'.repeat(5000)}`,
      condition: {},
    });
    expect(normalized.url.length).toBeLessThanOrEqual(2000);
    expect(normalized.url.startsWith('https://hooks.example.com/')).toBe(true);
  });

  it('drops NaN thresholds and empty tags', () => {
    const normalized = normalizeWebhookExportSettings({
      enabled: true,
      url: 'https://hooks.example.com/x',
      condition: { tag: '   ', minScrollDepth: Number.NaN, minVisitDuration: Number.POSITIVE_INFINITY },
    });
    expect(normalized.condition).toEqual({});
  });
});

describe('load/save round-trip', () => {
  it('persists under the owned key and reloads the normalized shape', async () => {
    const store = memoryStore();
    await saveWebhookExportSettings(
      { enabled: true, url: 'https://api.github.com/x', condition: { tag: '#web', minScrollDepth: 50 } },
      store,
    );
    expect(typeof store.data[WEBHOOK_EXPORT_SETTINGS_KEY]).toBe('string');
    const loaded = await loadWebhookExportSettings(store);
    expect(loaded).toEqual({
      enabled: true,
      url: 'https://api.github.com/x',
      condition: { tag: '#web', minScrollDepth: 50 },
    });
  });

  it('loads the disabled default on corrupt JSON', async () => {
    const store = memoryStore({ [WEBHOOK_EXPORT_SETTINGS_KEY]: '{not json' });
    expect(await loadWebhookExportSettings(store)).toEqual(defaultWebhookExportSettings());
  });
});

describe('save-time pre-flight', () => {
  const settingsFor = (url: string) => ({ enabled: true, url, condition: {} });

  it('permits an allowlisted https origin and returns the verdict', async () => {
    const store = memoryStore();
    const verdict = await saveWebhookExportSettings(settingsFor('https://api.github.com/x'), store);
    expect(verdict).toEqual({ permitted: true, reason: 'permitted', origin: 'https://api.github.com' });
    expect(typeof store.data[WEBHOOK_EXPORT_SETTINGS_KEY]).toBe('string');
  });

  it('rejects an out-of-list origin with an origin-only reason and persists nothing', async () => {
    const store = memoryStore();
    const failure = await saveWebhookExportSettings(settingsFor('https://hooks.example.com/hook?token=secret'), store).catch(
      (error: Error) => error,
    );
    expect(failure).toBeInstanceOf(WebhookDestinationBlockedError);
    const verdict = (failure as WebhookDestinationBlockedError).verdict;
    expect(verdict).toEqual({
      permitted: false,
      reason: 'destination-not-in-allowlist',
      origin: 'https://hooks.example.com',
    });
    expect((failure as Error).message).not.toContain('secret');
    expect(store.data[WEBHOOK_EXPORT_SETTINGS_KEY]).toBeUndefined();
  });

  it('rejects a new non-https destination', async () => {
    const store = memoryStore();
    await expect(saveWebhookExportSettings(settingsFor('http://127.0.0.1:27123/hook'), store)).rejects.toMatchObject({
      verdict: { permitted: false, reason: 'non-https-or-empty-destination' },
    });
  });

  it('keeps an empty destination savable (nothing to judge)', async () => {
    const store = memoryStore();
    await expect(saveWebhookExportSettings(settingsFor(''), store)).resolves.toBeNull();
  });

  it('grandfathers an unchanged stored non-https destination the initial list covers', async () => {
    const stored = settingsFor('http://127.0.0.1:27123/hook');
    const store = memoryStore({ [WEBHOOK_EXPORT_SETTINGS_KEY]: JSON.stringify(stored) });
    const verdict = await saveWebhookExportSettings(stored, store);
    expect(verdict?.permitted).toBe(false);
    expect(await loadWebhookExportSettings(store)).toEqual(stored);
  });

  it('does not grandfather an unchanged stored destination outside the list', async () => {
    const stored = settingsFor('https://hooks.example.com/hook');
    const store = memoryStore({ [WEBHOOK_EXPORT_SETTINGS_KEY]: JSON.stringify(stored) });
    await expect(saveWebhookExportSettings(stored, store)).rejects.toBeInstanceOf(WebhookDestinationBlockedError);
  });
});
