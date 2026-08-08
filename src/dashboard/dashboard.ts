/**
 * dashboard.ts
 * ダッシュボードページのメイン初期化モジュール
 * popup.ts の設定ロジックを流用し、フルページダッシュボードとして動作する
 */

import { StorageKeys, getSettings, ProviderSlot } from '../utils/storage.js';
import { loadSettingsToInputs, extractSettingsFromInputs, extractLocalMarkdownExportTiming, loadLocalMarkdownExportTiming } from '../utils/settingsFormBinding.js';
import { getMessage } from '../utils/i18n.js';
import { type MultiProviderTestResult, type AiTestProgress, PROVIDER_LABELS } from '../background/aiClient.js';
import { AI_TEST_PROGRESS_MESSAGE_TYPE, type AiTestProgressMessage } from '../background/aiTestProgressNotifier.js';
import { getPluralKey } from '../utils/i18nPlural.js';
import { AIProviderElements, updateAIProviderVisibilityMulti } from '../popup/settings/aiProvider.js';
import { updateProviderSettingsLayout } from './aiProviderLayoutManager.js';
import { focusTrapManager } from '../popup/utils/focusTrap.js';
import { queryLogs, type BrowsingLogEntry } from './dashboardSqliteService.js';
import { getPlatformOs } from '../utils/deviceUtils.js';
import { initTrancoConsentPanel } from './trancoConsent.js';
import type { DashboardSqliteResponseFor } from '../background/handlers/dashboardSqliteProtocol.js';
import { CURRENT_PROTOCOL_VERSION } from '../background/messageTypes.js';
import { sanitizeForObsidian, sanitizeForMarkdownLinkText, sanitizeUrlForMarkdownTarget } from '../utils/markdownSanitizer.js';
import { renderFileTemplate, getActiveTemplate, getHostname } from '../utils/markdownTemplateUtils.js';
import type { MarkdownExportTemplate, MarkdownTemplateEntryData } from '../utils/types.js';
import { saveDashboardSettings } from './settingsPipeline.js';
import { generateReviewSummary } from './reviewSummaryHandler.js';

