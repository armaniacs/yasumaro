/**
 * settingsForm.ts
 * 一般設定パネルのフォーム読み込みと保持ポリシーの手動実行
 *
 * Split out of dashboard.ts (PBI 2026-08-09-24) for the same reason as
 * connectionTests.ts: driven only by the general settings panel, but leaving
 * it in the god module inverted the dependency between the panel layer and
 * the module it was meant to replace.
 */

import { StorageKeys, getSettings, ProviderSlot } from '../../utils/storage.js';
import { loadSettingsToInputs, loadLocalMarkdownExportTiming } from '../../utils/settingsFormBinding.js';
import { getMessage } from '../../utils/i18n.js';
import { getPluralKey } from '../../utils/i18nPlural.js';
import { getAiProviderElements, updateAIProviderVisibilityMulti } from '../settings/aiProvider.js';
import { updateProviderSettingsLayout } from '../aiProviderLayoutManager.js';
import type { DashboardSqliteResponseFor } from '../../background/handlers/dashboardSqliteProtocol.js';
import { CURRENT_PROTOCOL_VERSION } from '../../background/messageTypes.js';

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
    aiProviderSelect.value = slot1?.provider ?? 'gemini';
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

export async function loadGeneralSettings(): Promise<void> {
  const settings = await getSettings();
  loadSettingsToInputs(document.querySelector(SETTINGS_FORM_SELECTOR) ?? document.body, settings);
  loadLocalMarkdownExportTiming(settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING]);

  // Apply provider priority slots and update multi-provider visibility
  const prioritySlots = (settings[StorageKeys.AI_PROVIDER_PRIORITY_LIST] as ProviderSlot[]) ?? [];
  applyProviderPrioritySlots(prioritySlots);
  const selectedProviders = [
    prioritySlots[0]?.provider ?? '',
    prioritySlots[1]?.provider ?? '',
    prioritySlots[2]?.provider ?? ''
  ];
  updateAIProviderVisibilityMulti(getAiProviderElements(), selectedProviders);
  updateProviderSettingsLayout(selectedProviders);

  // Sync Obsidian details open state with checkbox
  const obsidianEnabledInput = document.getElementById('obsidianEnabled') as HTMLInputElement | null;
  const details = document.getElementById('obsidianSettingsDetails') as HTMLDetailsElement | null;
  if (details && obsidianEnabledInput) {
    details.open = obsidianEnabledInput.checked;
  }

  // Sync Local Markdown Export settings visibility with checkbox
  const localMarkdownExportEnabledInput = document.getElementById('localMarkdownExportEnabled') as HTMLInputElement | null;
  const localExportSettingsDiv = document.getElementById('localMarkdownExportSettings') as HTMLElement | null;
  if (localExportSettingsDiv && localMarkdownExportEnabledInput) {
    localExportSettingsDiv.classList.toggle('hidden', !localMarkdownExportEnabledInput.checked);
  }

  // Sync Review Summary manual actions visibility with checkbox
  const reviewSummaryManualActionsDiv = document.getElementById('reviewSummaryManualActions') as HTMLElement | null;
  const reviewSummaryEnabledInput = document.getElementById('reviewSummaryEnabled') as HTMLInputElement | null;
  if (reviewSummaryManualActionsDiv && reviewSummaryEnabledInput) {
    reviewSummaryManualActionsDiv.classList.toggle('hidden', !reviewSummaryEnabledInput.checked);
  }

  // Load openai-compatible provider selection
  const selectedProviderInfoDiv = document.getElementById('selectedProviderInfo') as HTMLElement | null;
  const providerInfoDisplayDiv = document.getElementById('providerInfoDisplay') as HTMLElement | null;
  const providerType = settings[StorageKeys.PROVIDER_TYPE] as string;
  const providerBaseUrl = settings[StorageKeys.PROVIDER_BASE_URL] as string;
  if (providerType && providerBaseUrl && selectedProviderInfoDiv && providerInfoDisplayDiv) {
    selectedProviderInfoDiv.classList.remove('hidden');
    providerInfoDisplayDiv.textContent = `${providerType} (${providerBaseUrl})`;
  } else if (selectedProviderInfoDiv) {
    selectedProviderInfoDiv.classList.add('hidden');
  }
}

export async function handlePurgeNow(): Promise<void> {
  const purgeNowBtn = document.getElementById('purgeNowBtn') as HTMLButtonElement | null;
  const statusEl = document.getElementById('purgeNowStatus');
  if (!purgeNowBtn || !statusEl) return;

  purgeNowBtn.disabled = true;
  statusEl.textContent = '';
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'DASHBOARD_SQLITE',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      payload: { subtype: 'purge_now' },
    }) as DashboardSqliteResponseFor<'purge_now'> | undefined;

    if (result?.success && result.skipped) {
      statusEl.textContent = getMessage('purgeNowSkipped') || '保持ポリシーが未設定のため、削除をスキップしました';
    } else if (result?.success) {
      statusEl.textContent = getMessage(getPluralKey('purgeNowSuccess', result.purged), [String(result.purged)]) || `${result.purged} 件を削除しました`;
    } else {
      statusEl.textContent = result?.success === false ? result.error : 'Error';
    }
  } finally {
    purgeNowBtn.disabled = false;
  }
}

export async function handleContentPurgeNow(): Promise<void> {
  const contentPurgeNowBtn = document.getElementById('contentPurgeNowBtn') as HTMLButtonElement | null;
  const statusEl = document.getElementById('contentPurgeNowStatus');
  if (!contentPurgeNowBtn || !statusEl) return;

  contentPurgeNowBtn.disabled = true;
  statusEl.textContent = '';
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'DASHBOARD_SQLITE',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      payload: { subtype: 'content_purge_now' },
    }) as DashboardSqliteResponseFor<'content_purge_now'> | undefined;

    if (result?.success && result.skipped) {
      statusEl.textContent = getMessage('contentPurgeNowSkipped') || 'コンテンツ保持ポリシーが未設定のため、削除をスキップしました';
    } else if (result?.success) {
      statusEl.textContent = getMessage(getPluralKey('contentPurgeNowSuccess', result.purged), [String(result.purged)]) || `${result.purged} 件の content を削除しました`;
    } else {
      statusEl.textContent = result?.success === false ? result.error : 'Error';
    }
  } finally {
    contentPurgeNowBtn.disabled = false;
  }
}
