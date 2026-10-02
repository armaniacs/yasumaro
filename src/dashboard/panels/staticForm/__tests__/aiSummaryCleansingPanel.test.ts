// @vitest-environment jsdom
/**
 * aiSummaryCleansingPanel.test.ts — the threshold sliders own a single-key delta.
 *
 * These specs mount the panel for real, so the cleansing settings module's own
 * `setupAiSummaryCleansingEventListeners` runs alongside anything the panel
 * binds. A slider that both sides bind produces two writes per `change`, and the
 * whole-form one — assembled from DOM painted at mount time — reverts sibling
 * keys another route changed since. Only a real mount can see that.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForMock } from '../../../../../testDir/waitPolicy.js';
import { installTestSecretKek } from '../../../../utils/crypto/__tests__/secretKekHelper.js';
import { __resetStorageTransactionForTest } from '../../../../utils/storage/storageTransaction.js';
import { StorageKeys } from '../../../../utils/storage/types.js';
import { CLEANSING_RULES } from '../../../../utils/aiSummaryCleaner/rules.js';
import type { InMemoryStoragePort } from '../../../../utils/storage/storagePort.js';

vi.mock('../../../settings/perSiteOverrides.js', () => ({ initPerSiteOverrides: vi.fn() }));
vi.mock('../../../../utils/storageUrls.js', () => ({ getSavedUrlEntries: vi.fn(() => Promise.resolve([])) }));
vi.mock('../../../cleansingStatsView.js', () => ({
  computeCleansingStats: vi.fn(() => ({ count: 0 })),
  renderStatsSummary: vi.fn(),
  renderFunnelChart: vi.fn(),
}));
vi.mock('../../../cleansingFeedbackView.js', () => ({ renderCleansingFeedback: vi.fn(() => Promise.resolve()) }));

// The real SettingsRepository over an in-memory port: the delta payload and the
// merge-under-lock are what the panel talks to in production.
vi.mock('../../../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/storage/SettingsRepository.js')>();
  return { ...actual, settingsRepository: new actual.SettingsRepository(new actual.InMemoryStoragePort()) };
});

import { settingsRepository } from '../../../../utils/storage/SettingsRepository.js';
import { createAiSummaryCleansingPanel } from '../aiSummaryCleansingPanel.js';

const LINK_RATIO = StorageKeys.AI_SUMMARY_CLEANSING_LINK_RATIO_THRESHOLD;
const SHORT_TEXT = StorageKeys.AI_SUMMARY_CLEANSING_SHORT_TEXT_THRESHOLD;
const SEQ_COUNT = StorageKeys.AI_SUMMARY_CLEANSING_SHORT_SEQ_COUNT;
const LINK_PARA = StorageKeys.AI_SUMMARY_CLEANSING_LINK_PARA_THRESHOLD;
const BODY_PROTECTION = StorageKeys.AI_SUMMARY_CLEANSING_BODY_PROTECTION_THRESHOLD;
const FALLBACK_RATIO = StorageKeys.AI_SUMMARY_CLEANSING_FALLBACK_RATIO;
const FALLBACK_MIN_BYTES = StorageKeys.AI_SUMMARY_CLEANSING_FALLBACK_MIN_BYTES;
const MIN_CHARS = StorageKeys.AI_SUMMARY_CLEANSING_FALLBACK_MIN_CHARS;
const CANDIDATE_GUARD = StorageKeys.EXTRACTION_GUARD_CANDIDATE_ENABLED;
const PRESET = StorageKeys.CLEANSING_PRESET;

/**
 * Every threshold slider the panel section renders, and the one key it owns.
 * The set is the cleansing panel's range inputs in entrypoints/options/index.html
 * — aiSummaryCleansingThresholdRanges.test.ts pins that correspondence against
 * the real file, so a slider added there cannot slip through this list.
 */
const SLIDERS: { sliderId: string; valueId: string; storageKey: string }[] = [
  { sliderId: 'ai-summary-cleansing-link-ratio-threshold', valueId: 'link-ratio-threshold-value', storageKey: LINK_RATIO },
  { sliderId: 'ai-summary-cleansing-short-text-threshold', valueId: 'short-text-threshold-value', storageKey: SHORT_TEXT },
  { sliderId: 'ai-summary-cleansing-short-seq-count', valueId: 'short-seq-count-value', storageKey: SEQ_COUNT },
  { sliderId: 'ai-summary-cleansing-link-para-threshold', valueId: 'link-para-threshold-value', storageKey: LINK_PARA },
  { sliderId: 'ai-summary-cleansing-body-protection-threshold', valueId: 'ai-summary-cleansing-body-protection-threshold-value', storageKey: BODY_PROTECTION },
  { sliderId: 'ai-summary-cleansing-fallback-ratio', valueId: 'ai-summary-cleansing-fallback-ratio-value', storageKey: FALLBACK_RATIO },
  { sliderId: 'ai-summary-cleansing-fallback-min-bytes', valueId: 'ai-summary-cleansing-fallback-min-bytes-value', storageKey: FALLBACK_MIN_BYTES },
  { sliderId: 'ai-summary-cleansing-fallback-min-chars', valueId: 'ai-summary-cleansing-fallback-min-chars-value', storageKey: MIN_CHARS },
];

const port = settingsRepository.getPort() as InMemoryStoragePort;

/** The `settings` blob as the write lock will merge the payload into. */
async function storedSettings(): Promise<Record<string, unknown>> {
  const raw = await port.get('settings');
  return (raw['settings'] ?? {}) as Record<string, unknown>;
}