function openSettingsPanel(section: string): void {
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

const SETTINGS_FORM_SELECTOR = '#panel-general';

/**
 * Ask the Service Worker to re-read LOCAL_MARKDOWN_EXPORT_TIMING and
 * re-register its alarms immediately, instead of waiting for the next
 * (unpredictable) Service Worker restart to pick up a saved timing change.
 * Best-effort: a failure here just means the old schedule keeps running
 * until the next natural SW restart, so errors are swallowed.
 */
function refreshLocalMarkdownScheduler(): void {
  try {
    // Best-effort: a failure just means the old schedule keeps running
    // until the next natural Service Worker restart.
    Promise.resolve(chrome.runtime.sendMessage({ type: 'REFRESH_LOCAL_MARKDOWN_SCHEDULER', protocolVersion: CURRENT_PROTOCOL_VERSION })).catch(() => {});
  } catch {
    // sendMessage can throw synchronously (e.g. extension context invalidated).
  }
}

/**
 * Sync status display between top and bottom status divs.
 * Copies the content and class from the bottom status div to the top status div.
 */
export function syncStatusToTop(): void {
  const statusDiv = document.getElementById('status') as HTMLElement | null;
  const statusTopDiv = document.getElementById('statusTop') as HTMLElement | null;
  if (statusTopDiv && statusDiv) {
    statusTopDiv.innerHTML = statusDiv.innerHTML;
    statusTopDiv.className = statusDiv.className;
  }
}

export function getAiProviderElements(): AIProviderElements {
  return {
    select: document.getElementById('aiProvider') as HTMLSelectElement,
    geminiSettings: document.getElementById('geminiSettings') as HTMLElement,
    openaiSettings: document.getElementById('openaiSettings') as HTMLElement,
    openai2Settings: document.getElementById('openai2Settings') as HTMLElement,
    lmStudioSettings: (document.getElementById('lm-studioSettings') as HTMLElement) ?? undefined,
    ollamaSettings: (document.getElementById('ollamaSettings') as HTMLElement) ?? undefined,
    openaiCompatibleSettings: (document.getElementById('openai-compatibleSettings') as HTMLElement) ?? undefined,
    builtInAiSettings: (document.getElementById('built-in-aiSettings') as HTMLElement) ?? undefined
  };
}

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

// ============================================================================
// Connection Test Helpers
// ============================================================================

export function createConnectionStatusElement(label: string, result: { success: boolean; message: string }): HTMLElement {
  const statusDiv = document.createElement('div');
  statusDiv.className = 'diag-indent';

  const labelEl = document.createElement('strong');
  labelEl.textContent = `${label}: `;
  statusDiv.appendChild(labelEl);

  const spanEl = document.createElement('span');
  if (result.success) {
    spanEl.textContent = getMessage('connectionSuccess') || '接続成功';
    spanEl.className = 'diag-success';
  } else {
    spanEl.textContent = result.message;
    spanEl.className = 'diag-error';
  }
  statusDiv.appendChild(spanEl);

  return statusDiv;
}

export async function testObsidianConnection(apiKey: string): Promise<{ success: boolean; message: string }> {
  const protocolInput = document.getElementById('protocol') as HTMLInputElement | null;
  const portInput = document.getElementById('port') as HTMLInputElement | null;
  const testResult = await chrome.runtime.sendMessage({
    type: 'TEST_OBSIDIAN',
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    payload: apiKey
      ? {
          protocol: protocolInput?.value?.trim(),
          port: portInput?.value?.trim(),
          apiKey: apiKey,
        }
      : {}
  }) as { obsidian?: { success: boolean; message: string } };

  return testResult?.obsidian || { success: false, message: 'No response' };
}

export async function testAiConnection(runId?: string): Promise<MultiProviderTestResult> {
  const testResult = await chrome.runtime.sendMessage({
    type: 'TEST_AI',
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    payload: {},
    ...(runId !== undefined ? { runId } : {}),
  }) as { ai?: MultiProviderTestResult };

  return testResult?.ai || { success: false, message: 'No response', providers: [] };
}

export async function handleSaveOnly(): Promise<void> {
  const statusDiv = document.getElementById('status') as HTMLElement | null;
  if (!statusDiv) return;
  statusDiv.textContent = '';
  statusDiv.className = '';

  const result = await saveDashboardSettings({
    onSuccess: () => {
      statusDiv.textContent = getMessage('saveSuccess') || '設定を保存しました。';
      statusDiv.className = 'success';
      refreshLocalMarkdownScheduler();
      syncStatusToTop();
    },
  });

  if (!result.success) {
    statusDiv.textContent = getMessage('saveError') || '設定の保存に失敗しました。';
    statusDiv.className = 'error';
    syncStatusToTop();
  }
}

export async function handleTestObsidian(): Promise<void> {
  const testObsidianBtn = document.getElementById('testObsidianBtn') as HTMLButtonElement | null;
  const statusDiv = document.getElementById('status') as HTMLElement | null;
  if (!testObsidianBtn || !statusDiv) return;

  statusDiv.innerHTML = '';
  statusDiv.className = '';
  statusDiv.textContent = getMessage('testingConnection') || '接続テスト中...';

  testObsidianBtn.disabled = true;
  try {
    const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement | null;
    const protocolInput = document.getElementById('protocol') as HTMLInputElement | null;
    const typedApiKey = apiKeyInput?.value?.trim();
    const obsidianResult = await testObsidianConnection(typedApiKey || '');

    statusDiv.innerHTML = '';
    statusDiv.appendChild(createConnectionStatusElement('Obsidian', obsidianResult));

    // HTTPS証明書警告
    if (!obsidianResult.success && obsidianResult.message.includes('Failed to fetch') && protocolInput?.value === 'https') {
      const portInput = document.getElementById('port') as HTMLInputElement | null;
      const port = parseInt(portInput?.value?.trim() || '0', 10);
      const url = `https://127.0.0.1:${port}/`;
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.textContent = getMessage('acceptCertificate') || '証明書を承認する';
      link.rel = 'noopener noreferrer';
      statusDiv.appendChild(document.createElement('br'));
      statusDiv.appendChild(link);
    }

    statusDiv.className = obsidianResult.success ? 'success' : 'error';
    syncStatusToTop();
  } catch (_e) {
    statusDiv.textContent = getMessage('testError') || '接続テストに失敗しました。';
    statusDiv.className = 'error';
    syncStatusToTop();
  } finally {
    testObsidianBtn.disabled = false;
  }
}

function isAiTestProgressMessage(message: unknown): message is AiTestProgressMessage {
  if (
    typeof message !== 'object' ||
    message === null ||
    (message as { type?: unknown }).type !== AI_TEST_PROGRESS_MESSAGE_TYPE
  ) {
    return false;
  }
  const progress = (message as AiTestProgressMessage).progress;
  // Validate the payload shape defensively: the broadcast reaches every
  // extension context, so a malformed/forged message must not corrupt the UI.
  return (
    typeof progress === 'object' &&
    progress !== null &&
    typeof progress.provider === 'string' &&
    Number.isInteger(progress.index) &&
    progress.index >= 0 &&
    Number.isInteger(progress.total) &&
    progress.total >= 0 &&
    (progress.model === undefined || typeof progress.model === 'string')
  );
}

/** Look up a provider label without leaking Object.prototype keys. */
function providerLabelSafe(provider: string): string {
  return Object.prototype.hasOwnProperty.call(PROVIDER_LABELS, provider)
    ? PROVIDER_LABELS[provider]
    : provider;
}

interface AiTestProgressView {
  label: HTMLElement;
  elapsedEl: HTMLElement;
}

/**
 * Build the in-progress UI (spinner + provider label + elapsed time) once.
 * Subsequent updates mutate textContent only so the spinner animation is not
 * restarted and the live region is not re-announced on every tick.
 */
function buildAiTestProgressView(statusDiv: HTMLElement): AiTestProgressView {
  statusDiv.innerHTML = '';
  statusDiv.className = 'ai-test-progress';

  const spinner = document.createElement('span');
  spinner.className = 'ai-test-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  statusDiv.appendChild(spinner);

  const label = document.createElement('span');
  statusDiv.appendChild(label);

  const elapsedEl = document.createElement('div');
  elapsedEl.className = 'ai-test-elapsed';
  // Elapsed time ticks 5x/sec; keep it out of the live region to avoid
  // flooding screen readers. The provider label below is the only announced node.
  elapsedEl.setAttribute('aria-hidden', 'true');
  statusDiv.appendChild(elapsedEl);

  return { label, elapsedEl };
}

function renderAiTestProgressLabel(view: AiTestProgressView, progress: AiTestProgress | undefined): void {
  if (progress) {
    const providerLabel = providerLabelSafe(progress.provider);
    const providerDisplay = progress.model ? `${providerLabel} (${progress.model})` : providerLabel;
    view.label.textContent = getMessage('aiTestingProvider', {
      provider: providerDisplay,
      current: String(progress.index + 1),
      total: String(progress.total),
    }) || `テスト中... (${progress.index + 1}/${progress.total})`;
  } else {
    view.label.textContent = getMessage('testingConnection') || '接続テスト中...';
  }
}

function renderAiTestProgressElapsed(view: AiTestProgressView, startTime: number): void {
  const elapsedSeconds = ((performance.now() - startTime) / 1000).toFixed(1);
  const text = getMessage('aiTestElapsedTime', { seconds: elapsedSeconds }) || `経過時間: ${elapsedSeconds}秒`;
  view.elapsedEl.textContent = text;
  // statusTop is a one-shot innerHTML copy of status (see syncStatusToTop), so its
  // elapsed node needs its own textContent update on every tick to stay in sync.
  const topElapsedEl = document.querySelector('#statusTop .ai-test-elapsed');
  if (topElapsedEl) topElapsedEl.textContent = text;
}

let aiTestInFlight = false;

export async function handleTestAi(): Promise<void> {
  const testAiBtn = document.getElementById('testAiBtn') as HTMLButtonElement | null;
  const testAiBtnTop = document.getElementById('testAiBtnTop') as HTMLButtonElement | null;
  const statusDiv = document.getElementById('status') as HTMLElement | null;
  if (!testAiBtn || !statusDiv) return;
  // Guard against re-entrancy (the top button is not covered by testAiBtn's
  // disabled state, so a mid-test click would double-register the listener,
  // timer and TEST_AI request).
  if (aiTestInFlight) return;
  aiTestInFlight = true;

  const startTime = performance.now();
  // Correlation id for this test run so that when multiple Dashboard tabs run a
  // test concurrently, each tab only renders the progress it initiated.
  const runId = `ai-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  let latestProgress: AiTestProgress | undefined;
  let lastProviderKey = '';

  const view = buildAiTestProgressView(statusDiv);

  // announceProvider=true re-renders the live-region label (only on provider
  // switch); the elapsed timer updates textContent only and is aria-hidden.
  const updateView = (announceProvider: boolean): void => {
    if (announceProvider) {
      renderAiTestProgressLabel(view, latestProgress);
      syncStatusToTop();
    }
    renderAiTestProgressElapsed(view, startTime);
  };

  const progressListener = (message: unknown, sender: chrome.runtime.MessageSender): void => {
    // AI_TEST_PROGRESS arrives via chrome.runtime.sendMessage broadcast, so any
    // extension context (content scripts, popup, offscreen) can reach this
    // listener. Accept only messages originating from this extension AND from
    // this test run (guards against concurrent Dashboard tabs overwriting state).
    if (sender?.id !== chrome.runtime.id) return;
    if (isAiTestProgressMessage(message) && message.progress.runId === runId) {
      latestProgress = message.progress;
      const key = `${message.progress.provider}:${message.progress.index}`;
      const changed = key !== lastProviderKey;
      lastProviderKey = key;
      updateView(changed);
    }
  };

  let elapsedTimer: ReturnType<typeof setInterval> | undefined;
  try {
    chrome.runtime.onMessage.addListener(progressListener);
    renderAiTestProgressLabel(view, undefined);
    renderAiTestProgressElapsed(view, startTime);
    syncStatusToTop();
    elapsedTimer = setInterval(() => updateView(false), 200);

    testAiBtn.disabled = true;
    if (testAiBtnTop) testAiBtnTop.disabled = true;
    try {
      const saveResult = await saveDashboardSettings({
        formSelector: SETTINGS_FORM_SELECTOR,
        includeTiming: true,
      });
      if (!saveResult.success) {
        statusDiv.textContent = getMessage('saveError') || '設定の保存に失敗しました。';
        statusDiv.className = 'error';
        syncStatusToTop();
        return;
      }

      refreshLocalMarkdownScheduler();

      const aiResult = await testAiConnection(runId);

      statusDiv.innerHTML = '';

      if (aiResult.providers && aiResult.providers.length > 1) {
        // Multi-provider: show per-provider results
        const container = document.createElement('div');
        container.className = 'diag-indent';

        const header = document.createElement('strong');
        header.textContent = 'AI: ';
        container.appendChild(header);

        const statusEl = document.createElement('span');
        statusEl.textContent = aiResult.success
          ? (getMessage('connectionSuccess') || '接続成功')
          : (getMessage('connectionFailed') || '接続失敗');
        statusEl.className = aiResult.success ? 'diag-success' : 'diag-error';
        container.appendChild(statusEl);
        statusDiv.appendChild(container);

        const providerLabels: Record<string, string> = PROVIDER_LABELS;

        for (const provider of aiResult.providers) {
          const row = document.createElement('div');
          row.className = 'diag-indent';
          const label = providerLabels[provider.provider] || provider.provider;
          const modelInfo = provider.model ? ` (${provider.model})` : '';
          const durationSeconds = (provider.elapsedMs / 1000).toFixed(1);
          const durationInfo = ` (${getMessage('aiProviderTestDuration', { seconds: durationSeconds }) || `${durationSeconds}s`})`;
          row.textContent = `${provider.success ? '✓' : '✗'} ${label}${modelInfo}: ${provider.message}${durationInfo}`;
          row.classList.add(provider.success ? 'diag-success' : 'diag-error');
          statusDiv.appendChild(row);

          // Show debug details if available
          if (provider.debug) {
            const debugRow = document.createElement('div');
            debugRow.className = 'diag-indent ai-debug-details';

            const details: string[] = [];
            if (provider.debug.prompt) details.push(`Prompt: ${provider.debug.prompt}`);
            if (provider.debug.response) details.push(`Response: ${provider.debug.response}`);
            if (provider.debug.error) details.push(`Error: ${provider.debug.error}`);
            if (provider.debug.availability) details.push(`Availability: ${provider.debug.availability}`);
            if (provider.debug.hasContent !== undefined) details.push(`Has content: ${provider.debug.hasContent}`);
            if (provider.debug.statusCode !== undefined) details.push(`Status: ${provider.debug.statusCode}`);

            debugRow.textContent = details.join(' | ');
            statusDiv.appendChild(debugRow);
          }
        }
      } else {
        // Single provider: show simple result
        statusDiv.appendChild(createConnectionStatusElement('AI', aiResult));
      }

      statusDiv.className = aiResult.success ? 'success' : 'error';
      syncStatusToTop();
    } catch (_e) {
      statusDiv.textContent = getMessage('testError') || '接続テストに失敗しました。';
      statusDiv.className = 'error';
      syncStatusToTop();
    }
  } finally {
    if (elapsedTimer) clearInterval(elapsedTimer);
    chrome.runtime.onMessage.removeListener(progressListener);
    testAiBtn.disabled = false;
    if (testAiBtnTop) testAiBtnTop.disabled = false;
    aiTestInFlight = false;
  }
}

export async function handleTestLocalMarkdown(): Promise<void> {
  const testLocalMarkdownBtn = document.getElementById('testLocalMarkdownBtnTop') as HTMLButtonElement | null;
  const statusTopDiv = document.getElementById('statusTop') as HTMLElement | null;
  if (!testLocalMarkdownBtn || !statusTopDiv) return;

  statusTopDiv.innerHTML = '';
  statusTopDiv.className = '';
  statusTopDiv.textContent = getMessage('testingConnection') || '接続テスト中...';

  testLocalMarkdownBtn.disabled = true;
  try {
    // Save current settings first
    const saveResult = await saveDashboardSettings({
      formSelector: SETTINGS_FORM_SELECTOR,
      includeTiming: true,
    });
    if (!saveResult.success) {
      statusTopDiv.textContent = getMessage('saveError') || '設定の保存に失敗しました。';
      statusTopDiv.className = 'error';
      return;
    }

    refreshLocalMarkdownScheduler();

    // Check if enabled
    const settings = await getSettings();
    const localExportEnabled = settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED];
    if (!localExportEnabled) {
      statusTopDiv.textContent = getMessage('testLocalMarkdownDisabled') || 'ローカルMarkdown書き出しが無効です。まず有効にしてください。';
      statusTopDiv.className = 'error';
      return;
    }

    // Create test content
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    const testContent = `# ${date}\n\n- ${time} [Yasumaro Test](https://example.com)\n    - This is a test entry for local Markdown export. If you can see this file, the export is working correctly!`;

    // Download test file
    const exportPath = (settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH] as string) || 'Yasumaro';
    const blob = new Blob([testContent], { type: 'text/markdown' });
    const blobUrl = URL.createObjectURL(blob);

    await chrome.downloads.download({
      url: blobUrl,
      filename: `${exportPath}/test-${date}.md`,
      saveAs: false,
      conflictAction: 'overwrite'
    });

    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

    statusTopDiv.textContent = getMessage('testLocalMarkdownSuccess') || 'ローカルMarkdown書き出しテスト: ファイルのダウンロードに成功しました';
    statusTopDiv.className = 'success';
  } catch (_e) {
    statusTopDiv.textContent = getMessage('testLocalMarkdownError') || 'ローカルMarkdown書き出しテストに失敗しました';
    statusTopDiv.className = 'error';
  } finally {
    testLocalMarkdownBtn.disabled = false;
  }
}

