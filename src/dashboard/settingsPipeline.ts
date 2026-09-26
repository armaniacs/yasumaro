/**
 * settingsPipeline.ts
 * Shared settings save pipeline for dashboard panels.
 *
 * Consolidates the repeated read→merge→save→refresh pattern found in
 * handleSaveOnly, handleTestAi, and handleTestLocalMarkdown.
 */

import { settingsRepository } from '../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../utils/storage/types.js';
import { saveSettingsAndRefreshDomainFilterCache } from '../utils/storage/domainFilterCache.js';
import { extractSettingsFromInputs, extractLocalMarkdownExportTiming, isProviderConnectionField, type ValidationSchema } from '../utils/settingsFormBinding.js';
import { GENERAL_SETTINGS_SCHEMA } from '../utils/settingsSchemas.js';
import { GENERAL_SETTINGS_FIELDS } from './settings/fieldDescriptor.js';
import { collectProviderPrioritySlots } from './generalSettings/settingsForm.js';
import { collectBProviderPrioritySlots, validateBContainer } from './aiProviderB/priorityListView.js';
import { clearAllFieldErrors, validateAllFields, validateObsidianHost, validateGeminiApiVersion, setFieldError, ErrorPair } from './settings/fieldValidation.js';
import { getMessage, getMessageOr } from '../utils/i18n.js';
import { isLoopbackHost } from '../utils/obsidianConfigValidator.js';
import { logInfo } from '../utils/logger/api.js';
import { showConfirmDialog } from './utils/confirmDialog.js';
import { confirmNewProviderBaseUrls } from './providerOriginConfirmation.js';
import { syncStatusToTop } from './statusView.js';

/**
 * General settings validation schema — derived from the descriptor table
 * (settings/fieldDescriptor.ts), which is the single source of truth for the
 * 7 element IDs that were previously hardcoded here. Order is positional:
 * saveDashboardSettings indexes pairs[0..6] below.
 */
export const GENERAL_SETTINGS_VALIDATION_FIELDS: ValidationSchema =
  GENERAL_SETTINGS_FIELDS.map(({ storageKey, elementId, errorId }) => ({
    storageKey,
    elementId,
    errorId,
  }));

/**
 * Resolve a ValidationSchema into ErrorPair[] (element, errorId) by looking
 * up each element ID in the DOM.
 */
