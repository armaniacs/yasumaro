/**
 * dashboard.ts
 * ダッシュボードページのメイン初期化モジュール
 * popup.ts の設定ロジックを流用し、フルページダッシュボードとして動作する
 */

import { StorageKeys, getSettings, saveSettingsWithAllowedUrls, ProviderSlot } from '../utils/storage.js';
import { init as initDomainFilter } from '../popup/domainFilter.js';
import { init as initPrivacySettings } from '../popup/privacySettings.js';
import { init as initContentSettings } from '../popup/contentSettings.js';
import { init as initTrustSettings, loadTrustSettings } from '../popup/trustSettings.js';
import { initCustomPromptManager } from '../popup/customPromptManager.js';
import { loadSettingsToInputs, extractSettingsFromInputs } from '../popup/settingsUiHelper.js';
import { clearAllFieldErrors, validateAllFields, ErrorPair } from '../popup/settings/fieldValidation.js';
import { getMessage } from '../popup/i18n.js';
import { getAiSummaryCleansingSettings, applyAiSummaryCleansingSettingsToUI, setupAiSummaryCleansingEventListeners } from '../popup/aiSummaryCleansingSettings.js';
import { STATUS_COLORS } from '../constants/appConstants.js';
import { getPrivacyConsent, withdrawPrivacyConsent } from '../popup/privacyConsent.js';
import { setupAIProviderChangeListener, updateAIProviderVisibility, updateAIProviderVisibilityMulti, AIProviderElements } from '../popup/settings/aiProvider.js';
import { setupAllFieldValidations } from '../popup/settings/fieldValidation.js';
import { focusTrapManager } from '../popup/utils/focusTrap.js';
import { getSavedUrlEntries } from '../utils/storageUrls.js';
import { initHistoryPanel } from './historyPanel.js';
import { initSqliteHistoryPanel } from './sqliteHistoryPanel.js';
import { initRecordingConditionsSettings } from './recordingConditionsSettings.js';
import { exportMarkdown, exportCsv, exportJson, exportDb, downloadText, downloadBlob } from './exportLogsService.js';
import { ModelsDevDialog } from './models-dev-dialog.js';
import { CSPSettings } from './cspSettings.js';
import { computeCleansingStats, renderStatsSummary, renderFunnelChart } from './cleansingStatsView.js';
import { initMasterPasswordSettings, loadMasterPasswordSettings } from './masterPassword.js';
import { queryLogs } from './dashboardSqliteService.js';
import { initExportImport } from './exportImport.js';
import { initEncryptedBackupPanel } from './encryptedBackupPanel.js';
import { initGistSettings } from './gistSettings.js';
import { initDomainFilterTagUI } from './domainFilterTagUI.js';
import { initTagsPanel } from './tagsPanel.js';
import { initTagClusterPanel } from './tagClusterPanel.js';
import { initDomainSearchPanel } from './domainSearchPanel.js';
import { initDiagnosticsPanel } from './diagnosticsPanel.js';
import { initAuditLogPanel } from './auditLogPanel.js';
import { initTrancoConsentPanel } from './trancoConsent.js';
import { clearAllLogs } from './dashboardSqliteService.js';
import { showConfirmDialog } from './utils/confirmDialog.js';
import { initOnboardingWizard } from '../popup/onboardingWizard.js';
import { updateProviderSettingsLayout, hideAllProviderSettings } from './aiProviderLayoutManager.js';
import { initNavigation } from './navigation.js';

// ============================================================================
// Sidebar Navigation
// ============================================================================

export function initSidebarNav(): void {
  const navBtns = document.querySelectorAll<HTMLButtonElement>('.sidebar-nav-btn');
  const panels = document.querySelectorAll<HTMLElement>('.panel');

  const sidebarNav = document.querySelector<HTMLElement>('.sidebar-nav');
  if (sidebarNav) {
    sidebarNav.setAttribute('role', 'tablist');
    sidebarNav.setAttribute('aria-orientation', 'vertical');
  }

  navBtns.forEach((btn, idx) => {
    btn.setAttribute('role', 'tab');
    if (!btn.id) btn.id = `sidebar-tab-${idx}`;
    const panelId = btn.getAttribute('data-panel');
    if (panelId) btn.setAttribute('aria-controls', panelId);
  });

  panels.forEach(panel => {
    panel.setAttribute('role', 'tabpanel');
    const controllingBtn = document.querySelector<HTMLButtonElement>(`[data-panel="${panel.id}"]`);
    if (controllingBtn) panel.setAttribute('aria-labelledby', controllingBtn.id);
  });

  const activateBtn = (index: number): void => {
    navBtns.forEach((b, i) => {
      const selected = i === index;
      b.setAttribute('aria-selected', String(selected));
      b.setAttribute('tabindex', selected ? '0' : '-1');
      if (selected) b.classList.add('active');
      else b.classList.remove('active');
    });
    const targetPanelId = navBtns[index]?.getAttribute('data-panel');
    panels.forEach(panel => {
      if (panel.id === targetPanelId) panel.classList.add('active');
      else panel.classList.remove('active');
    });
  };

  navBtns.forEach((btn, i) => {
    btn.addEventListener('click', () => {
      activateBtn(i);
      const targetPanelId = btn.getAttribute('data-panel');

      if (targetPanelId === 'panel-ai-summary-cleansing') {
        requestAnimationFrame(() => {
          getSavedUrlEntries().then(panelEntries => {
            const summaryEl = document.getElementById('cleansingStatsSummary') as HTMLElement | null;
            const chartEl = document.getElementById('cleansingFunnelChart') as HTMLCanvasElement | null;
            if (!summaryEl) return;
            const stats = computeCleansingStats(panelEntries);
            renderStatsSummary(summaryEl, stats);
            if (chartEl) {
              if (stats.count === 0) {
                chartEl.style.display = 'none';
              } else {
                chartEl.style.display = 'block';
                renderFunnelChart(chartEl, stats);
              }
            }
          }).catch(() => { /* ignore */ });
        });
      }

      if (targetPanelId === 'panel-audit-log') {
        requestAnimationFrame(() => {
          try {
            void initAuditLogPanel();
          } catch (e) {
            console.error('[Dashboard] initAuditLogPanel error on panel switch:', e);
          }
        });
      }
    });

    btn.addEventListener('keydown', (e) => {
      const key = e.key;
      let targetIndex: number | null = null;
      if (key === 'ArrowDown') targetIndex = (i + 1) % navBtns.length;
      else if (key === 'ArrowUp') targetIndex = (i - 1 + navBtns.length) % navBtns.length;
      else if (key === 'Home') targetIndex = 0;
      else if (key === 'End') targetIndex = navBtns.length - 1;
      if (targetIndex !== null) {
        e.preventDefault();
        navBtns[targetIndex]!.focus();
        activateBtn(targetIndex);
      }
    });
  });

  const activeIndex = Array.from(navBtns).findIndex(b => b.classList.contains('active'));
  activateBtn(activeIndex >= 0 ? activeIndex : 0);
}