/**
 * Convert a single browsing log entry into template entry data
 * VULN-020 fix: sanitize title and URL to prevent Markdown injection
 */
export function toMarkdownTemplateEntryData(entry: { title?: string | null; url: string; summary?: string | null; tags?: string | null; created_at: number }): MarkdownTemplateEntryData {
  const timestamp = new Date(entry.created_at).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit'
  });
  // VULN-017: title is placed inside `[title](url)`; escape link-breakout chars
  // so a `](url)` suffix cannot close the wrapper.
  const title = sanitizeForMarkdownLinkText(entry.title || entry.url || 'Untitled');
  const url = sanitizeUrlForMarkdownTarget(entry.url);
  const summary = sanitizeForObsidian((entry.summary || 'Summary not available.').replace(/\n+/g, ' ').replace(/  +/g, ' ').trim());
  const tagsList = entry.tags
    ? entry.tags.split(',').map(t => t.trim()).filter(Boolean).map(t => `#${sanitizeForObsidian(t)}`)
    : [];
  const tags = tagsList.length > 0 ? tagsList.join(' ') + ' ' : '';
  const domain = getHostname(url);
  return { timestamp, title, url, summary, tags, domain };
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
 * Options for exportLocalMarkdownCore, parameterizing the three near-identical
 * local Markdown export handlers (M15).
 */
