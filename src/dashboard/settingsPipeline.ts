/**
 * settingsPipeline.ts
 * Shared settings save pipeline for dashboard panels.
 *
 * Consolidates the repeated read→merge→save→refresh pattern found in
 * handleSaveOnly, handleTestAi, and handleTestLocalMarkdown.
 */

import { getSettings, saveSettingsWithAllowedUrls, StorageKeys } from '../utils/storage.js';
import { extractSettingsFromInputs, extractLocalMarkdownExportTiming } from '../utils/settingsFormBinding.js';
import { clearAllFieldErrors, validateAllFields, validateObsidianHost, validateGeminiApiVersion, ErrorPair } from '../popup/settings/fieldValidation.js';
import { getMessage } from '../utils/i18n.js';
import { showConfirmDialog } from './utils/confirmDialog.js';

export interface SaveSettingsOptions {
  /** CSS selector for the settings form container. Defaults to '#panel-general'. */
  formSelector?: string;
  /** Whether to extract local markdown export timing. Defaults to true. */
  includeTiming?: boolean;
  /** Extra validation pairs (input, errorId) to clear before validation. */
  extraValidationPairs?: ErrorPair[];
  /** Called after successful save. */
  onSuccess?: () => void;
}

export interface SaveSettingsResult {
  success: boolean;
  error?: string;
}

/**
 * Read settings from the dashboard form, merge with current settings,
 * persist, and refresh dependent schedulers.
 *
 * @returns { success: true } on success, or { success: false, error } on failure.
 */
export async function saveDashboardSettings(options: SaveSettingsOptions = {}): Promise<SaveSettingsResult> {
  const {
    formSelector = '#panel-general',
    includeTiming = true,
    extraValidationPairs = [],
  } = options;

  const protocolInput = document.getElementById('protocol') as HTMLInputElement | null;
  const portInput = document.getElementById('port') as HTMLInputElement | null;
  const obsidianHostInput = document.getElementById('obsidianHost') as HTMLInputElement | null;
  const geminiApiVersionInput = document.getElementById('geminiApiVersion') as HTMLInputElement | null;
  const minVisitDurationInput = document.getElementById('minVisitDuration') as HTMLInputElement | null;
  const minScrollDepthInput = document.getElementById('minScrollDepth') as HTMLInputElement | null;
  const maxTokensPerPromptInput = document.getElementById('maxTokensPerPrompt') as HTMLInputElement | null;

  const errorPairs: ErrorPair[] = [
    [protocolInput, 'protocolError'],
    [portInput, 'portError'],
    [obsidianHostInput, 'obsidianHostError'],
    [geminiApiVersionInput, 'geminiApiVersionError'],
    [minVisitDurationInput, 'minVisitDurationError'],
    [minScrollDepthInput, 'minScrollDepthError'],
    [maxTokensPerPromptInput, 'maxTokensErrors'],
    ...extraValidationPairs,
  ];

  clearAllFieldErrors(errorPairs);

  if (!validateAllFields(protocolInput, portInput, minVisitDurationInput, minScrollDepthInput, maxTokensPerPromptInput)) {
    return { success: false, error: 'validation_failed' };
  }

  if (obsidianHostInput && !validateObsidianHost(obsidianHostInput)) {
    return { success: false, error: 'invalid_obsidian_host' };
  }

  if (geminiApiVersionInput && !validateGeminiApiVersion(geminiApiVersionInput)) {
    return { success: false, error: 'invalid_gemini_api_version' };
  }

  // HTTP プロトコルが選択されている場合、確認ダイアログを表示
  const protocolValue = protocolInput?.value?.trim().toLowerCase();
  if (protocolValue === 'http') {
    const confirmed = await showConfirmDialog({
      title: getMessage('warningTitle') || 'Warning',
      message: getMessage('confirmProtocolHttp'),
      confirmLabel: getMessage('save') || 'Save',
      cancelLabel: getMessage('cancel') || 'Cancel'
    });
    if (!confirmed) {
      return { success: false, error: 'http_confirm_cancelled' };
    }
  }

  const newSettings = extractSettingsFromInputs(document.querySelector(formSelector) ?? document.body);

  if (includeTiming) {
    const timing = extractLocalMarkdownExportTiming();
    if (timing) newSettings[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING] = timing;
  }

  // Convert retention select values: "" → null, numeric string → number
  const retentionDaysRaw = newSettings[StorageKeys.SQLITE_RETENTION_DAYS];
  newSettings[StorageKeys.SQLITE_RETENTION_DAYS] =
    retentionDaysRaw === '' || retentionDaysRaw === undefined ? null : Number(retentionDaysRaw);
  const maxRecordsRaw = newSettings[StorageKeys.SQLITE_MAX_RECORDS];
  newSettings[StorageKeys.SQLITE_MAX_RECORDS] =
    maxRecordsRaw === '' || maxRecordsRaw === undefined ? null : Number(maxRecordsRaw);

  // Content retention (PBI-3)
  const contentDaysRaw = newSettings[StorageKeys.CONTENT_RETENTION_DAYS];
  newSettings[StorageKeys.CONTENT_RETENTION_DAYS] =
    contentDaysRaw === '' || contentDaysRaw === undefined ? null : Number(contentDaysRaw);
  const contentMaxRaw = newSettings[StorageKeys.CONTENT_MAX_RECORDS];
  newSettings[StorageKeys.CONTENT_MAX_RECORDS] =
    contentMaxRaw === '' || contentMaxRaw === undefined ? null : Number(contentMaxRaw);

  const currentSettings = await getSettings();
  const mergedSettings = { ...currentSettings, ...newSettings };

  await saveSettingsWithAllowedUrls(mergedSettings);

  options.onSuccess?.();

  return { success: true };
}