export function openSettingsPanel(section: string): void {
  const panelMap: Record<string, string> = {
    obsidian: 'panel-general',
    'ai-provider': 'panel-general',
    general: 'panel-general',
  };

  const panelId = panelMap[section];
  if (!panelId) return;

  const navBtn = document.querySelector<HTMLButtonElement>(`.sidebar-nav-btn[data-panel="${panelId}"]`);
  if (navBtn) {
    navBtn.click();
  }

  if (section === 'obsidian') {
    const details = document.getElementById('obsidianSettingsDetails') as HTMLDetailsElement | null;
    if (details) {
      details.open = true;
      details.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } else if (section === 'ai-provider') {
    const aiSection = document.getElementById('aiProviderSection');
    if (aiSection) {
      aiSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

// ============================================================================
// DOM Elements - General Settings Form (Lazy Initialization)
// ============================================================================
// Elements are fetched lazily to support testability (jsdom sets up DOM after import).

let _domElements: {
  apiKeyInput: HTMLInputElement | null;
  protocolInput: HTMLInputElement | null;
  portInput: HTMLInputElement | null;
  dailyPathInput: HTMLInputElement | null;
  obsidianEnabledInput: HTMLInputElement | null;
  aiProviderSelect: HTMLSelectElement | null;
  aiProviderPriority1ModelInput: HTMLInputElement | null;
  aiProviderPriority2Select: HTMLSelectElement | null;
  aiProviderPriority2ModelInput: HTMLInputElement | null;
  aiProviderPriority3Select: HTMLSelectElement | null;
  aiProviderPriority3ModelInput: HTMLInputElement | null;
  geminiSettingsDiv: HTMLElement | null;
  openaiSettingsDiv: HTMLElement | null;
  openai2SettingsDiv: HTMLElement | null;
  lmStudioSettingsDiv: HTMLElement | null;
  openaiCompatibleSettingsDiv: HTMLElement | null;
  geminiApiKeyInput: HTMLInputElement | null;
  geminiModelInput: HTMLInputElement | null;
  openaiBaseUrlInput: HTMLInputElement | null;
  openaiApiKeyInput: HTMLInputElement | null;
  openaiModelInput: HTMLInputElement | null;
  openai2BaseUrlInput: HTMLInputElement | null;
  openai2ApiKeyInput: HTMLInputElement | null;
  openai2ModelInput: HTMLInputElement | null;
  lmStudioBaseUrlInput: HTMLInputElement | null;
  lmStudioModelInput: HTMLInputElement | null;
  ollamaSettingsDiv: HTMLElement | null;
  ollamaBaseUrlInput: HTMLInputElement | null;
  ollamaModelInput: HTMLInputElement | null;
  providerBaseUrlInput: HTMLInputElement | null;
  providerApiKeyInput: HTMLInputElement | null;
  providerModelInput: HTMLInputElement | null;
  saveBtn: HTMLButtonElement | null;
  testObsidianBtn: HTMLButtonElement | null;
  testAiBtn: HTMLButtonElement | null;
  statusDiv: HTMLElement | null;
  statusTopDiv: HTMLElement | null;
  sqliteRetentionDaysSelect: HTMLSelectElement | null;
  sqliteMaxRecordsSelect: HTMLSelectElement | null;
  purgeNowBtn: HTMLButtonElement | null;
  contentRetentionDaysSelect: HTMLSelectElement | null;
  contentMaxRecordsSelect: HTMLSelectElement | null;
  contentPurgeIncludeStarredCheckbox: HTMLInputElement | null;
  contentPurgeNowBtn: HTMLButtonElement | null;
  localMarkdownExportEnabledInput: HTMLInputElement | null;
  localMarkdownExportTimingRadios: NodeListOf<HTMLInputElement> | null;
  localMarkdownExportPathInput: HTMLInputElement | null;
  localMarkdownExportSettingsDiv: HTMLElement | null;
  testLocalMarkdownBtn: HTMLButtonElement | null;
  reviewSummaryEnabledInput: HTMLInputElement | null;
  reviewSummaryManualActionsDiv: HTMLElement | null;
  generateWeeklySummaryBtn: HTMLButtonElement | null;
  generateMonthlySummaryBtn: HTMLButtonElement | null;
  reviewSummaryStatusDiv: HTMLElement | null;
} | null = null;

export function resetDashboardElements(): void {
  _domElements = null;
}

export function getDashboardElements() {
  if (!_domElements && typeof document !== 'undefined') {
    _domElements = {
      apiKeyInput: document.getElementById('apiKey') as HTMLInputElement | null,
      protocolInput: document.getElementById('protocol') as HTMLInputElement | null,
      portInput: document.getElementById('port') as HTMLInputElement | null,
      dailyPathInput: document.getElementById('dailyPath') as HTMLInputElement | null,
      obsidianEnabledInput: document.getElementById('obsidianEnabled') as HTMLInputElement | null,
      aiProviderSelect: document.getElementById('aiProvider') as HTMLSelectElement | null,
      aiProviderPriority1ModelInput: document.getElementById('aiProviderPriority1Model') as HTMLInputElement | null,
      aiProviderPriority2Select: document.getElementById('aiProviderPriority2') as HTMLSelectElement | null,
      aiProviderPriority2ModelInput: document.getElementById('aiProviderPriority2Model') as HTMLInputElement | null,
      aiProviderPriority3Select: document.getElementById('aiProviderPriority3') as HTMLSelectElement | null,
      aiProviderPriority3ModelInput: document.getElementById('aiProviderPriority3Model') as HTMLInputElement | null,
      geminiSettingsDiv: document.getElementById('geminiSettings') as HTMLElement | null,
      openaiSettingsDiv: document.getElementById('openaiSettings') as HTMLElement | null,
      openai2SettingsDiv: document.getElementById('openai2Settings') as HTMLElement | null,
      lmStudioSettingsDiv: document.getElementById('lm-studioSettings') as HTMLElement | null,
      openaiCompatibleSettingsDiv: document.getElementById('openai-compatibleSettings') as HTMLElement | null,
      geminiApiKeyInput: document.getElementById('geminiApiKey') as HTMLInputElement | null,
      geminiModelInput: document.getElementById('geminiModel') as HTMLInputElement | null,
      openaiBaseUrlInput: document.getElementById('openaiBaseUrl') as HTMLInputElement | null,
      openaiApiKeyInput: document.getElementById('openaiApiKey') as HTMLInputElement | null,
      openaiModelInput: document.getElementById('openaiModel') as HTMLInputElement | null,
      openai2BaseUrlInput: document.getElementById('openai2BaseUrl') as HTMLInputElement | null,
      openai2ApiKeyInput: document.getElementById('openai2ApiKey') as HTMLInputElement | null,
      openai2ModelInput: document.getElementById('openai2Model') as HTMLInputElement | null,
      lmStudioBaseUrlInput: document.getElementById('lmStudioBaseUrl') as HTMLInputElement | null,
      lmStudioModelInput: document.getElementById('lmStudioModel') as HTMLInputElement | null,
      ollamaSettingsDiv: document.getElementById('ollamaSettings') as HTMLElement | null,
      ollamaBaseUrlInput: document.getElementById('ollamaBaseUrl') as HTMLInputElement | null,
      ollamaModelInput: document.getElementById('ollamaModel') as HTMLInputElement | null,
      providerBaseUrlInput: document.getElementById('providerBaseUrl') as HTMLInputElement | null,
      providerApiKeyInput: document.getElementById('providerApiKey') as HTMLInputElement | null,
      providerModelInput: document.getElementById('providerModel') as HTMLInputElement | null,
      saveBtn: document.getElementById('save') as HTMLButtonElement | null,
      testObsidianBtn: document.getElementById('testObsidianBtn') as HTMLButtonElement | null,
      testAiBtn: document.getElementById('testAiBtn') as HTMLButtonElement | null,
      statusDiv: document.getElementById('status') as HTMLElement | null,
      statusTopDiv: document.getElementById('statusTop') as HTMLElement | null,
      sqliteRetentionDaysSelect: document.getElementById('sqliteRetentionDays') as HTMLSelectElement | null,
      sqliteMaxRecordsSelect: document.getElementById('sqliteMaxRecords') as HTMLSelectElement | null,
      purgeNowBtn: document.getElementById('purgeNowBtn') as HTMLButtonElement | null,
      contentRetentionDaysSelect: document.getElementById('contentRetentionDays') as HTMLSelectElement | null,
      contentMaxRecordsSelect: document.getElementById('contentMaxRecords') as HTMLSelectElement | null,
      contentPurgeIncludeStarredCheckbox: document.getElementById('contentPurgeIncludeStarred') as HTMLInputElement | null,
      contentPurgeNowBtn: document.getElementById('contentPurgeNowBtn') as HTMLButtonElement | null,
      localMarkdownExportEnabledInput: document.getElementById('localMarkdownExportEnabled') as HTMLInputElement | null,
      localMarkdownExportTimingRadios: document.querySelectorAll('input[name="localMarkdownExportTiming"]') as NodeListOf<HTMLInputElement>,
      localMarkdownExportPathInput: document.getElementById('localMarkdownExportPath') as HTMLInputElement | null,
      localMarkdownExportSettingsDiv: document.getElementById('localMarkdownExportSettings') as HTMLElement | null,
      testLocalMarkdownBtn: document.getElementById('testLocalMarkdownBtnTop') as HTMLButtonElement | null,
      reviewSummaryEnabledInput: document.getElementById('reviewSummaryEnabled') as HTMLInputElement | null,
      reviewSummaryManualActionsDiv: document.getElementById('reviewSummaryManualActions') as HTMLElement | null,
      generateWeeklySummaryBtn: document.getElementById('generateWeeklySummaryBtn') as HTMLButtonElement | null,
      generateMonthlySummaryBtn: document.getElementById('generateMonthlySummaryBtn') as HTMLButtonElement | null,
      reviewSummaryStatusDiv: document.getElementById('reviewSummaryStatus') as HTMLElement | null,
    };
  }
  return _domElements ?? {
    apiKeyInput: null, protocolInput: null, portInput: null, dailyPathInput: null,
    obsidianEnabledInput: null,
    aiProviderSelect: null, aiProviderPriority1ModelInput: null,
    aiProviderPriority2Select: null, aiProviderPriority2ModelInput: null,
    aiProviderPriority3Select: null, aiProviderPriority3ModelInput: null,
    geminiSettingsDiv: null, openaiSettingsDiv: null,
    openai2SettingsDiv: null, lmStudioSettingsDiv: null, openaiCompatibleSettingsDiv: null,
    geminiApiKeyInput: null, geminiModelInput: null, openaiBaseUrlInput: null,
    openaiApiKeyInput: null, openaiModelInput: null, openai2BaseUrlInput: null,
    openai2ApiKeyInput: null, openai2ModelInput: null, lmStudioBaseUrlInput: null,
    lmStudioModelInput: null, ollamaSettingsDiv: null, ollamaBaseUrlInput: null,
    ollamaModelInput: null, providerBaseUrlInput: null, providerApiKeyInput: null,
    providerModelInput: null, saveBtn: null,
    testObsidianBtn: null, testAiBtn: null, statusDiv: null, statusTopDiv: null,
    sqliteRetentionDaysSelect: null, sqliteMaxRecordsSelect: null, purgeNowBtn: null,
    contentRetentionDaysSelect: null, contentMaxRecordsSelect: null,
    contentPurgeIncludeStarredCheckbox: null, contentPurgeNowBtn: null,
    localMarkdownExportEnabledInput: null, localMarkdownExportTimingRadios: null,
    localMarkdownExportPathInput: null, localMarkdownExportSettingsDiv: null,
    testLocalMarkdownBtn: null,
    reviewSummaryEnabledInput: null, reviewSummaryManualActionsDiv: null,
    generateWeeklySummaryBtn: null, generateMonthlySummaryBtn: null, reviewSummaryStatusDiv: null,
  };
}

/**
 * Sync status display between top and bottom status divs.
 * Copies the content and class from the bottom status div to the top status div.
 */
function syncStatusToTop(): void {
  const el = getDashboardElements();
  if (el.statusTopDiv && el.statusDiv) {
    el.statusTopDiv.innerHTML = el.statusDiv.innerHTML;
    el.statusTopDiv.className = el.statusDiv.className;
  }
}

export function getSettingsMapping(): Record<string, HTMLInputElement | HTMLSelectElement | null> {
  const el = getDashboardElements();
  return {
    [StorageKeys.OBSIDIAN_API_KEY]: el.apiKeyInput,
    [StorageKeys.OBSIDIAN_PROTOCOL]: el.protocolInput,
    [StorageKeys.OBSIDIAN_PORT]: el.portInput,
    [StorageKeys.OBSIDIAN_DAILY_PATH]: el.dailyPathInput,
    [StorageKeys.OBSIDIAN_ENABLED]: el.obsidianEnabledInput,
    [StorageKeys.AI_PROVIDER]: el.aiProviderSelect,
    [StorageKeys.GEMINI_API_KEY]: el.geminiApiKeyInput,
    [StorageKeys.GEMINI_MODEL]: el.geminiModelInput,
    [StorageKeys.OPENAI_BASE_URL]: el.openaiBaseUrlInput,
    [StorageKeys.OPENAI_API_KEY]: el.openaiApiKeyInput,
    [StorageKeys.OPENAI_MODEL]: el.openaiModelInput,
    [StorageKeys.OPENAI_2_BASE_URL]: el.openai2BaseUrlInput,
    [StorageKeys.OPENAI_2_API_KEY]: el.openai2ApiKeyInput,
    [StorageKeys.OPENAI_2_MODEL]: el.openai2ModelInput,
    [StorageKeys.LM_STUDIO_BASE_URL]: el.lmStudioBaseUrlInput,
    [StorageKeys.LM_STUDIO_MODEL]: el.lmStudioModelInput,
    [StorageKeys.OLLAMA_BASE_URL]: el.ollamaBaseUrlInput,
    [StorageKeys.OLLAMA_MODEL]: el.ollamaModelInput,
    [StorageKeys.PROVIDER_TYPE]: null,
    [StorageKeys.PROVIDER_BASE_URL]: el.providerBaseUrlInput,
    [StorageKeys.PROVIDER_API_KEY]: el.providerApiKeyInput,
    [StorageKeys.PROVIDER_MODEL]: el.providerModelInput,
    [StorageKeys.SQLITE_RETENTION_DAYS]: el.sqliteRetentionDaysSelect,
    [StorageKeys.SQLITE_MAX_RECORDS]: el.sqliteMaxRecordsSelect,
    [StorageKeys.CONTENT_RETENTION_DAYS]: el.contentRetentionDaysSelect,
    [StorageKeys.CONTENT_MAX_RECORDS]: el.contentMaxRecordsSelect,
    [StorageKeys.CONTENT_PURGE_INCLUDE_STARRED]: el.contentPurgeIncludeStarredCheckbox,
    [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: el.localMarkdownExportEnabledInput,
    [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: el.localMarkdownExportPathInput,
    [StorageKeys.REVIEW_SUMMARY_ENABLED]: el.reviewSummaryEnabledInput,
  };
}

/**
 * Read the LOCAL_MARKDOWN_EXPORT_TIMING radio group's checked value.
 * Returns undefined when no radio is checked (should not happen once
 * loadLocalMarkdownExportTiming has run, but guards against a blank DOM).
 */
export function extractLocalMarkdownExportTiming(): string | undefined {
  const el = getDashboardElements();
  if (!el.localMarkdownExportTimingRadios) return undefined;
  for (const radio of el.localMarkdownExportTimingRadios) {
    if (radio.checked) return radio.value;
  }
  return undefined;
}

/**
 * Apply a LOCAL_MARKDOWN_EXPORT_TIMING value to the radio group.
 */
export function loadLocalMarkdownExportTiming(timing: string | undefined): void {
  const el = getDashboardElements();
  if (!el.localMarkdownExportTimingRadios) return;
  for (const radio of el.localMarkdownExportTimingRadios) {
    radio.checked = radio.value === timing;
  }
}

export function getAiProviderElements(): AIProviderElements {
  const el = getDashboardElements();
  return {
    select: el.aiProviderSelect as HTMLSelectElement,
    geminiSettings: el.geminiSettingsDiv as HTMLElement,
    openaiSettings: el.openaiSettingsDiv as HTMLElement,
    openai2Settings: el.openai2SettingsDiv as HTMLElement,
    lmStudioSettings: el.lmStudioSettingsDiv ?? undefined,
    ollamaSettings: el.ollamaSettingsDiv ?? undefined,
    openaiCompatibleSettings: el.openaiCompatibleSettingsDiv ?? undefined
  };
}

/**
 * 優先度1〜3位のセレクト・モデル入力欄からProviderSlot[]を組み立てる
 */
export function collectProviderPrioritySlots(): ProviderSlot[] {
  const el = getDashboardElements();
  const slots: ProviderSlot[] = [];

  if (el.aiProviderSelect?.value) {
    const model = el.aiProviderPriority1ModelInput?.value.trim();
    slots.push(model ? { provider: el.aiProviderSelect.value, model } : { provider: el.aiProviderSelect.value });
  }
  if (el.aiProviderPriority2Select?.value) {
    const model = el.aiProviderPriority2ModelInput?.value.trim();
    slots.push(model ? { provider: el.aiProviderPriority2Select.value, model } : { provider: el.aiProviderPriority2Select.value });
  }
  if (el.aiProviderPriority3Select?.value) {
    const model = el.aiProviderPriority3ModelInput?.value.trim();
    slots.push(model ? { provider: el.aiProviderPriority3Select.value, model } : { provider: el.aiProviderPriority3Select.value });
  }

  return slots;
}

/**
 * ProviderSlot[]を優先度1〜3位のセレクト・モデル入力欄に反映する
 */
export function applyProviderPrioritySlots(slots: ProviderSlot[]): void {
  const el = getDashboardElements();
  const [slot1, slot2, slot3] = slots;

  if (el.aiProviderSelect) {
    el.aiProviderSelect.value = slot1?.provider ?? 'gemini';
  }
  if (el.aiProviderPriority1ModelInput) {
    el.aiProviderPriority1ModelInput.value = slot1?.model ?? '';
  }
  if (el.aiProviderPriority2Select) {
    el.aiProviderPriority2Select.value = slot2?.provider ?? '';
  }
  if (el.aiProviderPriority2ModelInput) {
    el.aiProviderPriority2ModelInput.value = slot2?.model ?? '';
  }
  if (el.aiProviderPriority3Select) {
    el.aiProviderPriority3Select.value = slot3?.provider ?? '';
  }
  if (el.aiProviderPriority3ModelInput) {
    el.aiProviderPriority3ModelInput.value = slot3?.model ?? '';
  }
}

export async function loadGeneralSettings(): Promise<void> {
  const settings = await getSettings();
  loadSettingsToInputs(settings, getSettingsMapping());
  loadLocalMarkdownExportTiming(settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING]);

  // Apply provider priority slots and update multi-provider visibility
  const prioritySlots = (settings[StorageKeys.AI_PROVIDER_PRIORITY_LIST] as ProviderSlot[]) ?? [];
  applyProviderPrioritySlots(prioritySlots);
  updateAIProviderVisibilityMulti(
    getAiProviderElements(),
    [
      prioritySlots[0]?.provider ?? '',
      prioritySlots[1]?.provider ?? '',
      prioritySlots[2]?.provider ?? ''
    ]
  );

  // Sync Obsidian details open state with checkbox
  const el = getDashboardElements();
  const details = document.getElementById('obsidianSettingsDetails') as HTMLDetailsElement | null;
  if (details && el.obsidianEnabledInput) {
    details.open = el.obsidianEnabledInput.checked;
  }

  // Sync Local Markdown Export settings visibility with checkbox
  const localExportSettingsDiv = document.getElementById('localMarkdownExportSettings') as HTMLElement | null;
  if (localExportSettingsDiv && el.localMarkdownExportEnabledInput) {
    localExportSettingsDiv.classList.toggle('hidden', !el.localMarkdownExportEnabledInput.checked);
  }

  // Sync Review Summary manual actions visibility with checkbox
  if (el.reviewSummaryManualActionsDiv && el.reviewSummaryEnabledInput) {
    el.reviewSummaryManualActionsDiv.classList.toggle('hidden', !el.reviewSummaryEnabledInput.checked);
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

// ============================================================================
// Connection Test Helpers
// ============================================================================

export function createConnectionStatusElement(label: string, result: { success: boolean; message: string }, successColor: string, errorColor: string): HTMLElement {
  const statusDiv = document.createElement('div');
  statusDiv.style.marginBottom = '8px';

  const labelEl = document.createElement('strong');
  labelEl.textContent = `${label}: `;
  statusDiv.appendChild(labelEl);

  const spanEl = document.createElement('span');
  if (result.success) {
    spanEl.textContent = getMessage('connectionSuccess') || '接続成功';
    spanEl.style.color = successColor;
  } else {
    spanEl.textContent = result.message;
    spanEl.style.color = errorColor;
  }
  statusDiv.appendChild(spanEl);

  return statusDiv;
}

export async function testObsidianConnection(apiKey: string): Promise<{ success: boolean; message: string }> {
  const el = getDashboardElements();
  const testResult = await chrome.runtime.sendMessage({
    type: 'TEST_OBSIDIAN',
    payload: apiKey
      ? {
          protocol: el.protocolInput?.value?.trim(),
          port: el.portInput?.value?.trim(),
          apiKey: apiKey,
        }
      : {}
  }) as { obsidian?: { success: boolean; message: string } };

  return testResult?.obsidian || { success: false, message: 'No response' };
}

export async function testAiConnection(): Promise<{ success: boolean; message: string }> {
  const testResult = await chrome.runtime.sendMessage({
    type: 'TEST_AI',
    payload: {}
  }) as { ai?: { success: boolean; message: string } };

  return testResult?.ai || { success: false, message: 'No response' };
}

export async function handleSaveOnly(): Promise<void> {
  const el = getDashboardElements();
  if (!el.statusDiv) return;
  el.statusDiv.textContent = '';
  el.statusDiv.className = '';

  const errorPairs: ErrorPair[] = [
    [el.protocolInput, 'protocolError'],
    [el.portInput, 'portError'],
  ];
  clearAllFieldErrors(errorPairs);

  if (!validateAllFields(el.protocolInput, el.portInput)) {
    return;
  }

  // HTTP プロトコルが選択されている場合、確認ダイアログを表示
  const protocolValue = el.protocolInput?.value?.trim().toLowerCase();
  if (protocolValue === 'http') {
    const confirmed = await showConfirmDialog({
      title: getMessage('warningTitle') || 'Warning',
      message: getMessage('confirmProtocolHttp'),
      confirmLabel: getMessage('save') || 'Save',
      cancelLabel: getMessage('cancel') || 'Cancel'
    });
    if (!confirmed) {
      return;
    }
  }

  const newSettings = extractSettingsFromInputs(getSettingsMapping());
  const timing = extractLocalMarkdownExportTiming();
  if (timing) newSettings[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING] = timing;

  // Convert retention select values: "" → null, numeric string → number
  const retentionDaysRaw = newSettings[StorageKeys.SQLITE_RETENTION_DAYS];
  newSettings[StorageKeys.SQLITE_RETENTION_DAYS] =
    retentionDaysRaw === '' || retentionDaysRaw === undefined ? null : Number(retentionDaysRaw);
  const maxRecordsRaw = newSettings[StorageKeys.SQLITE_MAX_RECORDS];
  newSettings[StorageKeys.SQLITE_MAX_RECORDS] =
    maxRecordsRaw === '' || maxRecordsRaw === undefined ? null : Number(maxRecordsRaw);

  // Content retention (PBI-3) — same null handling as SQLITE_RETENTION
  const contentDaysRaw = newSettings[StorageKeys.CONTENT_RETENTION_DAYS];
  newSettings[StorageKeys.CONTENT_RETENTION_DAYS] =
    contentDaysRaw === '' || contentDaysRaw === undefined ? null : Number(contentDaysRaw);
  const contentMaxRaw = newSettings[StorageKeys.CONTENT_MAX_RECORDS];
  newSettings[StorageKeys.CONTENT_MAX_RECORDS] =
    contentMaxRaw === '' || contentMaxRaw === undefined ? null : Number(contentMaxRaw);

  const currentSettings = await getSettings();
  const mergedSettings = { ...currentSettings, ...newSettings };
  // Add provider priority slots
  mergedSettings[StorageKeys.AI_PROVIDER_PRIORITY_LIST] = collectProviderPrioritySlots();
  await saveSettingsWithAllowedUrls(mergedSettings);

  el.statusDiv.textContent = getMessage('saveSuccess') || '設定を保存しました。';
  el.statusDiv.className = 'success';
  syncStatusToTop();
}

export async function handleTestObsidian(): Promise<void> {
  const el = getDashboardElements();
  if (!el.testObsidianBtn || !el.statusDiv) return;

  el.statusDiv.innerHTML = '';
  el.statusDiv.className = '';
  el.statusDiv.textContent = getMessage('testingConnection') || '接続テスト中...';

  el.testObsidianBtn.disabled = true;
  try {
    const typedApiKey = el.apiKeyInput?.value?.trim();
    const obsidianResult = await testObsidianConnection(typedApiKey || '');

    el.statusDiv.innerHTML = '';
    el.statusDiv.appendChild(createConnectionStatusElement('Obsidian', obsidianResult, STATUS_COLORS.SUCCESS, STATUS_COLORS.ERROR));

    // HTTPS証明書警告
    if (!obsidianResult.success && obsidianResult.message.includes('Failed to fetch') && el.protocolInput?.value === 'https') {
      const port = parseInt(el.portInput?.value?.trim() || '0', 10);
      const url = `https://127.0.0.1:${port}/`;
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.textContent = getMessage('acceptCertificate') || '証明書を承認する';
      link.rel = 'noopener noreferrer';
      el.statusDiv.appendChild(document.createElement('br'));
      el.statusDiv.appendChild(link);
    }

    el.statusDiv.className = obsidianResult.success ? 'success' : 'error';
    syncStatusToTop();
  } catch (e) {
    el.statusDiv.textContent = getMessage('testError') || '接続テストに失敗しました。';
    el.statusDiv.className = 'error';
    syncStatusToTop();
  } finally {
    el.testObsidianBtn.disabled = false;
  }
}

export async function handleTestAi(): Promise<void> {
  const el = getDashboardElements();
  if (!el.testAiBtn || !el.statusDiv) return;

  el.statusDiv.innerHTML = '';
  el.statusDiv.className = '';
  el.statusDiv.textContent = getMessage('testingConnection') || '接続テスト中...';

  el.testAiBtn.disabled = true;
  try {
    const newSettings = extractSettingsFromInputs(getSettingsMapping());
    const timing = extractLocalMarkdownExportTiming();
    if (timing) newSettings[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING] = timing;
    const currentSettings = await getSettings();
    const mergedSettings = { ...currentSettings, ...newSettings };
    await saveSettingsWithAllowedUrls(mergedSettings);

    const aiResult = await testAiConnection();

    el.statusDiv.innerHTML = '';
    el.statusDiv.appendChild(createConnectionStatusElement('AI', aiResult, STATUS_COLORS.SUCCESS, STATUS_COLORS.ERROR));

    el.statusDiv.className = aiResult.success ? 'success' : 'error';
    syncStatusToTop();
  } catch (e) {
    el.statusDiv.textContent = getMessage('testError') || '接続テストに失敗しました。';
    el.statusDiv.className = 'error';
    syncStatusToTop();
  } finally {
    el.testAiBtn.disabled = false;
  }
}

export async function handleTestLocalMarkdown(): Promise<void> {
  const el = getDashboardElements();
  if (!el.testLocalMarkdownBtn || !el.statusTopDiv) return;

  el.statusTopDiv.innerHTML = '';
  el.statusTopDiv.className = '';
  el.statusTopDiv.textContent = getMessage('testingConnection') || '接続テスト中...';

  el.testLocalMarkdownBtn.disabled = true;
  try {
    // Save current settings first
    const newSettings = extractSettingsFromInputs(getSettingsMapping());
    const timing = extractLocalMarkdownExportTiming();
    if (timing) newSettings[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING] = timing;
    const currentSettings = await getSettings();
    const mergedSettings = { ...currentSettings, ...newSettings };
    await saveSettingsWithAllowedUrls(mergedSettings);

    // Check if enabled
    const localExportEnabled = mergedSettings[StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED];
    if (!localExportEnabled) {
      el.statusTopDiv.textContent = getMessage('testLocalMarkdownDisabled') || 'ローカルMarkdown書き出しが無効です。まず有効にしてください。';
      el.statusTopDiv.className = 'error';
      return;
    }

    // Create test content
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    const testContent = `# ${date}\n\n- ${time} [Yasumaro Test](https://example.com)\n    - This is a test entry for local Markdown export. If you can see this file, the export is working correctly!`;

    // Download test file
    const exportPath = (mergedSettings[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH] as string) || 'Yasumaro';
    const blob = new Blob([testContent], { type: 'text/markdown' });
    const blobUrl = URL.createObjectURL(blob);

    await chrome.downloads.download({
      url: blobUrl,
      filename: `${exportPath}/test-${date}.md`,
      saveAs: false,
      conflictAction: 'overwrite'
    });

    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

    el.statusTopDiv.textContent = getMessage('testLocalMarkdownSuccess') || 'ローカルMarkdown書き出しテスト: ファイルのダウンロードに成功しました';
    el.statusTopDiv.className = 'success';
  } catch (e) {
    el.statusTopDiv.textContent = getMessage('testLocalMarkdownError') || 'ローカルMarkdown書き出しテストに失敗しました';
    el.statusTopDiv.className = 'error';
  } finally {
    el.testLocalMarkdownBtn.disabled = false;
  }
}

/**
 * Format a single browsing log entry as markdown
 */
function formatEntryToMarkdown(entry: { title?: string | null; url: string; summary?: string | null; created_at: number }): string {
  const timestamp = new Date(entry.created_at).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit'
  });
  const title = entry.title || entry.url || 'Untitled';
  const summary = (entry.summary || 'Summary not available.').replace(/\n+/g, ' ').replace(/  +/g, ' ').trim();
  return `- ${timestamp} [${title}](${entry.url})\n    - ${summary}`;
}

/**
 * Get local date string (YYYY-MM-DD) from timestamp
 */
function getLocalDateString(timestamp: number): string {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Handle manual local markdown export with date range
 */
export async function handleManualLocalMarkdownExport(): Promise<void> {
  const startDateInput = document.getElementById('localExportStartDate') as HTMLInputElement | null;
  const endDateInput = document.getElementById('localExportEndDate') as HTMLInputElement | null;
  const exportBtn = document.getElementById('localExportManualBtn') as HTMLButtonElement | null;
  const statusEl = document.getElementById('localExportManualStatus') as HTMLElement | null;

  if (!exportBtn || !statusEl) return;

  exportBtn.disabled = true;
  statusEl.textContent = '';
  statusEl.className = '';

  try {
    const settings = await getSettings();
    const exportPath = (settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH] as string) || 'Yasumaro';

    // Parse date range (YYYY-MM-DD format from date input)
    const startDate = startDateInput?.value || new Date().toISOString().split('T')[0];
    const endDate = endDateInput?.value || startDate;

    // Create timestamps at start of start date and end of end date in local timezone
    const since = new Date(startDate + 'T00:00:00').getTime();
    const until = new Date(endDate + 'T23:59:59').getTime();

    statusEl.textContent = getMessage('searching') || 'Searching...';

    // Query SQLite for records in date range
    const result = await queryLogs({ since, until, limit: 10000, orderBy: 'created_at', orderDir: 'ASC' });

    if (!result || result.rows.length === 0) {
      statusEl.textContent = '指定期間に記録がありません。';
      statusEl.className = 'error';
      return;
    }

    // Group entries by local date
    const entriesByDate = new Map<string, typeof result.rows>();
    for (const row of result.rows) {
      const date = getLocalDateString(row.created_at);
      if (!entriesByDate.has(date)) {
        entriesByDate.set(date, []);
      }
      entriesByDate.get(date)!.push(row);
    }

    // Generate markdown for each date
    let totalFiles = 0;
    for (const [date, entries] of entriesByDate) {
      const header = `# ${date}`;
      const content = header + '\n\n' + entries.map(e => formatEntryToMarkdown(e)).join('\n\n');

      const blob = new Blob([content], { type: 'text/markdown' });
      const blobUrl = URL.createObjectURL(blob);

      await chrome.downloads.download({
        url: blobUrl,
        filename: `${exportPath}/${date}.md`,
        saveAs: false,
        conflictAction: 'overwrite'
      });

      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      totalFiles++;
    }

    statusEl.textContent = `${result.rows.length}件の記録を${totalFiles}ファイルにエクスポートしました。`;
    statusEl.className = 'success';
  } catch (e) {
    statusEl.textContent = `エクスポートに失敗しました: ${e instanceof Error ? e.message : String(e)}`;
    statusEl.className = 'error';
  } finally {
    exportBtn.disabled = false;
  }
}

/**
 * Handle local markdown export from Export Logs panel (date range)
 */
export async function handleExportLocalMarkdown(): Promise<void> {
  const startDateInput = document.getElementById('exportLocalStartDate') as HTMLInputElement | null;
  const endDateInput = document.getElementById('exportLocalEndDate') as HTMLInputElement | null;
  const exportBtn = document.getElementById('exportLocalMarkdownBtn') as HTMLButtonElement | null;
  const statusEl = document.getElementById('exportLocalMarkdownStatus') as HTMLElement | null;

  if (!exportBtn || !statusEl) return;

  exportBtn.disabled = true;
  statusEl.textContent = '';
  statusEl.className = '';

  try {
    const settings = await getSettings();
    const exportPath = (settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH] as string) || 'Yasumaro';

    const startDate = startDateInput?.value || new Date().toISOString().split('T')[0];
    const endDate = endDateInput?.value || startDate;

    const since = new Date(startDate + 'T00:00:00').getTime();
    const until = new Date(endDate + 'T23:59:59').getTime();

    statusEl.textContent = getMessage('searching') || 'Searching...';

    const result = await queryLogs({ since, until, limit: 10000, orderBy: 'created_at', orderDir: 'ASC' });

    if (!result || result.rows.length === 0) {
      statusEl.textContent = '指定期間に記録がありません。';
      statusEl.className = 'error';
      return;
    }

    const entriesByDate = new Map<string, typeof result.rows>();
    for (const row of result.rows) {
      const date = getLocalDateString(row.created_at);
      if (!entriesByDate.has(date)) {
        entriesByDate.set(date, []);
      }
      entriesByDate.get(date)!.push(row);
    }

    let totalFiles = 0;
    for (const [date, entries] of entriesByDate) {
      const header = `# ${date}`;
      const content = header + '\n\n' + entries.map(e => formatEntryToMarkdown(e)).join('\n\n');

      const blob = new Blob([content], { type: 'text/markdown' });
      const blobUrl = URL.createObjectURL(blob);

      await chrome.downloads.download({
        url: blobUrl,
        filename: `${exportPath}/${date}.md`,
        saveAs: false,
        conflictAction: 'overwrite'
      });

      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      totalFiles++;
    }

    statusEl.textContent = `${result.rows.length}件の記録を${totalFiles}ファイルにエクスポートしました。`;
    statusEl.className = 'success';
  } catch (e) {
    statusEl.textContent = `エクスポートに失敗しました: ${e instanceof Error ? e.message : String(e)}`;
    statusEl.className = 'error';
  } finally {
    exportBtn.disabled = false;
  }
}

/**
 * Handle review summary manual generation
 */
export async function handleGenerateWeeklySummary(): Promise<void> {
  const el = getDashboardElements();
  if (!el.generateWeeklySummaryBtn || !el.reviewSummaryStatusDiv) return;

  const btn = el.generateWeeklySummaryBtn;
  const statusEl = el.reviewSummaryStatusDiv;

  btn.disabled = true;
  statusEl.textContent = chrome.i18n.getMessage('testingConnection') || '生成中...';
  statusEl.className = '';

  try {
    const { generateWeeklySummary } = await import('../background/reviewSummaryGenerator.js');
    const success = await generateWeeklySummary();
    statusEl.textContent = chrome.i18n.getMessage(
      success ? 'reviewSummaryGenerated' : 'reviewSummarySkipped'
    ) || (success ? 'Summary generated.' : 'No history for the target period.');
    statusEl.className = success ? 'success' : 'info';
  } catch (e) {
    statusEl.textContent = chrome.i18n.getMessage('reviewSummaryFailed') || 'Failed to generate summary.';
    statusEl.className = 'error';
  } finally {
    btn.disabled = false;
  }
}

export async function handleGenerateMonthlySummary(): Promise<void> {
  const el = getDashboardElements();
  if (!el.generateMonthlySummaryBtn || !el.reviewSummaryStatusDiv) return;

  const btn = el.generateMonthlySummaryBtn;
  const statusEl = el.reviewSummaryStatusDiv;

  btn.disabled = true;
  statusEl.textContent = chrome.i18n.getMessage('testingConnection') || '生成中...';
  statusEl.className = '';

  try {
    const { generateMonthlySummary } = await import('../background/reviewSummaryGenerator.js');
    const success = await generateMonthlySummary();
    statusEl.textContent = chrome.i18n.getMessage(
      success ? 'reviewSummaryGenerated' : 'reviewSummarySkipped'
    ) || (success ? 'Summary generated.' : 'No history for the target period.');
    statusEl.className = success ? 'success' : 'info';
  } catch (e) {
    statusEl.textContent = chrome.i18n.getMessage('reviewSummaryFailed') || 'Failed to generate summary.';
    statusEl.className = 'error';
  } finally {
    btn.disabled = false;
  }
}

/**
 * Handle local markdown export from History panel (all records)
 */
export async function handleHistoryExportLocalMarkdown(): Promise<void> {
  const exportBtn = document.getElementById('historyExportLocalMarkdownBtn') as HTMLButtonElement | null;
  const statusEl = document.getElementById('historyExportLocalMarkdownStatus') as HTMLElement | null;

  if (!exportBtn || !statusEl) return;

  exportBtn.disabled = true;
  statusEl.textContent = '';
  statusEl.className = '';

  try {
    const settings = await getSettings();
    const exportPath = (settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH] as string) || 'Yasumaro';

    statusEl.textContent = getMessage('searching') || 'Searching...';

    const result = await queryLogs({ limit: 100000, orderBy: 'created_at', orderDir: 'ASC' });

    if (!result || result.rows.length === 0) {
      statusEl.textContent = 'エクスポートする記録がありません。';
      statusEl.className = 'error';
      return;
    }

    const entriesByDate = new Map<string, typeof result.rows>();
    for (const row of result.rows) {
      const date = getLocalDateString(row.created_at);
      if (!entriesByDate.has(date)) {
        entriesByDate.set(date, []);
      }
      entriesByDate.get(date)!.push(row);
    }

    let totalFiles = 0;
    for (const [date, entries] of entriesByDate) {
      const header = `# ${date}`;
      const content = header + '\n\n' + entries.map(e => formatEntryToMarkdown(e)).join('\n\n');

      const blob = new Blob([content], { type: 'text/markdown' });
      const blobUrl = URL.createObjectURL(blob);

      await chrome.downloads.download({
        url: blobUrl,
        filename: `${exportPath}/${date}.md`,
        saveAs: false,
        conflictAction: 'overwrite'
      });

      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      totalFiles++;
    }

    statusEl.textContent = `${result.rows.length}件の記録を${totalFiles}ファイルにエクスポートしました。`;
    statusEl.className = 'success';
  } catch (e) {
    statusEl.textContent = `エクスポートに失敗しました: ${e instanceof Error ? e.message : String(e)}`;
    statusEl.className = 'error';
  } finally {
    exportBtn.disabled = false;
  }
}

export async function handlePurgeNow(): Promise<void> {
  const el = getDashboardElements();
  const statusEl = document.getElementById('purgeNowStatus');
  if (!el.purgeNowBtn || !statusEl) return;

  el.purgeNowBtn.disabled = true;
  statusEl.textContent = '';
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'DASHBOARD_SQLITE',
      payload: { subtype: 'purge_now' },
    }) as { success: boolean; purged: number; skipped?: boolean; error?: string } | undefined;

    if (result?.skipped) {
      statusEl.textContent = getMessage('purgeNowSkipped') || '保持ポリシーが未設定のため、削除をスキップしました';
    } else if (result?.success) {
      statusEl.textContent = getMessage('purgeNowSuccess', [String(result.purged)]) || `${result.purged} 件を削除しました`;
    } else {
      statusEl.textContent = result?.error ?? 'Error';
    }
  } finally {
    el.purgeNowBtn.disabled = false;
  }
}