interface LocalMarkdownExportOptions {
  /** Element IDs for the date-range inputs, or null for a full-history export (no range). */
  dateRange: { startDateId: string; endDateId: string } | null;
  exportBtnId: string;
  statusElId: string;
  /** Status message shown when the query returns zero rows. */
  emptyMessage: string;
}

/**
 * Shared implementation behind handleManualLocalMarkdownExport(),
 * handleExportLocalMarkdown(), and handleHistoryExportLocalMarkdown().
 * Queries SQLite for the given (or full) date range, groups results by
 * local date, and downloads one Markdown file per date.
 */
/** Batch size for paginated full-history export (desktop). */
const EXPORT_BATCH_SIZE_DESKTOP = 1000;
/** Smaller batch size on mobile to reduce peak memory usage. */
const EXPORT_BATCH_SIZE_MOBILE = 500;

function getExportBatchSize(): number {
  const os = getPlatformOs();
  return os === 'android' || os === 'ios' ? EXPORT_BATCH_SIZE_MOBILE : EXPORT_BATCH_SIZE_DESKTOP;
}

/**
 * Downloads one Markdown file for the given date's entries.
 */
async function downloadDateMarkdown(
  exportPath: string,
  date: string,
  entries: BrowsingLogEntry[],
  template: MarkdownExportTemplate
): Promise<void> {
  const entryData = entries.map(toMarkdownTemplateEntryData);
  const content = renderFileTemplate(template, entryData, date);

  const blob = new Blob([content], { type: 'text/markdown' });
  const blobUrl = URL.createObjectURL(blob);

  await chrome.downloads.download({
    url: blobUrl,
    filename: `${exportPath}/${date}.md`,
    saveAs: false,
    conflictAction: 'overwrite'
  });

  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

/**
 * Streams the full history in batches (ordered by created_at ASC), grouping
 * consecutive rows by local date and downloading one file per date as soon
 * as the date changes. This keeps at most one batch + one date's worth of
 * rows in memory at a time, instead of materializing the entire history.
 * Returns the total row count and file count exported.
 */
async function exportFullHistoryInBatches(
  exportPath: string,
  template: MarkdownExportTemplate
): Promise<{ totalRows: number; totalFiles: number }> {
  const batchSize = getExportBatchSize();
  let offset = 0;
  let totalRows = 0;
  let totalFiles = 0;
  let pendingDate: string | null = null;
  let pendingEntries: BrowsingLogEntry[] = [];

  for (;;) {
    const result = await queryLogs({ limit: batchSize, offset, orderBy: 'created_at', orderDir: 'ASC' });
    if (!result || !('rows' in result) || result.rows.length === 0) break;

    for (const row of result.rows) {
      const date = getLocalDateString(row.created_at);
      if (pendingDate !== null && date !== pendingDate) {
        await downloadDateMarkdown(exportPath, pendingDate, pendingEntries, template);
        totalFiles++;
        pendingEntries = [];
      }
      pendingDate = date;
      pendingEntries.push(row);
    }

    totalRows += result.rows.length;
    if (result.rows.length < batchSize) break;
    offset += batchSize;
  }

  if (pendingDate !== null && pendingEntries.length > 0) {
    await downloadDateMarkdown(exportPath, pendingDate, pendingEntries, template);
    totalFiles++;
  }

  return { totalRows, totalFiles };
}

async function exportLocalMarkdownCore(options: LocalMarkdownExportOptions): Promise<void> {
  const exportBtn = document.getElementById(options.exportBtnId) as HTMLButtonElement | null;
  const statusEl = document.getElementById(options.statusElId) as HTMLElement | null;

  if (!exportBtn || !statusEl) return;

  exportBtn.disabled = true;
  statusEl.textContent = '';
  statusEl.className = '';

  try {
    const settings = await getSettings();
    const exportPath = (settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH] as string) || 'Yasumaro';
    const templates = (settings[StorageKeys.MARKDOWN_EXPORT_TEMPLATES] as MarkdownExportTemplate[]) || [];
    const activeTemplateId = settings[StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID] as string | undefined;
    const activeTemplate = getActiveTemplate(templates, activeTemplateId);

    statusEl.textContent = getMessage('searching') || 'Searching...';

    if (!options.dateRange) {
      // Full-history export: stream in batches to bound peak memory usage.
      const { totalRows, totalFiles } = await exportFullHistoryInBatches(exportPath, activeTemplate);
      if (totalRows === 0) {
        statusEl.textContent = options.emptyMessage;
        statusEl.className = 'error';
        return;
      }
      statusEl.textContent = `${totalRows}件の記録を${totalFiles}ファイルにエクスポートしました。`;
      statusEl.className = 'success';
      return;
    }

    const startDateInput = document.getElementById(options.dateRange.startDateId) as HTMLInputElement | null;
    const endDateInput = document.getElementById(options.dateRange.endDateId) as HTMLInputElement | null;

    // Parse date range (YYYY-MM-DD format from date input)
    const startDate = startDateInput?.value || new Date().toISOString().split('T')[0];
    const endDate = endDateInput?.value || startDate;

    // Create timestamps at start of start date and end of end date in local timezone
    const since = new Date(startDate + 'T00:00:00').getTime();
    const until = new Date(endDate + 'T23:59:59').getTime();

    const result = await queryLogs({ since, until, limit: 10000, orderBy: 'created_at', orderDir: 'ASC' });

    if (!result || !('rows' in result) || result.rows.length === 0) {
      statusEl.textContent = options.emptyMessage;
      statusEl.className = 'error';
      return;
    }

    const { rows } = result;

    // Group entries by local date
    const entriesByDate = new Map<string, typeof rows>();
    for (const row of rows) {
      const date = getLocalDateString(row.created_at);
      if (!entriesByDate.has(date)) {
        entriesByDate.set(date, []);
      }
      entriesByDate.get(date)!.push(row);
    }

    // Generate markdown for each date
    let totalFiles = 0;
    for (const [date, entries] of entriesByDate) {
      await downloadDateMarkdown(exportPath, date, entries, activeTemplate);
      totalFiles++;
    }

    statusEl.textContent = `${rows.length}件の記録を${totalFiles}ファイルにエクスポートしました。`;
    statusEl.className = 'success';
  } catch (e) {
    statusEl.textContent = `エクスポートに失敗しました: ${e instanceof Error ? e.message : String(e)}`;
    statusEl.className = 'error';
  } finally {
    exportBtn.disabled = false;
  }
}