function resolveValidationPairs(schema: ValidationSchema): ErrorPair[] {
  return schema.map((field) => [
    document.getElementById(field.elementId) as HTMLInputElement | null,
    field.errorId,
  ]);
}

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

  const pairs = resolveValidationPairs(GENERAL_SETTINGS_VALIDATION_FIELDS);
  const getElement = (index: number): HTMLInputElement | null => pairs[index]?.[0] ?? null;
  const protocolInput = getElement(0);
  const portInput = getElement(1);
  const obsidianHostInput = getElement(2);
  const geminiApiVersionInput = getElement(3);
  const minVisitDurationInput = getElement(4);
  const minScrollDepthInput = getElement(5);
  const maxTokensPerPromptInput = getElement(6);

  const errorPairs: ErrorPair[] = [
    ...pairs,
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
    // Cross-check with the host field: buildFromSettings blocks plaintext
    // HTTP to non-loopback hosts, so saving such a config would produce a
    // setting that fails at sync time. Reject at save time with the same
    // rule (single source of truth: isLoopbackHost).
    const hostValue = obsidianHostInput?.value?.trim() ?? '';
    if (obsidianHostInput && hostValue !== '' && !isLoopbackHost(hostValue)) {
      setFieldError(obsidianHostInput, 'obsidianHostError', getMessage('errorHttpNonLoopback'));
      return { success: false, error: 'http_non_loopback_blocked' };
    }
    const confirmed = await showConfirmDialog({
      title: getMessageOr('warningTitle', 'Warning'),
      message: getMessage('confirmProtocolHttp'),
      confirmLabel: getMessageOr('save', 'Save'),
      cancelLabel: getMessageOr('cancel', 'Cancel')});
    if (!confirmed) {
      return { success: false, error: 'http_confirm_cancelled' };
    }
  }

  const newSettings = extractSettingsFromInputs(document.querySelector(formSelector) ?? document.body, GENERAL_SETTINGS_SCHEMA);
  // A/B分岐: layout === 'b' のときはBの優先度リストから収集
  const layout = (await settingsRepository.getAll())[StorageKeys.AI_PROVIDER_LAYOUT] as 'a' | 'b' | undefined;
  if (layout === 'b') {
    const bList = document.getElementById('bPriorityList') as HTMLElement | null;
    const hasBRow = !!bList?.querySelector('.b-priority-row');
    if (bList && hasBRow) {
      try {
        newSettings[StorageKeys.AI_PROVIDER_PRIORITY_LIST] = collectBProviderPrioritySlots(bList);
      } catch {
        newSettings[StorageKeys.AI_PROVIDER_PRIORITY_LIST] = collectProviderPrioritySlots();
      }
      // Bレイアウト時の保存ブロック: P1必須（Spec §6）。Aは従来通りフォールバックでgeminiのためブロックしない。
      const { p1Empty, duplicateRowIndices, valid } = validateBContainer(bList);
      // UIの重複警告を同期（row-aware）
      const rows = [...bList.querySelectorAll<HTMLElement>('.b-priority-row')];
      rows.forEach((r, i) => r.classList.toggle('has-error', duplicateRowIndices.includes(i)));
      let warn = bList.querySelector('.b-priority-warn') as HTMLElement | null;
      if (!valid) {
        if (!warn) {
          warn = document.createElement('div');
          warn.className = 'b-priority-warn field-error';
          warn.setAttribute('role', 'alert');
          bList.appendChild(warn);
        }
        warn.textContent = getMessageOr('aiProviderPriorityDuplicateWarning', 'Duplicate provider and model');
      } else {
        warn?.remove();
      }
      let reqWarn = bList.querySelector('.b-priority-req-warn') as HTMLElement | null;
      if (p1Empty) {
        if (!reqWarn) {
          reqWarn = document.createElement('div');
          reqWarn.className = 'b-priority-req-warn field-error';
          reqWarn.setAttribute('role', 'alert');
          bList.appendChild(reqWarn);
        }
        reqWarn.textContent = getMessageOr('aiProviderPriority1Required', 'Priority 1 is required');
        rows[0]?.classList.add('has-error');
        // status エリアにも表示して保存を中断
        const statusEl = document.getElementById('status') as HTMLElement | null;
        if (statusEl) {
          statusEl.textContent = getMessageOr('aiProviderPriority1Required', 'Priority 1 is required');
          statusEl.className = 'error';
          try {
            syncStatusToTop();
          } catch {}
        }
        return { success: false, error: 'aiProviderPriority1Required' };
      } else {
        reqWarn?.remove();
      }
    } else {
      newSettings[StorageKeys.AI_PROVIDER_PRIORITY_LIST] = collectProviderPrioritySlots();
    }
  } else {
    newSettings[StorageKeys.AI_PROVIDER_PRIORITY_LIST] = collectProviderPrioritySlots();
  }

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

  const currentSettings = await settingsRepository.getAll();

  // Guard: never blank a stored provider connection field (base URL / model /
  // API key) with an empty extracted value. An empty input on save means the
  // field was not populated (a UI-desync bug — e.g. the B-layout accordion
  // regression), not an intentional clear. Without this, "Save" wiped
  // openai_base_url / openai_model for users who opened a broken form.
  for (const key of Object.keys(newSettings)) {
    if (!isProviderConnectionField(key)) continue;
    const next = newSettings[key];
    const cur = (currentSettings as Record<string, unknown>)[key];
    const nextEmpty = next === '' || next === undefined || next === null;
    const curPresent = cur !== '' && cur !== undefined && cur !== null;
    if (nextEmpty && curPresent) {
      delete newSettings[key];
      logInfo(
        'settingsPipeline',
        { key },
        'Skipped overwriting a stored provider connection field with an empty value',
      );
    }
  }

  // Provider origin authorization (VULN-002 fix): a base URL whose origin is
  // new (not pinned, not loopback, not yet confirmed) requires the explicit
  // user acknowledgement recorded in confirmed_provider_origins before the
  // write may proceed.
  const originConfirmation = await confirmNewProviderBaseUrls(newSettings);
  if (originConfirmation === 'cancelled') {
    return { success: false, error: 'provider_origin_confirmation_cancelled' };
  }

  // Delta write (PBI 2026-09-17-17): only the extracted form keys enter the
  // payload — merging the full currentSettings snapshot here would revert
  // unrelated keys a concurrent writer changed. setAll already merges the
  // delta over freshly-read storage under the write lock.
  await saveSettingsAndRefreshDomainFilterCache(newSettings);

  options.onSuccess?.();

  return { success: true };
}