export async function handleContentPurgeNow(): Promise<void> {
  const el = getDashboardElements();
  const statusEl = document.getElementById('contentPurgeNowStatus');
  if (!el.contentPurgeNowBtn || !statusEl) return;

  el.contentPurgeNowBtn.disabled = true;
  statusEl.textContent = '';
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'DASHBOARD_SQLITE',
      payload: { subtype: 'content_purge_now' },
    }) as { success: boolean; purged: number; skipped?: boolean; error?: string } | undefined;

    if (result?.skipped) {
      statusEl.textContent = getMessage('contentPurgeNowSkipped') || 'コンテンツ保持ポリシーが未設定のため、削除をスキップしました';
    } else if (result?.success) {
      statusEl.textContent = getMessage('contentPurgeNowSuccess', [String(result.purged)]) || `${result.purged} 件の content を削除しました`;
    } else {
      statusEl.textContent = result?.error ?? 'Error';
    }
  } finally {
    el.contentPurgeNowBtn.disabled = false;
  }
}

// Breaking Changes Notification Modal
// ============================================================================

let breakingChangesTrapId: string | null = null;

const BREAKING_CHANGES_SHOWN_KEY = 'breaking_changes_v5_shown';

function getBreakingChangesElements() {
  return {
    modal: document.getElementById('breakingChangesModal') as HTMLElement | null,
    closeBtn: document.getElementById('closeBreakingChangesModalBtn') as HTMLButtonElement | null,
    dismissBtn: document.getElementById('dismissBreakingChangesModalBtn') as HTMLButtonElement | null,
  };
}

