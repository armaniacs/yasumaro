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
import { validateBContainer } from './aiProviderB/priorityListView.js';
import { collectCurrentProviderPrioritySlots, isBPriorityListActive } from './providerPrioritySlots.js';
import { clearAllFieldErrors, validateAllFields, setFieldError, ErrorPair } from './settings/fieldValidation.js';
import { getMessage, getMessageOr } from '../utils/i18n.js';
import { isLoopbackHost } from '../utils/obsidianConfigValidator.js';
import { logInfo } from '../utils/logger/api.js';
import { showConfirmDialog } from './utils/confirmDialog.js';
import { confirmNewProviderBaseUrls } from './providerOriginConfirmation.js';
import { showStatus } from '../utils/ui/settingsUiHelper.js';

/**
 * General settings validation schema — derived from the descriptor table
 * (settings/fieldDescriptor.ts), which is the single source of truth for the
 * 7 element/error IDs that were previously hardcoded here. Order is positional:
 * saveDashboardSettings indexes pairs[0] and pairs[2] below. The same table also
 * drives fieldValidation's validation sweep, so the clear targets here cannot
 * drift from the fields that raise them.
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

/**
 * Save-failure wording, defined once for the four call sites that render a
 * saveDashboardSettings failure into the general-settings status area. Each of
 * them used to re-spell the same i18n key and fallback inline, so the wording
 * could drift per call site.
 */
const SAVE_ERROR_MESSAGES: Readonly<Record<string, readonly [key: string, fallback: string]>> = {
  aiProviderPriority1Required: ['aiProviderPriority1Required', 'Priority 1 is required'],
  aiProviderPriorityDuplicateWarning: ['aiProviderPriorityDuplicateWarning', 'Duplicate provider and model'],
};

/**
 * Numeric retention keys whose form value coerces `''|undefined → null` and
 * any other string via `Number()`. Adding a 5th key is one row here — the
 * save path loops this table so coercion cannot be forgotten per key.
 */
export const NUMERIC_TO_NULL: ReadonlyArray<string> = [
  StorageKeys.SQLITE_RETENTION_DAYS,
  StorageKeys.SQLITE_MAX_RECORDS,
  StorageKeys.CONTENT_RETENTION_DAYS,
  StorageKeys.CONTENT_MAX_RECORDS,
];

/** Apply the NUMERIC_TO_NULL coercion to an extracted settings delta. */
export function applyNumericNullCoercion(newSettings: Record<string, unknown>): void {
  for (const key of NUMERIC_TO_NULL) {
    const raw = newSettings[key];
    newSettings[key] = raw === '' || raw === undefined ? null : Number(raw);
  }
}

/**
 * Render the B-layout priority warnings (duplicate + P1-required) into the
 * B list container. Pure DOM sync extracted from saveDashboardSettings so
 * the save path keeps only validate → render → return.
 */
export function renderBPriorityWarnings(bList: HTMLElement): { p1Empty: boolean } {
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
  } else {
    reqWarn?.remove();
  }
  return { p1Empty };
}

/** Message for a saveDashboardSettings failure; unknown errors share one text. */
export function saveErrorText(error: string | undefined): string {
  const entry = error ? SAVE_ERROR_MESSAGES[error] : undefined;
  if (entry) return getMessageOr(entry[0], entry[1]);
  return getMessageOr('saveError', '設定の保存に失敗しました。');
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
  const obsidianHostInput = getElement(2);

  const errorPairs: ErrorPair[] = [
    ...pairs,
    ...extraValidationPairs,
  ];

  clearAllFieldErrors(errorPairs);

  if (!validateAllFields()) {
    return { success: false, error: 'validation_failed' };
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
  // Single snapshot shared by the layout gate and the empty-value guard
  // below — one fetch per save instead of two reads of the same state.
  const currentSettings = await settingsRepository.getAll();
  // A/B collection lives in collectCurrentProviderPrioritySlots; the gate
  // below only guards the B validation UI + P1 save block, not collection.
  const layout = (currentSettings as Record<string, unknown>)[StorageKeys.AI_PROVIDER_LAYOUT] as 'a' | 'b' | undefined;
  const bList = document.getElementById('bPriorityList') as HTMLElement | null;
  // Throw semantics (PBI 2026-10-02-09; B-throw unified): any collector
  // failure (A or B) propagates out of collectCurrentProviderPrioritySlots.
  // A failed collection must abort the save as { success: false } (rendered
  // by callers via saveErrorText's generic saveError text) rather than
  // persist a silently-blanked priority list while the B UI still shows rows.
  try {
    newSettings[StorageKeys.AI_PROVIDER_PRIORITY_LIST] = collectCurrentProviderPrioritySlots({ layout, bList });
  } catch {
    logInfo('Provider priority collection failed; aborting save', { layout }, 'settingsPipeline');
    return { success: false, error: 'collector_failed' };
  }
  if (isBPriorityListActive(layout, bList)) {
    // Bレイアウト時の保存ブロック: P1必須（Spec §6）。Aは従来通りフォールバックでgeminiのためブロックしない。
    const { p1Empty } = renderBPriorityWarnings(bList);
    if (p1Empty) {
      // status エリアにも表示して保存を中断
      const statusEl = document.getElementById('status') as HTMLElement | null;
      if (statusEl) {
        showStatus(statusEl, saveErrorText('aiProviderPriority1Required'), 'error', { autoClear: false });
      }
      return { success: false, error: 'aiProviderPriority1Required' };
    }
  }

  if (includeTiming) {
    const timing = extractLocalMarkdownExportTiming();
    if (timing) newSettings[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING] = timing;
  }

  // Convert retention select values: "" → null, numeric string → number
  applyNumericNullCoercion(newSettings as Record<string, unknown>);

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
        'Skipped overwriting a stored provider connection field with an empty value',
        { key },
        'settingsPipeline',
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
