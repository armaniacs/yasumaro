// @vitest-environment jsdom
/**
 * Parity for the general settings panel's visibility toggles and review
 * summary button wiring (PBI 2026-10-03-29): the three change-listener
 * follow-ups (obsidian details open, local export hidden, review summary
 * hidden) and the two summary buttons must behave exactly as before the
 * mount-closure split into layout/wizard/models-dev modules.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installTestSecretKek } from '../../../../utils/crypto/__tests__/secretKekHelper.js';
import { waitForMock } from '../../../../../testDir/waitPolicy.js';

vi.mock('../../../reviewSummaryHandler.js', () => ({
  generateReviewSummary: vi.fn().mockResolvedValue(undefined),
}));

import { createGeneralSettingsPanel } from '../generalSettingsPanel.js';
import { generateReviewSummary } from '../../../reviewSummaryHandler.js';

const PANEL_MARKUP = `
  <section id="panel-general" class="panel active">
    <details id="obsidianSettingsDetails" open>
      <summary>Obsidian</summary>
      <input type="checkbox" id="obsidianEnabled" data-storage-key="obsidian_enabled">
    </details>
    <div>
      <input type="checkbox" id="localMarkdownExportEnabled" data-storage-key="local_markdown_export_enabled">
      <div id="localMarkdownExportSettings" class="hidden"></div>
    </div>
    <div>
      <input type="checkbox" id="reviewSummaryEnabled" data-storage-key="review_summary_enabled">
      <div id="reviewSummaryManualActions" class="hidden">
        <button id="generateWeeklySummaryBtn"></button>
        <button id="generateMonthlySummaryBtn"></button>
        <span id="reviewSummaryStatus"></span>
      </div>
    </div>
  </section>`;

async function mountPanel(): Promise<void> {
  const panel = createGeneralSettingsPanel();
  await panel.mount(document.getElementById('panel-general')!);
}

beforeEach(async () => {
  await installTestSecretKek();
  document.body.innerHTML = PANEL_MARKUP;
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  await chrome.storage.local.set({ settings: {}, settings_migrated: true });
  vi.mocked(generateReviewSummary).mockClear();
});

describe('generalSettingsPanel — visibility toggle parity', () => {
  it('opens/closes the obsidian details with the checkbox', async () => {
    await mountPanel();
    const input = document.getElementById('obsidianEnabled') as HTMLInputElement;
    const details = document.getElementById('obsidianSettingsDetails') as HTMLDetailsElement;
    // loadGeneralSettings syncs the details open state to the checkbox, so
    // with empty settings (unchecked) the details are closed after mount.
    expect(details.open).toBe(false);

    input.checked = true;
    input.dispatchEvent(new Event('change'));
    expect(details.open).toBe(true);

    input.checked = false;
    input.dispatchEvent(new Event('change'));
    expect(details.open).toBe(false);
  });

  it('toggles the local export settings block visibility with the checkbox', async () => {
    await mountPanel();
    const input = document.getElementById('localMarkdownExportEnabled') as HTMLInputElement;
    const settings = document.getElementById('localMarkdownExportSettings') as HTMLElement;
    expect(settings.classList.contains('hidden')).toBe(true);

    input.checked = true;
    input.dispatchEvent(new Event('change'));
    expect(settings.classList.contains('hidden')).toBe(false);

    input.checked = false;
    input.dispatchEvent(new Event('change'));
    expect(settings.classList.contains('hidden')).toBe(true);
  });

  it('toggles the review summary manual actions visibility with the checkbox', async () => {
    await mountPanel();
    const input = document.getElementById('reviewSummaryEnabled') as HTMLInputElement;
    const actions = document.getElementById('reviewSummaryManualActions') as HTMLElement;
    expect(actions.classList.contains('hidden')).toBe(true);

    input.checked = true;
    input.dispatchEvent(new Event('change'));
    expect(actions.classList.contains('hidden')).toBe(false);
  });
});

describe('generalSettingsPanel — review summary button parity', () => {
  it('routes the weekly button to generateReviewSummary with the weekly period', async () => {
    await mountPanel();

    const btn = document.getElementById('generateWeeklySummaryBtn') as HTMLButtonElement;
    btn.click();

    await waitForMock(() => expect(generateReviewSummary).toHaveBeenCalledTimes(1));
    expect(generateReviewSummary).toHaveBeenCalledWith({
      button: btn,
      statusElement: document.getElementById('reviewSummaryStatus'),
      periodType: 'weekly',
    });
  });

  it('routes the monthly button to generateReviewSummary with the monthly period', async () => {
    await mountPanel();

    const btn = document.getElementById('generateMonthlySummaryBtn') as HTMLButtonElement;
    btn.click();

    await waitForMock(() => expect(generateReviewSummary).toHaveBeenCalledTimes(1));
    expect(generateReviewSummary).toHaveBeenCalledWith({
      button: btn,
      statusElement: document.getElementById('reviewSummaryStatus'),
      periodType: 'monthly',
    });
  });
});
