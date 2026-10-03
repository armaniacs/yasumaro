import { getMessageOr } from '../../utils/i18n.js';
import { showStatus } from '../../utils/ui/settingsUiHelper.js';
import { PROVIDER_DEFAULT_BASE_URLS } from '../../utils/storage/providerDefaultBaseUrls.js';
import { syncStatusToTop } from '../statusView.js';

type ProviderPresetId = keyof typeof PROVIDER_DEFAULT_BASE_URLS;

const PRESET_LABELS: Record<ProviderPresetId, { messageKey: string; fallback: string }> = {
  'lm-studio': { messageKey: 'lmStudioPresetApplied', fallback: 'LM Studio preset applied' },
  'ollama': { messageKey: 'ollamaPresetApplied', fallback: 'Ollama preset applied' },
};

/**
 * Provider preset buttons live only on the general settings panel, so their
 * handlers do too. Each fills the provider base URL input and reports through
 * the showStatus contract + one-shot top mirror, the same pairing every other
 * dashboard status write uses.
 *
 * The status write used to hand-roll `className = 'status-success'`, a class
 * only popup styles.css declares — dashboard.css keys the status contract off
 * `status-message <type>`, so the preset status rendered unstyled and the
 * helper derivation was bypassed.
 */
function applyProviderPreset(presetId: ProviderPresetId): void {
  const providerBaseUrlInput = document.getElementById('providerBaseUrl') as HTMLInputElement | null;
  const presetUrl = PROVIDER_DEFAULT_BASE_URLS[presetId];
  if (providerBaseUrlInput) providerBaseUrlInput.value = presetUrl;
  const { messageKey, fallback } = PRESET_LABELS[presetId];
  // autoClear false: the pre-helper render set no timer, so the message stays
  // until the next status write replaces it.
  showStatus('status', getMessageOr(messageKey, `${fallback} (${presetUrl})`), 'success', { autoClear: false });
  syncStatusToTop();
}

export function handleLmStudioPreset(): void {
  applyProviderPreset('lm-studio');
}

export function handleOllamaPreset(): void {
  applyProviderPreset('ollama');
}