/**
 * Handle manual local markdown export with date range
 */
export async function handleManualLocalMarkdownExport(): Promise<void> {
  return exportLocalMarkdownCore({
    dateRange: { startDateId: 'localExportStartDate', endDateId: 'localExportEndDate' },
    exportBtnId: 'localExportManualBtn',
    statusElId: 'localExportManualStatus',
    emptyMessage: '指定期間に記録がありません。',
  });
}

/**
 * Handle local markdown export from Export Logs panel (date range)
 */
export async function handleExportLocalMarkdown(): Promise<void> {
  return exportLocalMarkdownCore({
    dateRange: { startDateId: 'exportLocalStartDate', endDateId: 'exportLocalEndDate' },
    exportBtnId: 'exportLocalMarkdownBtn',
    statusElId: 'exportLocalMarkdownStatus',
    emptyMessage: '指定期間に記録がありません。',
  });
}

/**
 * Handle review summary manual generation
 */
export async function handleGenerateWeeklySummary(): Promise<void> {
  const btn = document.getElementById('generateWeeklySummaryBtn') as HTMLButtonElement | null;
  const statusEl = document.getElementById('reviewSummaryStatus') as HTMLElement | null;
  await generateReviewSummary({ button: btn, statusElement: statusEl, periodType: 'weekly' });
}

