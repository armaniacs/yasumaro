// @vitest-environment jsdom
/**
 * aiSummaryCleansingPanel.test.ts — the threshold sliders own a single-key delta.
 *
 * Delta-write convention: the write path must not carry a `getAll()` snapshot,
 * because a snapshot reverts whatever a concurrent writer changed in the time
 * between the form's read and the write. These specs pin both halves of that —
 * the payload carries one key, and a sibling change made before the write
 * survives the slider's own write.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForMock } from '../../../../../testDir/waitPolicy.js';
import { installTestSecretKek } from '../../../../utils/crypto/__tests__/secretKekHelper.js';
import { __resetStorageTransactionForTest } from '../../../../utils/storage/storageTransaction.js';
import { StorageKeys } from '../../../../utils/storage/types.js';
import type { InMemoryStoragePort } from '../../../../utils/storage/storagePort.js';

const { renderedSettings } = vi.hoisted(() => ({ renderedSettings: { current: {} as Record<string, unknown> } }));

vi.mock('../../../settings/aiSummaryCleansingSettingsV2.js', () => ({
  getAiSummaryCleansingSettings: vi.fn(() => Promise.resolve({ ...renderedSettings.current })),
  applyAiSummaryCleansingSettingsToUI: vi.fn(),
  setupAiSummaryCleansingEventListeners: vi.fn(),
}));
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
const CANDIDATE_GUARD = StorageKeys.EXTRACTION_GUARD_CANDIDATE_ENABLED;

const port = settingsRepository.getPort() as InMemoryStoragePort;

/** The `settings` blob as the write lock will merge the payload into. */
async function storedSettings(): Promise<Record<string, unknown>> {
  const raw = await port.get('settings');
  return (raw['settings'] ?? {}) as Record<string, unknown>;
}

function buildPanelDom(): HTMLElement {
  document.body.innerHTML = `
    <div id="panel-ai-summary-cleansing">
      <input type="range" id="ai-summary-cleansing-link-ratio-threshold" value="70">
      <span id="link-ratio-threshold-value">70</span>
      <input type="range" id="ai-summary-cleansing-short-text-threshold" value="30">
      <span id="short-text-threshold-value">30</span>
      <input type="range" id="ai-summary-cleansing-short-seq-count" value="5">
      <span id="short-seq-count-value">5</span>
      <input type="range" id="ai-summary-cleansing-link-para-threshold" value="50">
      <span id="link-para-threshold-value">50</span>
    </div>`;
  return document.getElementById('panel-ai-summary-cleansing')!;
}

function slider(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

/** Dispatch `change` and await the write the handler started. */
async function moveSlider(spy: ReturnType<typeof vi.spyOn>, id: string, value: string): Promise<void> {
  const el = slider(id);
  el.value = value;
  el.dispatchEvent(new Event('change'));
  await waitForMock(() => expect(spy).toHaveBeenCalled());
  await spy.mock.results.at(-1)!.value;
}

beforeEach(async () => {
  await installTestSecretKek();
  __resetStorageTransactionForTest();
  port.clear();
  renderedSettings.current = {};
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetStorageTransactionForTest();
});

describe('aiSummaryCleansingPanel threshold sliders', () => {
  it.each<[string, string]>([
    ['ai-summary-cleansing-link-ratio-threshold', LINK_RATIO],
    ['ai-summary-cleansing-short-text-threshold', SHORT_TEXT],
    ['ai-summary-cleansing-short-seq-count', SEQ_COUNT],
    ['ai-summary-cleansing-link-para-threshold', LINK_PARA],
  ])('writes only the moved slider key (%s)', async (sliderId, expectedKey) => {
    const container = buildPanelDom();
    await createAiSummaryCleansingPanel().mount(container);

    const setAllSpy = vi.spyOn(settingsRepository, 'setAll');
    await moveSlider(setAllSpy, sliderId, '85');

    expect(setAllSpy).toHaveBeenCalledTimes(1);
    expect(Object.keys(setAllSpy.mock.calls[0]![0])).toEqual([expectedKey]);
    expect(setAllSpy.mock.calls[0]![0]).toEqual({ [expectedKey]: 85 });
  });

  it('keeps a sibling key a concurrent writer changed before the write', async () => {
    port.seed({
      settings: { [LINK_PARA]: 50, [SHORT_TEXT]: 30, [CANDIDATE_GUARD]: true },
      settings_migrated: true,
    });
    renderedSettings.current = { [SHORT_TEXT]: 30, [CANDIDATE_GUARD]: true };
    const container = buildPanelDom();
    await createAiSummaryCleansingPanel().mount(container);

    // The race a snapshot write loses: the form was rendered from
    // shortTextThreshold=30, and a concurrent writer moves it to 45 before the
    // slider's own write reaches the lock.
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

  it('still mirrors the slider value into its display on input', async () => {
    const container = buildPanelDom();
    await createAiSummaryCleansingPanel().mount(container);

    const el = slider('ai-summary-cleansing-link-ratio-threshold');
    el.value = '85';
    el.dispatchEvent(new Event('input'));

    expect(document.getElementById('link-ratio-threshold-value')!.textContent).toBe('85');
  });
});