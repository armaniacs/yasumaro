/**
 * settingsForm.ts
 * 一般設定パネルのフォーム読み込みと保持ポリシーの手動実行
 *
 * Split out of dashboard.ts (PBI 2026-08-09-24) for the same reason as
 * connectionTests.ts: driven only by the general settings panel, but leaving
 * it in the god module inverted the dependency between the panel layer and
 * the module it was meant to replace.
 */

import { StorageKeys, ProviderSlot, type Settings } from '../../utils/storage/types.js';
import { settingsRepository, type SettingsReader } from '../../utils/storage/SettingsRepository.js';
import { loadSettingsToInputs, loadLocalMarkdownExportTiming } from '../../utils/settingsFormBinding.js';
import { GENERAL_SETTINGS_SCHEMA } from '../../utils/settingsSchemas.js';
import { getMessageOr } from '../../utils/i18n.js';
import { getPluralKey } from '../../utils/i18nPlural.js';
import { getAiProviderElements, updateAIProviderVisibilityMulti } from '../settings/aiProvider.js';
import { providerIdsInOrder } from '../aiProviderCatalogView.js';
import { updateProviderSettingsLayout } from '../aiProviderLayoutManager.js';
import { purgeOldRecordsNow, purgeContentNow } from '../dashboardSqliteService.js';
import { runPanelAction, unwrapServiceResult } from '../panels/panelAction.js';

const SETTINGS_FORM_SELECTOR = '#panel-general';

/**
 * 優先度1〜3位のセレクト・モデル入力欄からProviderSlot[]を組み立てる
 */
export function collectProviderPrioritySlots(): ProviderSlot[] {
  const aiProviderSelect = document.getElementById('aiProvider') as HTMLSelectElement | null;
  const aiProviderPriority1ModelInput = document.getElementById('aiProviderPriority1Model') as HTMLInputElement | null;
  const aiProviderPriority2Select = document.getElementById('aiProviderPriority2') as HTMLSelectElement | null;
  const aiProviderPriority2ModelInput = document.getElementById('aiProviderPriority2Model') as HTMLInputElement | null;
  const aiProviderPriority3Select = document.getElementById('aiProviderPriority3') as HTMLSelectElement | null;
  const aiProviderPriority3ModelInput = document.getElementById('aiProviderPriority3Model') as HTMLInputElement | null;
  const slots: ProviderSlot[] = [];

  if (aiProviderSelect?.value) {
    const model = aiProviderPriority1ModelInput?.value.trim();
    slots.push(model ? { provider: aiProviderSelect.value, model } : { provider: aiProviderSelect.value });
  }
  if (aiProviderPriority2Select?.value) {
    const model = aiProviderPriority2ModelInput?.value.trim();
    slots.push(model ? { provider: aiProviderPriority2Select.value, model } : { provider: aiProviderPriority2Select.value });
  }
  if (aiProviderPriority3Select?.value) {
    const model = aiProviderPriority3ModelInput?.value.trim();
    slots.push(model ? { provider: aiProviderPriority3Select.value, model } : { provider: aiProviderPriority3Select.value });
  }

  return slots;
}

/**
 * ProviderSlot[]を優先度1〜3位のセレクト・モデル入力欄に反映する
 */
export function applyProviderPrioritySlots(slots: ProviderSlot[]): void {
  const [slot1, slot2, slot3] = slots;
  const aiProviderSelect = document.getElementById('aiProvider') as HTMLSelectElement | null;
  const aiProviderPriority1ModelInput = document.getElementById('aiProviderPriority1Model') as HTMLInputElement | null;
  const aiProviderPriority2Select = document.getElementById('aiProviderPriority2') as HTMLSelectElement | null;
  const aiProviderPriority2ModelInput = document.getElementById('aiProviderPriority2Model') as HTMLInputElement | null;
  const aiProviderPriority3Select = document.getElementById('aiProviderPriority3') as HTMLSelectElement | null;
  const aiProviderPriority3ModelInput = document.getElementById('aiProviderPriority3Model') as HTMLInputElement | null;

  if (aiProviderSelect) {
    aiProviderSelect.value = slot1?.provider ?? providerIdsInOrder()[0] ?? 'gemini';
  }
  if (aiProviderPriority1ModelInput) {
    aiProviderPriority1ModelInput.value = slot1?.model ?? '';
  }
  if (aiProviderPriority2Select) {
    aiProviderPriority2Select.value = slot2?.provider ?? '';
  }
  if (aiProviderPriority2ModelInput) {
    aiProviderPriority2ModelInput.value = slot2?.model ?? '';
  }
  if (aiProviderPriority3Select) {
    aiProviderPriority3Select.value = slot3?.provider ?? '';
  }
  if (aiProviderPriority3ModelInput) {
    aiProviderPriority3ModelInput.value = slot3?.model ?? '';
  }
}

