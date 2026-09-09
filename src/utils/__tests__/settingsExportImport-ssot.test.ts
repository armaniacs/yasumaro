/**
 * settingsExportImport-ssot.test.ts
 * Migration equivalence + SSOT derivation rule tests for PBI 04.
 *
 * Freezes the legacy hand-written key lists as literals, inventories the
 * drift against the DEFAULT_SETTINGS-derived set, and pins the intended
 * post-refactor behavior of validateExportData and saveJsonToFile.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { EXPORT_VERSION, LEGACY_EXPORT_VERSION, validateExportData } from '../settingsExportImport.js';
import * as exportModule from '../settingsExportImport.js';
import { DEFAULT_SETTINGS } from '../storage/defaults.js';
import { API_KEY_FIELDS } from '../storage/settingsMigration.js';

// Legacy hand-written requiredKeys snapshot (settingsExportImport.ts pre-refactor).
const LEGACY_REQUIRED_KEYS: readonly string[] = [
  'obsidian_protocol', 'obsidian_port',
  'min_visit_duration', 'min_scroll_depth',
  'gemini_model', 'obsidian_daily_path', 'ai_provider',
  'openai_base_url', 'openai_model',
  'openai_2_base_url', 'openai_2_model',
  'domain_whitelist', 'domain_blacklist', 'domain_filter_mode',
  'privacy_mode', 'pii_confirmation_ui', 'pii_sanitize_logs',
  'ublock_rules', 'ublock_sources', 'ublock_format_enabled',
  'simple_format_enabled',
];

// Legacy hand-written apiKeyKeys snapshot (settingsExportImport.ts pre-refactor).
const LEGACY_API_KEY_KEYS: readonly string[] = [
  'obsidian_api_key', 'gemini_api_key',
  'openai_api_key', 'openai_2_api_key',
];

function derivedRequiredKeys(): string[] {
  const apiKeys = new Set<string>(API_KEY_FIELDS);
  return Object.keys(DEFAULT_SETTINGS).filter((key) => !apiKeys.has(key));
}

function fullNonApiSettings(): Record<string, unknown> {
  const settings: Record<string, unknown> = { ...(DEFAULT_SETTINGS as Record<string, unknown>) };
  for (const field of API_KEY_FIELDS) {
    delete settings[field];
  }
  return settings;
}

function exportData(
  settings: Record<string, unknown>,
  apiKeyExcluded: boolean,
  version: string = EXPORT_VERSION,
): Record<string, unknown> {
  return {
    version,
    exportedAt: new Date().toISOString(),
    settings,
    apiKeyExcluded,
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'URL', {
    value: {
      createObjectURL: vi.fn(() => 'blob:http://localhost/fake'),
      revokeObjectURL: vi.fn(),
    },
    writable: true,
    configurable: true,
  });
});

describe('migration equivalence: legacy hand lists vs SSOT derivation', () => {
  test('every legacy required key stays required under derivation', () => {
    const derived = new Set(derivedRequiredKeys());
    for (const key of LEGACY_REQUIRED_KEYS) {
      expect(derived.has(key), `legacy key "${key}" must remain required`).toBe(true);
    }
  });

  test('drift inventory: derivation covers keys the hand list missed', () => {
    const derived = new Set(derivedRequiredKeys());
    const drift = [...derived].filter((key) => !(LEGACY_REQUIRED_KEYS as readonly string[]).includes(key));
    expect(drift.length).toBeGreaterThan(0);
    expect(drift).toContain('obsidian_host');
    expect(drift).toContain('ai_provider_priority_list');
  });

  test('SSOT API_KEY_FIELDS is a superset of the legacy apiKeyKeys', () => {
    const ssot = new Set<string>(API_KEY_FIELDS);
    for (const key of LEGACY_API_KEY_KEYS) {
      expect(ssot.has(key), `legacy api key "${key}" must stay in SSOT`).toBe(true);
    }
    const added = [...ssot].filter((key) => !(LEGACY_API_KEY_KEYS as readonly string[]).includes(key));
    expect(added.sort()).toEqual(['github_pat', 'provider_api_key']);
  });
});

describe('intended validateExportData behavior (SSOT-derived)', () => {
  test('full DEFAULT_SETTINGS payload minus API keys is accepted', () => {
    expect(validateExportData(exportData(fullNonApiSettings(), true))).toBe(true);
  });

  test('payload missing a derived-only key is rejected', () => {
    const settings = fullNonApiSettings();
    delete settings['obsidian_host'];
    expect(validateExportData(exportData(settings, true))).toBe(false);
  });

  test('previously-accepted 21-key fixture is rejected in the current format (drift corrected)', () => {
    const settings: Record<string, unknown> = {};
    for (const key of LEGACY_REQUIRED_KEYS) {
      settings[key] = (DEFAULT_SETTINGS as Record<string, unknown>)[key];
    }
    expect(validateExportData(exportData(settings, true))).toBe(false);
  });

  test('legacy 1.0.0 export carrying only the 21-key fixture stays importable', () => {
    const settings: Record<string, unknown> = {};
    for (const key of LEGACY_REQUIRED_KEYS) {
      settings[key] = (DEFAULT_SETTINGS as Record<string, unknown>)[key];
    }
    expect(validateExportData(exportData(settings, true, LEGACY_EXPORT_VERSION))).toBe(true);
  });

  test('legacy 1.0.0 payload missing a legacy key is still rejected', () => {
    const settings: Record<string, unknown> = {};
    for (const key of LEGACY_REQUIRED_KEYS) {
      settings[key] = (DEFAULT_SETTINGS as Record<string, unknown>)[key];
    }
    delete settings['min_visit_duration'];
    expect(validateExportData(exportData(settings, true, LEGACY_EXPORT_VERSION))).toBe(false);
  });

  test('apiKeyExcluded=false requires the full SSOT API key set', () => {
    const withLegacyKeys: Record<string, unknown> = {
      ...fullNonApiSettings(),
      obsidian_api_key: 'k1',
      gemini_api_key: 'k2',
      openai_api_key: 'k3',
      openai_2_api_key: 'k4',
    };
    expect(validateExportData(exportData(withLegacyKeys, false))).toBe(false);

    const withAllKeys: Record<string, unknown> = {
      ...withLegacyKeys,
      provider_api_key: 'k5',
      github_pat: 'k6',
    };
    expect(validateExportData(exportData(withAllKeys, false))).toBe(true);
  });

  test('legacy 1.0.0 payload with keys included validates against the frozen 4-key set', () => {
    const withLegacyKeys: Record<string, unknown> = {};
    for (const key of LEGACY_REQUIRED_KEYS) {
      withLegacyKeys[key] = (DEFAULT_SETTINGS as Record<string, unknown>)[key];
    }
    withLegacyKeys['obsidian_api_key'] = 'k1';
    withLegacyKeys['gemini_api_key'] = 'k2';
    withLegacyKeys['openai_api_key'] = 'k3';
    withLegacyKeys['openai_2_api_key'] = 'k4';
    expect(validateExportData(exportData(withLegacyKeys, false, LEGACY_EXPORT_VERSION))).toBe(true);
  });
});

describe('saveJsonToFile', () => {
  test('helper is exported and owns the Blob anchor revoke lifecycle', async () => {
    const saveJsonToFile = (exportModule as unknown as {
      saveJsonToFile?: (json: string, filename: string) => void;
    }).saveJsonToFile;
    expect(saveJsonToFile).toBeTypeOf('function');

    const json = JSON.stringify({ hello: 'world' });
    const createElementSpy = vi.spyOn(document, 'createElement');
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');

    saveJsonToFile!(json, 'yasumaro-settings-test.json');

    expect(globalThis.URL.createObjectURL).toHaveBeenCalledOnce();
    const blob = vi.mocked(globalThis.URL.createObjectURL).mock.calls[0]![0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/json');
    expect(await blob.text()).toBe(json);

    expect(createElementSpy).toHaveBeenCalledWith('a');
    const link = appendSpy.mock.calls[0]![0] as HTMLAnchorElement;
    expect(link.download).toBe('yasumaro-settings-test.json');
    expect(link.style.display).toBe('none');
    expect(removeSpy).toHaveBeenCalledWith(link);
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledOnce();

    createElementSpy.mockRestore();
    appendSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