export async function handleGenerateMonthlySummary(): Promise<void> {
  const btn = document.getElementById('generateMonthlySummaryBtn') as HTMLButtonElement | null;
  const statusEl = document.getElementById('reviewSummaryStatus') as HTMLElement | null;
  await generateReviewSummary({ button: btn, statusElement: statusEl, periodType: 'monthly' });
}

/**
 * Handle local markdown export from History panel (all records)
 */
export async function handleHistoryExportLocalMarkdown(): Promise<void> {
  return exportLocalMarkdownCore({
    dateRange: null,
    exportBtnId: 'historyExportLocalMarkdownBtn',
    statusElId: 'historyExportLocalMarkdownStatus',
    emptyMessage: 'エクスポートする記録がありません。',
  });
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



// ============================================================================
// Dashboard Initialization
// ============================================================================

(async function initDashboard(): Promise<void> {
  console.log('[Dashboard] Starting initialization...');

  try { setHtmlLangDir(); } catch (e) { console.error('[Dashboard] setHtmlLangDir error:', e); }

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('tab') === 'history') {
    const historyBtn = document.querySelector('[data-panel="panel-sqlite-history"]') as HTMLButtonElement;
    if (historyBtn) historyBtn.click();
  }

  const section = urlParams.get('section');
  if (section) {
    openSettingsPanel(section);
  }

  document.getElementById('historyExportLocalMarkdownBtn')?.addEventListener('click', handleHistoryExportLocalMarkdown);
  document.getElementById('exportLocalMarkdownBtn')?.addEventListener('click', handleExportLocalMarkdown);
  try { await initTrancoConsentPanel(); } catch (e) { console.error('[Dashboard] initTrancoConsentPanel error:', e); }

  console.log('[Dashboard] Initialization complete');
})();

export function initDashboard(): void {
  // Can be called in tests to initialize dashboard
}