/**
 * Checkbox → visibility rules shared by load-time apply and change-time
 * wiring. Adding a 4th rule is one row here — both timings loop this table
 * so they cannot drift.
 */
export interface VisibilityRule {
  readonly inputId: string;
  readonly targetId: string;
  readonly apply: (target: HTMLElement, checked: boolean) => void;
}

export const VISIBLE_WHEN: ReadonlyArray<VisibilityRule> = [
  {
    inputId: 'obsidianEnabled',
    targetId: 'obsidianSettingsDetails',
    apply: (target, checked) => {
      (target as HTMLDetailsElement).open = checked;
    },
  },
  {
    inputId: 'localMarkdownExportEnabled',
    targetId: 'localMarkdownExportSettings',
    apply: (target, checked) => {
      target.classList.toggle('hidden', !checked);
    },
  },
  {
    inputId: 'reviewSummaryEnabled',
    targetId: 'reviewSummaryManualActions',
    apply: (target, checked) => {
      target.classList.toggle('hidden', !checked);
    },
  },
];

type QueryRoot = { querySelector(sel: string): Element | null };

/** Apply every VISIBLE_WHEN rule once (load-time sync). */
export function applyVisibilityToggles(root: QueryRoot = document): void {
  for (const rule of VISIBLE_WHEN) {
    const input = root.querySelector(`#${rule.inputId}`) as HTMLInputElement | null;
    const target = root.querySelector(`#${rule.targetId}`) as HTMLElement | null;
    if (input && target) rule.apply(target, input.checked);
  }
}

/** Wire every VISIBLE_WHEN rule to its checkbox change event. */
export function setupVisibilityToggles(root: QueryRoot = document): void {
  for (const rule of VISIBLE_WHEN) {
    const input = root.querySelector(`#${rule.inputId}`) as HTMLInputElement | null;
    const target = root.querySelector(`#${rule.targetId}`) as HTMLElement | null;
    if (input && target) input.addEventListener('change', () => rule.apply(target, input.checked));
  }
}

function isSettingsReader(value: unknown): value is SettingsReader {
  return !!value && typeof (value as SettingsReader).getAll === 'function';
}

export async function loadGeneralSettings(
  repoOrSnapshot: SettingsReader | Settings = settingsRepository,
  maybeSnapshot?: Settings,
): Promise<void> {
  let settings: Settings;
  if (maybeSnapshot !== undefined) {
    settings = maybeSnapshot;
  } else if (isSettingsReader(repoOrSnapshot)) {
    settings = await repoOrSnapshot.getAll();
  } else {
    settings = repoOrSnapshot;
  }
  loadSettingsToInputs(document.querySelector(SETTINGS_FORM_SELECTOR) ?? document.body, settings, GENERAL_SETTINGS_SCHEMA);
  loadLocalMarkdownExportTiming(settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING]);

  // Apply provider priority slots and update multi-provider visibility
  const prioritySlots = settings[StorageKeys.AI_PROVIDER_PRIORITY_LIST] ?? [];
  applyProviderPrioritySlots(prioritySlots);
  // Visibility must match what the selects actually show:
  // applyProviderPrioritySlots fills an empty priority-1 slot with the first
  // catalog provider, so deriving the visible set from the raw slots (which
  // can be absent/empty) desyncs the two and hides every settings block while
  // the select still shows a provider. Mirror applyProviderPrioritySlots's
  // fallback rule here instead of reading the raw slots back.
  const selectedProviders = [
    prioritySlots[0]?.provider ?? providerIdsInOrder()[0] ?? '',
    prioritySlots[1]?.provider ?? '',
    prioritySlots[2]?.provider ?? '',
  ];
  updateAIProviderVisibilityMulti(getAiProviderElements(), selectedProviders);
  updateProviderSettingsLayout(selectedProviders);

  // Sync checkbox-driven visibility (obsidian details, local export,
  // review summary) — one loop over VISIBLE_WHEN so load-time and
  // change-time apply the same rules.
  applyVisibilityToggles(document);

  // Load openai-compatible provider selection
  const selectedProviderInfoDiv = document.getElementById('selectedProviderInfo') as HTMLElement | null;
  const providerInfoDisplayDiv = document.getElementById('providerInfoDisplay') as HTMLElement | null;
    const providerType = settings[StorageKeys.PROVIDER_TYPE];
    const providerBaseUrl = settings[StorageKeys.PROVIDER_BASE_URL];
    if (providerType && providerBaseUrl && selectedProviderInfoDiv && providerInfoDisplayDiv) {
    selectedProviderInfoDiv.classList.remove('hidden');
    providerInfoDisplayDiv.textContent = `${providerType} (${providerBaseUrl})`;
  } else if (selectedProviderInfoDiv) {
    selectedProviderInfoDiv.classList.add('hidden');
  }

  updateRetentionUnlimitedWarning();
}