async function showBreakingChangesModal(): Promise<void> {
  // 既に表示済みの場合はスキップ
  const shown = await chrome.storage.local.get(BREAKING_CHANGES_SHOWN_KEY).then(result => result[BREAKING_CHANGES_SHOWN_KEY]);
  if (shown) return;

  const { modal, dismissBtn, closeBtn } = getBreakingChangesElements();
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  void modal.offsetHeight;
  modal.classList.add('show');

  // ボタンのイベントリスナー設定
  dismissBtn?.addEventListener('click', closeBreakingChangesModal);
  closeBtn?.addEventListener('click', closeBreakingChangesModal);

  // Focus trap
  breakingChangesTrapId = focusTrapManager.trap(modal, closeBreakingChangesModal);
  dismissBtn?.focus();
}

async function closeBreakingChangesModal(): Promise<void> {
  const { modal } = getBreakingChangesElements();
  if (!modal) return;
  modal.classList.remove('show');
  modal.style.display = 'none';
  modal.classList.add('hidden');
  if (breakingChangesTrapId) {
    focusTrapManager.release(breakingChangesTrapId);
    breakingChangesTrapId = null;
  }

  // 表示済みとして記録
  await chrome.storage.local.set({ [BREAKING_CHANGES_SHOWN_KEY]: true });
}

