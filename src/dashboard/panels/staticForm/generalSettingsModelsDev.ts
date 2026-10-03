/**
 * generalSettingsModelsDev.ts
 * models.dev (OpenAI-compatible) provider picker wiring for the general
 * settings panel: the open button, the lazily created dialog, and the
 * onSave bridge that fills the connection fields and delta-writes the four
 * connection keys this dialog owns.
 */

import { saveSettingsAndRefreshDomainFilterCache } from '../../../utils/storage/domainFilterCache.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import { ModelsDevDialog } from '../../models-dev-dialog.js';

export function mountModelsDevDialog(container: HTMLElement): void {
  const openModelsDevDialogBtn = container.querySelector('#openModelsDevDialogBtn') as HTMLButtonElement;
  const selectedProviderInfoDiv = container.querySelector('#selectedProviderInfo') as HTMLElement;
  const providerInfoDisplayDiv = container.querySelector('#providerInfoDisplay') as HTMLElement;

  let modelsDevDialog: ModelsDevDialog | null = null;
  openModelsDevDialogBtn?.addEventListener('click', async () => {
    if (!modelsDevDialog) {
      modelsDevDialog = new ModelsDevDialog({
        onSave: async (providerId, baseUrl, apiKey, model) => {
          selectedProviderInfoDiv?.classList.remove('hidden');
          providerInfoDisplayDiv!.textContent = `${providerId} (${baseUrl})${model ? ` - ${model}` : ''}`;
          const providerApiKeyInput = document.getElementById('providerApiKey') as HTMLInputElement | null;
          const providerModelInput = document.getElementById('providerModel') as HTMLInputElement | null;
          if (providerApiKeyInput) providerApiKeyInput.value = apiKey;
          if (providerModelInput) providerModelInput.value = model;
          // Delta write (PBI 2026-09-17-17): the four connection keys this
          // dialog owns enter the payload alone, so the connection fields a
          // concurrent writer changed are not reverted by a getAll() snapshot.
          await saveSettingsAndRefreshDomainFilterCache({
            [StorageKeys.PROVIDER_TYPE]: providerId,
            [StorageKeys.PROVIDER_BASE_URL]: baseUrl,
            [StorageKeys.PROVIDER_API_KEY]: apiKey,
            [StorageKeys.PROVIDER_MODEL]: model,
          });
        },
        onCancel: () => {}
      });
    }
    await modelsDevDialog.show();
  });
}
