/**
 * models-dev-dialog-save.ts
 * Persistence seam for the models.dev dialog: the settings delta write behind
 * the Save button. No DOM here — the dialog validates inputs and passes the
 * selected provider with the trimmed credential values (PBI 24 SRP split).
 */

import type { ModelsDevProvider } from '../utils/modelsDevApi.js';
import { settingsRepository } from '../utils/storage/SettingsRepository.js';
import { StorageKeys, type Settings } from '../utils/storage/types.js';
import { confirmNewProviderBaseUrls } from './providerOriginConfirmation.js';

/** Result of the persistence step: 'cancelled' means the user declined. */
export type ProviderPersistenceResult = 'saved' | 'cancelled';

/**
 * Run the explicit origin-confirmation policy for the selected catalog
 * endpoint, then write the provider connection delta to settings.
 * Throws when the settings write fails so the dialog renders its error.
 */
export async function persistProviderConnection(
    provider: ModelsDevProvider,
    apiKey: string,
    model: string
): Promise<ProviderPersistenceResult> {
    // The catalog endpoint is fetched content, so the selected origin
    // must pass the same explicit-confirmation policy as a hand-typed
    // base URL before any credential is bound to it.
    const delta: Partial<Settings> = {
        [StorageKeys.AI_PROVIDER]: 'openai-compatible',
        [StorageKeys.PROVIDER_TYPE]: provider.id,
        [StorageKeys.PROVIDER_BASE_URL]: provider.api,
        [StorageKeys.PROVIDER_API_KEY]: apiKey,
        [StorageKeys.PROVIDER_MODEL]: model,
    };
    const originConfirmation = await confirmNewProviderBaseUrls(delta);
    if (originConfirmation === 'cancelled') {
        return 'cancelled';
    }
    await settingsRepository.setAll(delta);
    return 'saved';
}