// ============================================================================
// Initialization
// ============================================================================

export function setHtmlLangDir(): void {
  const locale = chrome.i18n.getUILanguage();
  const langCode = locale.split('-')[0];
  document.documentElement.lang = locale;
  const rtlLanguages = ['ar', 'he', 'fa', 'ur', 'ku', 'yi', 'dv'];
  document.documentElement.dir = rtlLanguages.includes(langCode) ? 'rtl' : 'ltr';
}

async function initConsentWithdrawal(): Promise<void> {
    const display = document.getElementById('consentStatusDisplay');
    const btn = document.getElementById('btnWithdrawConsent');
    const statusEl = document.getElementById('withdrawConsentStatus');

    const state = await getPrivacyConsent();
    if (display) {
        display.textContent = state.hasConsented
            ? chrome.i18n.getMessage('consented') || `Consented (${state.consentDate || ''})`
            : chrome.i18n.getMessage('notConsented') || 'Not consented';
    }
    if (btn) {
        btn.classList.toggle('hidden', !state.hasConsented);
    }
    if (btn) {
        btn.addEventListener('click', async () => {
            const ok = await withdrawPrivacyConsent();
            if (statusEl) {
                statusEl.textContent = ok
                    ? 'Consent withdrawn. Recording will stop.'
                    : 'Failed to withdraw consent.';
                statusEl.style.color = ok ? 'var(--color-success-text)' : 'var(--color-error)';
            }
            if (display) {
                display.textContent = 'Not consented';
            }
            if (btn) {
                btn.classList.add('hidden');
            }
        });
    }
}

