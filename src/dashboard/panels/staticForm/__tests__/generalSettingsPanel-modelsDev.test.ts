// @vitest-environment jsdom
/**
 * Parity for the general settings panel's models.dev dialog wiring
 * (PBI 2026-10-03-29): the open button lazily creates one ModelsDevDialog
 * and reuses it on every reopen, and the onSave bridge fills the connection
 * inputs, updates the selected-provider info display, and delta-writes the
 * four connection keys — exactly as before the wiring moved out of the
 * mount closure.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installTestSecretKek } from '../../../../utils/crypto/__tests__/secretKekHelper.js';
import { waitForMock } from '../../../../../testDir/waitPolicy.js';

const { mockShow } = vi.hoisted(() => ({
  mockShow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../models-dev-dialog.js', () => ({
  ModelsDevDialog: vi.fn(function () {
    return { show: mockShow };
  }),
}));

vi.mock('../../../../utils/storage/domainFilterCache.js', () => ({
  saveSettingsAndRefreshDomainFilterCache: vi.fn().mockResolvedValue(undefined),
}));

import { createGeneralSettingsPanel } from '../generalSettingsPanel.js';
import { mountModelsDevDialog } from '../generalSettingsModelsDev.js';
import { ModelsDevDialog } from '../../../models-dev-dialog.js';
import { saveSettingsAndRefreshDomainFilterCache } from '../../../../utils/storage/domainFilterCache.js';
import { StorageKeys } from '../../../../utils/storage/types.js';

const PANEL_MARKUP = `
  <section id="panel-general" class="panel active">
    <button id="openModelsDevDialogBtn"></button>
    <div id="selectedProviderInfo" class="hidden"></div>
    <div id="providerInfoDisplay"></div>
    <input type="password" id="providerApiKey" data-storage-key="provider_api_key">
    <input type="text" id="providerModel" data-storage-key="provider_model">
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
  vi.mocked(ModelsDevDialog).mockClear();
  mockShow.mockClear();
  vi.mocked(saveSettingsAndRefreshDomainFilterCache).mockClear();
});

function lastDialogOptions(): { onSave: (...args: unknown[]) => Promise<void>; onCancel: () => void } {
  const calls = vi.mocked(ModelsDevDialog).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0];
}

describe('generalSettingsPanel — models.dev dialog wiring parity', () => {
  it('creates the dialog on the first click and shows it', async () => {
    await mountPanel();

    (document.getElementById('openModelsDevDialogBtn') as HTMLButtonElement).click();

    await waitForMock(() => expect(mockShow).toHaveBeenCalledTimes(1));
    expect(ModelsDevDialog).toHaveBeenCalledTimes(1);
    expect(lastDialogOptions().onSave).toBeTypeOf('function');
    expect(lastDialogOptions().onCancel).toBeTypeOf('function');
  });

  it('reuses the same dialog instance on a second click', async () => {
    await mountPanel();

    const btn = document.getElementById('openModelsDevDialogBtn') as HTMLButtonElement;
    btn.click();
    await waitForMock(() => expect(mockShow).toHaveBeenCalledTimes(1));
    btn.click();

    await waitForMock(() => expect(mockShow).toHaveBeenCalledTimes(2));
    expect(ModelsDevDialog).toHaveBeenCalledTimes(1);
  });

  it('onSave fills the connection inputs, shows the info, and delta-writes the four keys', async () => {
    await mountPanel();
    (document.getElementById('openModelsDevDialogBtn') as HTMLButtonElement).click();
    await waitForMock(() => expect(mockShow).toHaveBeenCalledTimes(1));

    const infoDiv = document.getElementById('selectedProviderInfo') as HTMLElement;
    const displayDiv = document.getElementById('providerInfoDisplay') as HTMLElement;
    await lastDialogOptions().onSave('my-provider', 'https://api.example.com/v1', 'sk-secret', 'my-model');

    expect(infoDiv.classList.contains('hidden')).toBe(false);
    expect(displayDiv.textContent).toBe('my-provider (https://api.example.com/v1) - my-model');
    expect((document.getElementById('providerApiKey') as HTMLInputElement).value).toBe('sk-secret');
    expect((document.getElementById('providerModel') as HTMLInputElement).value).toBe('my-model');
    expect(saveSettingsAndRefreshDomainFilterCache).toHaveBeenCalledWith({
      [StorageKeys.PROVIDER_TYPE]: 'my-provider',
      [StorageKeys.PROVIDER_BASE_URL]: 'https://api.example.com/v1',
      [StorageKeys.PROVIDER_API_KEY]: 'sk-secret',
      [StorageKeys.PROVIDER_MODEL]: 'my-model',
    });
  });

  it('onSave omits the model segment when no model is given', async () => {
    await mountPanel();
    (document.getElementById('openModelsDevDialogBtn') as HTMLButtonElement).click();
    await waitForMock(() => expect(mockShow).toHaveBeenCalledTimes(1));

    await lastDialogOptions().onSave('my-provider', 'https://api.example.com/v1', 'sk-secret', '');

    const displayDiv = document.getElementById('providerInfoDisplay') as HTMLElement;
    expect(displayDiv.textContent).toBe('my-provider (https://api.example.com/v1)');
  });
});

describe('generalSettingsModelsDev — direct module mount', () => {
  it('wires the open button on a bare container without the panel', async () => {
    mountModelsDevDialog(document.getElementById('panel-general')!);

    (document.getElementById('openModelsDevDialogBtn') as HTMLButtonElement).click();

    await waitForMock(() => expect(mockShow).toHaveBeenCalledTimes(1));
    expect(ModelsDevDialog).toHaveBeenCalledTimes(1);
  });
});