/**
 * Show the unlimited-retention warning only when BOTH record-layer bounds
 * (retention days and max records) are set to Unlimited — either one alone
 * already bounds storage growth.
 */
export function updateRetentionUnlimitedWarning(): void {
  const warning = document.getElementById('retentionUnlimitedWarning');
  if (!warning) return;
  const daysEl = document.getElementById('sqliteRetentionDays') as HTMLSelectElement | null;
  const maxEl = document.getElementById('sqliteMaxRecords') as HTMLSelectElement | null;
  const unlimited = (daysEl?.value ?? '365') === '' && (maxEl?.value ?? '') === '';
  warning.hidden = !unlimited;
}

/**
 * Wire the change listeners that keep the unlimited-retention warning in
 * sync with the two record-layer bound selects. Idempotent per mount — the
 * panel wiring block runs once per panel mount.
 */
export function setupRetentionUnlimitedWarning(): void {
  document.getElementById('sqliteRetentionDays')?.addEventListener('change', updateRetentionUnlimitedWarning);
  document.getElementById('sqliteMaxRecords')?.addEventListener('change', updateRetentionUnlimitedWarning);
  updateRetentionUnlimitedWarning();
}

export async function handlePurgeNow(): Promise<void> {
  const purgeNowBtn = document.getElementById('purgeNowBtn') as HTMLButtonElement | null;
  const statusEl = document.getElementById('purgeNowStatus');
  if (!purgeNowBtn || !statusEl) return;

  await runPanelAction({
    buttons: [purgeNowBtn],
    onStart: () => {
      statusEl.textContent = '';
    },
    run: async () => unwrapServiceResult(await purgeOldRecordsNow()),
    onSuccess: (data) => {
      if (data.skipped) {
        statusEl.textContent = getMessageOr('purgeNowSkipped', '保持ポリシーが未設定のため、削除をスキップしました');
      } else {
        statusEl.textContent = getMessageOr(getPluralKey('purgeNowSuccess', data.purged), `${data.purged} 件を削除しました`, [String(data.purged)]);
      }
    },
    // A rejected gateway call never reaches the ServiceResult branches above, so
    // without this the status span stays blank and the click looks like a no-op.
    // The technical reason is preserved after a localized prefix so a missing
    // translation never swallows the failure silently.
    onError: (message) => {
      const prefix = getMessageOr('purgeNowFailed', 'Purge failed');
      const detail = (message || '').trim();
      statusEl.textContent = detail ? `${prefix}: ${detail}` : prefix;
    },
  });
}

export async function handleContentPurgeNow(): Promise<void> {
  const contentPurgeNowBtn = document.getElementById('contentPurgeNowBtn') as HTMLButtonElement | null;
  const statusEl = document.getElementById('contentPurgeNowStatus');
  if (!contentPurgeNowBtn || !statusEl) return;

  await runPanelAction({
    buttons: [contentPurgeNowBtn],
    onStart: () => {
      statusEl.textContent = '';
    },
    run: async () => unwrapServiceResult(await purgeContentNow()),
    onSuccess: (data) => {
      if (data.skipped) {
        statusEl.textContent = getMessageOr('contentPurgeNowSkipped', 'コンテンツ保持ポリシーが未設定のため、削除をスキップしました');
      } else {
        statusEl.textContent = getMessageOr(getPluralKey('contentPurgeNowSuccess', data.purged), `${data.purged} 件の content を削除しました`, [String(data.purged)]);
      }
    },
    onError: (message) => {
      const prefix = getMessageOr('contentPurgeNowFailed', 'Content purge failed');
      const detail = (message || '').trim();
      statusEl.textContent = detail ? `${prefix}: ${detail}` : prefix;
    },
  });
}