// ============================================================================
// Export Logs Panel
// ============================================================================

function initExportLogsPanel(): void {
  const jsonBtn = document.getElementById('export-json-btn');
  const mdBtn = document.getElementById('export-markdown-btn');
  const csvBtn = document.getElementById('export-csv-btn');
  const statusEl = document.getElementById('export-status');

  const showStatus = (msg: string, isError = false) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.display = '';
    statusEl.style.color = isError ? 'var(--color-error)' : 'var(--color-success-text)';
    setTimeout(() => { statusEl!.style.display = 'none'; }, 3000);
  };

  jsonBtn?.addEventListener('click', async () => {
    try {
      showStatus('Exporting JSON…');
      const blob = await exportJson();
      downloadBlob(blob, `yasumaro_export_${new Date().toISOString().split('T')[0]}.json`);
      showStatus('JSON export completed.');
    } catch (err) {
      showStatus(`Export failed: ${err}`, true);
    }
  });

  mdBtn?.addEventListener('click', async () => {
    try {
      showStatus('Exporting Markdown…');
      const md = await exportMarkdown();
      downloadText(md, `yasumaro_export_${new Date().toISOString().split('T')[0]}.md`, 'text/markdown');
      showStatus('Markdown export completed.');
    } catch (err) {
      showStatus(`Export failed: ${err}`, true);
    }
  });

  csvBtn?.addEventListener('click', async () => {
    try {
      showStatus('Exporting CSV…');
      const blob = await exportCsv();
      downloadBlob(blob, `yasumaro_export_${new Date().toISOString().split('T')[0]}.csv`);
      showStatus('CSV export completed.');
    } catch (err) {
      showStatus(`Export failed: ${err}`, true);
    }
  });

  const dbBtn = document.getElementById('export-db-btn');
  dbBtn?.addEventListener('click', async () => {
    try {
      showStatus('Exporting database…');
      const blob = await exportDb();
      if (blob) {
        downloadBlob(blob, `yasumaro_export_${new Date().toISOString().split('T')[0]}.db`);
        showStatus('Database export completed.');
      } else {
        showStatus('Binary export requires OPFS storage. Use JSON export instead.', true);
      }
    } catch (err) {
      showStatus(`Export failed: ${err}`, true);
    }
  });

  // Local Markdown export from Export Logs panel
  document.getElementById('exportLocalMarkdownBtn')?.addEventListener('click', handleExportLocalMarkdown);
}

