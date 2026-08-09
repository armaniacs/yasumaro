// @vitest-environment jsdom
/**
 * aiSummaryCleansingSettingsV2-ruleDerivation.test.ts
 *
 * Locks the property PBI-20 exists to establish: the 32 rule checkboxes in
 * this module are derived from CLEANSING_RULES (via ruleHtmlId/ruleOptionKey)
 * rather than hand-listed five times over. Before this, get/save/apply/read/
 * disable-toggle/event-listener-ids each restated the same 32 ids and option
 * keys independently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { CLEANSING_RULES } from '../../../utils/aiSummaryCleaner/rules.js';

vi.mock('../../../utils/storage.js', () => ({
  StorageKeys: new Proxy({}, { get: (_t, k) => String(k) }),
  DEFAULT_SETTINGS: {},
  getSettings: vi.fn(() => Promise.resolve({})),
  saveSettings: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../utils/logger.js', () => ({
  logError: vi.fn(),
  ErrorCode: { STORAGE_WRITE_FAILURE: 'STRG_WR_001', INTERNAL_ERROR: 'INT_001' },
}));

import * as storage from '../../../utils/storage.js';
import {
  getAiSummaryCleansingSettings,
  applyAiSummaryCleansingSettingsToUI,
  getAiSummaryCleansingSettingsFromUI,
  updateAiSummaryCleansingCheckboxStates,
  type AiSummaryCleansingSettings,
} from '../aiSummaryCleansingSettingsV2.js';

const mockGetSettings = vi.mocked(storage.getSettings);

function ruleHtmlId(key: string): string {
  return `ai-summary-cleansing-${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
}

describe('every rule checkbox id exists in the options page', () => {
  it('resolves for all 32 rules', () => {
    const html = readFileSync('entrypoints/options/index.html', 'utf-8');
    for (const rule of CLEANSING_RULES) {
      const id = ruleHtmlId(rule.key);
      // A typo here means applyAiSummaryCleansingSettingsToUI silently no-ops
      // for that one rule — the checkbox never reflects the stored setting.
      expect(html, `${rule.key} -> #${id}`).toContain(`id="${id}"`);
    }
  });
});

describe('settings <-> UI round-trip for all 32 rule checkboxes', () => {
  beforeEach(() => {
    document.body.innerHTML = CLEANSING_RULES.map(
      rule => `<input type="checkbox" id="${ruleHtmlId(rule.key)}">`,
    ).join('');
  });

  it('applyAiSummaryCleansingSettingsToUI sets each checkbox from its rule flag', () => {
    const settings: Partial<Record<string, boolean>> = {};
    for (const rule of CLEANSING_RULES) settings[`${rule.key}Enabled`] = !rule.defaultEnabled;

    applyAiSummaryCleansingSettingsToUI(settings as unknown as AiSummaryCleansingSettings);

    for (const rule of CLEANSING_RULES) {
      const checkbox = document.getElementById(ruleHtmlId(rule.key)) as HTMLInputElement;
      expect(checkbox.checked, rule.key).toBe(!rule.defaultEnabled);
    }
  });

  it('getAiSummaryCleansingSettingsFromUI reads each rule flag from its checkbox', () => {
    for (const rule of CLEANSING_RULES) {
      (document.getElementById(ruleHtmlId(rule.key)) as HTMLInputElement).checked = !rule.newUserDefault;
    }

    const settings = getAiSummaryCleansingSettingsFromUI() as unknown as Record<string, boolean>;

    for (const rule of CLEANSING_RULES) {
      expect(settings[`${rule.key}Enabled`], rule.key).toBe(!rule.newUserDefault);
    }
  });

  it('updateAiSummaryCleansingCheckboxStates disables/enables every rule checkbox', () => {
    updateAiSummaryCleansingCheckboxStates(false);
    for (const rule of CLEANSING_RULES) {
      expect((document.getElementById(ruleHtmlId(rule.key)) as HTMLInputElement).disabled, rule.key).toBe(true);
    }

    updateAiSummaryCleansingCheckboxStates(true);
    for (const rule of CLEANSING_RULES) {
      expect((document.getElementById(ruleHtmlId(rule.key)) as HTMLInputElement).disabled, rule.key).toBe(false);
    }
  });
});

describe('getAiSummaryCleansingSettings — rule flags derived from CLEANSING_RULES.defaultEnabled', () => {
  it('falls back to defaultEnabled (not newUserDefault) when a key is absent from storage', async () => {
    mockGetSettings.mockResolvedValueOnce({} as never);
    const settings = await getAiSummaryCleansingSettings() as unknown as Record<string, boolean>;
    for (const rule of CLEANSING_RULES) {
      expect(settings[`${rule.key}Enabled`], rule.key).toBe(rule.defaultEnabled);
    }
  });
});