function ruleHtmlId(key: string): string {
  return `ai-summary-cleansing-${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
}

/** The panel section as entrypoints/options/index.html renders it. */
function buildPanelDom(): HTMLElement {
  const ruleCheckboxes = CLEANSING_RULES.map(r => `<input type="checkbox" id="${ruleHtmlId(r.key)}">`).join('');
  const sliders = SLIDERS.map(s => `
      <input type="range" id="${s.sliderId}" min="0" max="1000" value="100">
      <span id="${s.valueId}">100</span>`).join('');
  document.body.innerHTML = `
    <section id="panel-ai-summary-cleansing">
      <select id="cleansing-preset"></select>
      <input type="checkbox" id="ai-summary-cleansing-enabled">
      ${ruleCheckboxes}
      <input type="checkbox" id="whitelist-extraction-enabled">
      <input type="checkbox" id="extraction-guard-candidate-enabled">
      <input type="checkbox" id="extraction-guard-content-cleanse-enabled">
      <input type="checkbox" id="ai-summary-cleansing-body-protection-enabled">
      <input type="checkbox" id="popup-body-protection-enabled">${sliders}
      <fieldset id="aiSummaryCleansingFieldset"></fieldset>
      <div id="aiSummaryCleansingSubGroup"></div>
      <button id="saveAiSummaryCleansingSettings"></button>
      <div id="aiSummaryCleansingSettingsStatus"></div>
      <div id="cleansingFeedbackContainer"></div>
    </section>`;
  return document.getElementById('panel-ai-summary-cleansing')!;
}

function slider(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

/** Dispatches `change` and settles every write the dispatch started. */
async function moveSlider(setAllSpy: ReturnType<typeof vi.spyOn>, id: string, value: string): Promise<void> {
  const el = slider(id);
  el.value = value;
  el.dispatchEvent(new Event('change'));
  await waitForMock(() => expect(setAllSpy).toHaveBeenCalled());
  await Promise.all(setAllSpy.mock.results.map((r: { value: unknown }) => r.value));
}

beforeEach(async () => {
  await installTestSecretKek();
  __resetStorageTransactionForTest();
  port.clear();
  // A stored preset keeps the migration heuristic from writing during mount, so
  // the only writes a test observes are the ones it provoked.
  port.seed({ settings: { [PRESET]: 'custom' }, settings_migrated: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetStorageTransactionForTest();
});

describe('aiSummaryCleansingPanel threshold sliders', () => {
  it.each<[string, string, number]>([
    ['ai-summary-cleansing-link-ratio-threshold', LINK_RATIO, 85],
    ['ai-summary-cleansing-short-text-threshold', SHORT_TEXT, 85],
    ['ai-summary-cleansing-short-seq-count', SEQ_COUNT, 85],
    ['ai-summary-cleansing-link-para-threshold', LINK_PARA, 85],
    ['ai-summary-cleansing-body-protection-threshold', BODY_PROTECTION, 85],
    // 85% on the slider is 0.85 in storage: the delta write must convert the
    // DOM's percentage scale, or every reader of the key sees 85 (out of range).
    ['ai-summary-cleansing-fallback-ratio', FALLBACK_RATIO, 0.85],
    ['ai-summary-cleansing-fallback-min-bytes', FALLBACK_MIN_BYTES, 85],
    ['ai-summary-cleansing-fallback-min-chars', MIN_CHARS, 85],
  ])('writes exactly one key for one change (%s)', async (sliderId, expectedKey, expectedValue) => {
    const container = buildPanelDom();
    await createAiSummaryCleansingPanel().mount(container);

    const setAllSpy = vi.spyOn(settingsRepository, 'setAll');
    await moveSlider(setAllSpy, sliderId, '85');

    expect(setAllSpy).toHaveBeenCalledTimes(1);
    expect(setAllSpy.mock.calls[0]![0]).toEqual({ [expectedKey]: expectedValue });
  });

  it('keeps a sibling key a concurrent writer changed after the form was painted', async () => {
    port.seed({
      settings: { [PRESET]: 'custom', [SHORT_TEXT]: 30, [CANDIDATE_GUARD]: true },
      settings_migrated: true,
    });
    const container = buildPanelDom();
    await createAiSummaryCleansingPanel().mount(container);

    // The race a whole-form write loses: the form was painted from
    // shortTextThreshold=30, and another route moves it to 45 plus flips the
    // guard before the slider's own write reaches the lock.
    await settingsRepository.setAll({ [SHORT_TEXT]: 45, [CANDIDATE_GUARD]: false });

    const setAllSpy = vi.spyOn(settingsRepository, 'setAll');
    await moveSlider(setAllSpy, 'ai-summary-cleansing-link-para-threshold', '65');

    expect(await storedSettings()).toMatchObject({
      [LINK_PARA]: 65,
      [SHORT_TEXT]: 45,
      [CANDIDATE_GUARD]: false,
    });
  });

  it('does not read a settings snapshot on the write path', async () => {
    const container = buildPanelDom();
    await createAiSummaryCleansingPanel().mount(container);

    const getAllSpy = vi.spyOn(settingsRepository, 'getAll');
    const setAllSpy = vi.spyOn(settingsRepository, 'setAll');
    await moveSlider(setAllSpy, 'ai-summary-cleansing-link-ratio-threshold', '85');

    expect(getAllSpy).not.toHaveBeenCalled();
  });

  it.each(SLIDERS.map(s => [s.sliderId, s.valueId]))('still mirrors the slider value into its display on input (%s)', async (sliderId, valueId) => {
    const container = buildPanelDom();
    await createAiSummaryCleansingPanel().mount(container);

    const el = slider(sliderId);
    el.value = '85';
    el.dispatchEvent(new Event('input'));

    expect(document.getElementById(valueId)!.textContent).toBe('85');
  });
});