// ============================================================================
// Dashboard Initialization
// ============================================================================

(async function initDashboard(): Promise<void> {
  console.log('[Dashboard] Starting initialization...');

  try { setHtmlLangDir(); } catch (e) { console.error('[Dashboard] setHtmlLangDir error:', e); }

  initSidebarNav();
  initNavigation();

  // Auto-navigate based on URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('tab') === 'history') {
    const historyBtn = document.querySelector('[data-panel="panel-sqlite-history"]') as HTMLButtonElement;
    if (historyBtn) historyBtn.click();
  }

  const section = urlParams.get('section');
  if (section) {
    openSettingsPanel(section);
  }

  try { initDomainFilter(); } catch (e) { console.error('[Dashboard] initDomainFilter error:', e); }
  try { await initDomainFilterTagUI(); } catch (e) { console.error('[Dashboard] initDomainFilterTagUI error:', e); }
  try { initExportImport(); } catch (e) { console.error('[Dashboard] initExportImport error:', e); }
  try { initEncryptedBackupPanel(); } catch (e) { console.error('[Dashboard] initEncryptedBackupPanel error:', e); }
  try { await initGistSettings(); } catch (e) { console.error('[Dashboard] initGistSettings error:', e); }
  try { initMasterPasswordSettings(); } catch (e) { console.error('[Dashboard] initMasterPasswordSettings error:', e); }
  try { initPrivacySettings(); } catch (e) { console.error('[Dashboard] initPrivacySettings error:', e); }
  try { initContentSettings(); } catch (e) { console.error('[Dashboard] initContentSettings error:', e); }
  try { initTrustSettings(); } catch (e) { console.error('[Dashboard] initTrustSettings error:', e); }
  try { await CSPSettings.loadCSPSettings(); } catch (e) { console.error('[Dashboard] loadCSPSettings error:', e); }
  try {
    const aiSummaryCleansingSettings = await getAiSummaryCleansingSettings();
    applyAiSummaryCleansingSettingsToUI(aiSummaryCleansingSettings);
    setupAiSummaryCleansingEventListeners();
  } catch (e) { console.error('[Dashboard] initAiSummaryCleansingSettings error:', e); }

  try {
    const settings = await getSettings();
    initCustomPromptManager(settings);
  } catch (e) { console.error('[Dashboard] initCustomPromptManager error:', e); }

  try { await loadGeneralSettings(); } catch (e) { console.error('[Dashboard] loadGeneralSettings error:', e); }

  // Obsidian enabled checkbox → details open/close
  const obsidianEnabledInput = document.getElementById('obsidianEnabled') as HTMLInputElement | null;
  const obsidianDetails = document.getElementById('obsidianSettingsDetails') as HTMLDetailsElement | null;
  if (obsidianEnabledInput && obsidianDetails) {
    obsidianEnabledInput.addEventListener('change', () => {
      obsidianDetails.open = obsidianEnabledInput.checked;
    });
  }

  // Local Markdown Export enabled checkbox → settings visibility
  const localExportEnabledInput = document.getElementById('localMarkdownExportEnabled') as HTMLInputElement | null;
  const localExportSettingsDiv = document.getElementById('localMarkdownExportSettings') as HTMLElement | null;
  if (localExportEnabledInput && localExportSettingsDiv) {
    localExportEnabledInput.addEventListener('change', () => {
      localExportSettingsDiv.classList.toggle('hidden', !localExportEnabledInput.checked);
    });
  }

  // Review Summary enabled checkbox → manual actions visibility
  const reviewSummaryEnabledInput = document.getElementById('reviewSummaryEnabled') as HTMLInputElement | null;
  const reviewSummaryManualActionsDiv = document.getElementById('reviewSummaryManualActions') as HTMLElement | null;
  if (reviewSummaryEnabledInput && reviewSummaryManualActionsDiv) {
    reviewSummaryEnabledInput.addEventListener('change', () => {
      reviewSummaryManualActionsDiv.classList.toggle('hidden', !reviewSummaryEnabledInput.checked);
    });
  }

  // Review Summary manual generation buttons
  document.getElementById('generateWeeklySummaryBtn')?.addEventListener('click', handleGenerateWeeklySummary);
  document.getElementById('generateMonthlySummaryBtn')?.addEventListener('click', handleGenerateMonthlySummary);
  try { await loadMasterPasswordSettings(); } catch (e) { console.error('[Dashboard] loadMasterPasswordSettings error:', e); }
  try { await initConsentWithdrawal(); } catch (e) { console.error('[Dashboard] initConsentWithdrawal error:', e); }
  try { await loadTrustSettings(); } catch (e) { console.error('[Dashboard] loadTrustSettings error:', e); }

  // Data erasure button (GDPR Art.17)
  document.getElementById('btnDeleteAllData')?.addEventListener('click', async () => {
    const confirmed = await showConfirmDialog({
      title: chrome.i18n.getMessage('confirmClearAllTitle') || 'Delete All History',
      message: chrome.i18n.getMessage('confirmClearAllMessage') || chrome.i18n.getMessage('deleteAllDataConfirm') || 'This will permanently delete all stored data. Continue?',
      confirmLabel: chrome.i18n.getMessage('confirmDelete') || 'Delete',
      cancelLabel: chrome.i18n.getMessage('cancel') || 'Cancel',
      dangerous: true,
    });
    if (!confirmed) return;
    try {
      await chrome.storage.local.clear();
      const sqliteResult = await clearAllLogs();
      if (!sqliteResult) {
        const statusEl = document.getElementById('deleteAllDataStatus');
        if (statusEl) statusEl.textContent = chrome.i18n.getMessage('deleteAllDataFailed') || 'Failed to clear browsing logs. Please try again.';
        return;
      }
      const statusEl = document.getElementById('deleteAllDataStatus');
      if (statusEl) statusEl.textContent = chrome.i18n.getMessage('deleteAllDataSuccess');
      setTimeout(() => window.location.reload(), 2000);
    } catch (e) {
      console.error('[Dashboard] Failed to delete all data:', e);
      const statusEl = document.getElementById('deleteAllDataStatus');
      if (statusEl) statusEl.textContent = chrome.i18n.getMessage('deleteAllDataFailed') || 'Failed to delete all data. Please try again.';
    }
  });

  const aiProviderEl = getAiProviderElements();
  if (aiProviderEl.select) {
    setupAIProviderChangeListener(aiProviderEl);
  }

  // Connect priority 2/3 select change listeners for multi-provider visibility
  const refreshMultiVisibility = (): void => {
    const el = getDashboardElements();
    const selected = [
      el.aiProviderSelect?.value ?? '',
      el.aiProviderPriority2Select?.value ?? '',
      el.aiProviderPriority3Select?.value ?? ''
    ];
    updateAIProviderVisibilityMulti(getAiProviderElements(), selected);
    // Update provider settings layout to show settings under each priority card
    updateProviderSettingsLayout(selected);
  };

  const el = getDashboardElements();
  el.aiProviderSelect?.addEventListener('change', refreshMultiVisibility);
  el.aiProviderPriority2Select?.addEventListener('change', refreshMultiVisibility);
  el.aiProviderPriority3Select?.addEventListener('change', refreshMultiVisibility);
  hideAllProviderSettings();
  refreshMultiVisibility();

  // Initialize models.dev dialog
  let modelsDevDialog: ModelsDevDialog | null = null;

  const openModelsDevDialogBtn = document.getElementById('openModelsDevDialogBtn') as HTMLButtonElement;
  const selectedProviderInfoDiv = document.getElementById('selectedProviderInfo') as HTMLElement;
  const providerInfoDisplayDiv = document.getElementById('providerInfoDisplay') as HTMLElement;

  openModelsDevDialogBtn?.addEventListener('click', async () => {
    if (!modelsDevDialog) {
      modelsDevDialog = new ModelsDevDialog({
        onSave: async (providerId, baseUrl, apiKey, model) => {
          // Update UI
          selectedProviderInfoDiv?.classList.remove('hidden');
          const providerData = JSON.parse(JSON.stringify({ id: providerId, baseUrl, hasKey: !!apiKey, model }));
          providerInfoDisplayDiv!.textContent = `${providerId} (${baseUrl})${model ? ` - ${model}` : ''}`;

          // Update input values
          const el = getDashboardElements();
          if (el.providerApiKeyInput) el.providerApiKeyInput.value = apiKey;
          if (el.providerModelInput) el.providerModelInput.value = model;

          // Store in settings
          const settings = await getSettings();
          settings[StorageKeys.PROVIDER_TYPE] = providerId;
          settings[StorageKeys.PROVIDER_BASE_URL] = baseUrl;
          settings[StorageKeys.PROVIDER_API_KEY] = apiKey;
          settings[StorageKeys.PROVIDER_MODEL] = model;
          await saveSettingsWithAllowedUrls(settings);
        },
        onCancel: () => {
          console.log('[Dashboard] Provider dialog cancelled');
        }
      });
    }
    await modelsDevDialog.show();
  });
  // LM Studio preset button
  const lmStudioPresetBtn = document.getElementById('lmStudioPresetBtn') as HTMLButtonElement;
  lmStudioPresetBtn?.addEventListener('click', () => {
    const el = getDashboardElements();
    if (el.providerBaseUrlInput) el.providerBaseUrlInput.value = 'http://localhost:1234/v1';
    if (el.statusDiv) {
      el.statusDiv.textContent = getMessage('lmStudioPresetApplied') || 'LM Studio preset applied (http://localhost:1234/v1)';
      el.statusDiv.className = 'status-success';
      syncStatusToTop();
    }
  });
  // Ollama preset button
  const ollamaPresetBtn = document.getElementById('ollamaPresetBtn') as HTMLButtonElement;
  ollamaPresetBtn?.addEventListener('click', () => {
    const el = getDashboardElements();
    if (el.providerBaseUrlInput) el.providerBaseUrlInput.value = 'http://localhost:11434/v1';
    if (el.statusDiv) {
      el.statusDiv.textContent = getMessage('ollamaPresetApplied') || 'Ollama preset applied (http://localhost:11434/v1)';
      el.statusDiv.className = 'status-success';
      syncStatusToTop();
    }
  });
  {
    const el = getDashboardElements();
    setupAllFieldValidations(el.protocolInput, el.portInput);
  }

  // 保存ボタン（テストなし）
  {
    const el = getDashboardElements();
    el.saveBtn?.addEventListener('click', async () => {
      await handleSaveOnly();
    });

    // 接続テストボタン（保存なし）
    el.testObsidianBtn?.addEventListener('click', async () => {
      await handleTestObsidian();
    });

    el.testAiBtn?.addEventListener('click', async () => {
      await handleTestAi();
    });

    document.getElementById('testLocalMarkdownBtnBottom')?.addEventListener('click', handleTestLocalMarkdown);

    el.purgeNowBtn?.addEventListener('click', async () => {
      await handlePurgeNow();
    });
    el.contentPurgeNowBtn?.addEventListener('click', async () => {
      await handleContentPurgeNow();
    });

    const syncBackdrop = () => {
      const backdropNow = document.getElementById('wizardBackdrop');
      const wizardNow = document.getElementById('onboardingWizard');
      if (backdropNow) backdropNow.style.display = wizardNow?.classList.contains('hidden') ? 'none' : 'block';
    };
    // Observe wizard class changes to keep backdrop in sync
    const observeWizard = () => {
      const wizardEl = document.getElementById('onboardingWizard');
      const backdropEl = document.getElementById('wizardBackdrop');
      if (wizardEl && backdropEl) {
        const obs = new MutationObserver(syncBackdrop);
        obs.observe(wizardEl, { attributes: true, attributeFilter: ['class'] });
      }
    };

    const reopenWizard = () => {
      const wizard = document.getElementById('onboardingWizard');
      if (wizard) {
        delete wizard.dataset.initialized;
      }
      initOnboardingWizard(true);
      observeWizard();
      syncBackdrop();
    };
    document.getElementById('reopenWizardBtn')?.addEventListener('click', reopenWizard);
    document.getElementById('reopenWizardBtnTop')?.addEventListener('click', reopenWizard);

    // Bind top button row to the same handlers as the bottom row
    const bindTopButton = (id: string, handler: () => void) => {
      document.getElementById(id)?.addEventListener('click', () => handler());
    };
    bindTopButton('saveTop', handleSaveOnly);
    bindTopButton('testObsidianBtnTop', handleTestObsidian);
    bindTopButton('testAiBtnTop', handleTestAi);
    bindTopButton('testLocalMarkdownBtnTop', handleTestLocalMarkdown);

    // Manual local markdown export button
    document.getElementById('localExportManualBtn')?.addEventListener('click', handleManualLocalMarkdownExport);
  }

  try { await initHistoryPanel(); } catch (e) { console.error('[Dashboard] initHistoryPanel error:', e); }
  try { await initSqliteHistoryPanel(); } catch (e) { console.error('[Dashboard] initSqliteHistoryPanel error:', e); }
  try { await initRecordingConditionsSettings(); } catch (e) { console.error('[Dashboard] initRecordingConditionsSettings error:', e); }
  try { initExportLogsPanel(); } catch (e) { console.error('[Dashboard] initExportLogsPanel error:', e); }
  try { await initDomainSearchPanel(); } catch (e) { console.error('[Dashboard] initDomainSearchPanel error:', e); }
  try { await initTagsPanel(); } catch (e) { console.error('[Dashboard] initTagsPanel error:', e); }
  try { await initTagClusterPanel(); } catch (e) { console.error('[Dashboard] initTagClusterPanel error:', e); }
  try { await initDiagnosticsPanel(); } catch (e) { console.error('[Dashboard] initDiagnosticsPanel error:', e); }
  try { await initAuditLogPanel(); } catch (e) { console.error('[Dashboard] initAuditLogPanel error:', e); }
  try { await showBreakingChangesModal(); } catch (e) { console.error('[Dashboard] showBreakingChangesModal error:', e); }

  // History panel local markdown export button
  document.getElementById('historyExportLocalMarkdownBtn')?.addEventListener('click', handleHistoryExportLocalMarkdown);
  try { await initTrancoConsentPanel(); } catch (e) { console.error('[Dashboard] initTrancoConsentPanel error:', e); }

  console.log('[Dashboard] Initialization complete');
})();

// Export for testability
export function initDashboard(): void {
  // This function can be called in tests to initialize the dashboard
  // In production, the IIFE above calls this automatically
}

