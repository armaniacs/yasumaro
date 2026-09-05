/**
 * connectionTests.ts
 * 一般設定パネルの保存・接続テスト系ハンドラ
 *
 * Split out of dashboard.ts (PBI 2026-08-09-24): these are driven only by the
 * general settings panel, but leaving them in the 842-line god module forced
 * the panel layer to import from the module it was meant to replace. Kept in
 * their own file rather than inlined into generalSettingsPanel.ts, which
 * would otherwise pass 500 lines.
 */

// eslint-disable-next-line local/require-sanitized-markdown -- test data with hardcoded markdown, not user input
import { StorageKeys } from '../../utils/storage/types.js';
import { settingsRepository, type SettingsReader } from '../../utils/storage/SettingsRepository.js';
import { getMessage } from '../../utils/i18n.js';
import { type AiTestProgress, type MultiProviderTestResult } from '../../background/ai/AIService.js';
import { CURRENT_PROTOCOL_VERSION } from '../../background/messageTypes.js';
import { saveDashboardSettings } from '../settingsPipeline.js';
import { syncStatusToTop } from '../statusView.js';
import { formatProviderHeadline, formatProviderDetailLines } from '../aiTestResultView.js';
import { subscribeAiTestProgress, generateAiTestRunId } from '../aiTestProgressClient.js';
import {
  buildAiTestProgressView,
  renderAiTestProgressLabel,
  renderAiTestProgressElapsed,
} from '../aiTestProgressView.js';

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
    if (result.error === 'aiProviderPriority1Required') {
      statusDiv.textContent = getMessage('aiProviderPriority1Required') || 'Priority 1 is required';
      statusDiv.className = 'error';
      syncStatusToTop();
      return;
    }
    if (result.error === 'aiProviderPriorityDuplicateWarning') {
      statusDiv.textContent = getMessage('aiProviderPriorityDuplicateWarning') || 'Duplicate provider and model';
      statusDiv.className = 'error';
      syncStatusToTop();
      return;
    }
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
  let elapsedTimer: ReturnType<typeof setInterval> | undefined;
  let unsubscribeProgress: (() => void) | undefined;
  try {
    aiTestInFlight = true;

    const startTime = performance.now();
    // Correlation id for this test run so that when multiple Dashboard tabs run a
    // test concurrently, each tab only renders the progress it initiated.
    const runId = generateAiTestRunId();
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
      renderAiTestProgressElapsed(view, startTime, document.getElementById('statusTop'));
    };

    unsubscribeProgress = subscribeAiTestProgress(runId, (progress) => {
      latestProgress = progress;
      const key = `${progress.provider}:${progress.index}`;
      const changed = key !== lastProviderKey;
      lastProviderKey = key;
      updateView(changed);
    });

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
        if (saveResult.error === 'aiProviderPriority1Required') {
          statusDiv.textContent = getMessage('aiProviderPriority1Required') || 'Priority 1 is required';
        } else if (saveResult.error === 'aiProviderPriorityDuplicateWarning') {
          statusDiv.textContent = getMessage('aiProviderPriorityDuplicateWarning') || 'Duplicate provider and model';
        } else {
          statusDiv.textContent = getMessage('saveError') || '設定の保存に失敗しました。';
        }
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
        header.textContent = getMessage('aiResultHeader') || 'AI: ';
        container.appendChild(header);

        const statusEl = document.createElement('span');
        statusEl.textContent = aiResult.success
          ? (getMessage('connectionSuccess') || '接続成功')
          : (getMessage('connectionFailed') || '接続失敗');
        statusEl.className = aiResult.success ? 'diag-success' : 'diag-error';
        container.appendChild(statusEl);
        statusDiv.appendChild(container);

        for (const provider of aiResult.providers) {
          const row = document.createElement('div');
          row.className = 'diag-indent';
          row.textContent = formatProviderHeadline(provider);
          row.classList.add(provider.success ? 'diag-success' : 'diag-error');
          statusDiv.appendChild(row);

          // 何を送って何が返ったかを1行ずつ表示する
          for (const line of formatProviderDetailLines(provider)) {
            const detailRow = document.createElement('div');
            detailRow.className = 'diag-indent ai-debug-details';
            detailRow.textContent = line;
            statusDiv.appendChild(detailRow);
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
    if (unsubscribeProgress) unsubscribeProgress();
    testAiBtn.disabled = false;
    if (testAiBtnTop) testAiBtnTop.disabled = false;
    aiTestInFlight = false;
  }
}

export async function handleTestLocalMarkdown(repo: SettingsReader = settingsRepository): Promise<void> {
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
      if (saveResult.error === 'aiProviderPriority1Required') {
        statusTopDiv.textContent = getMessage('aiProviderPriority1Required') || 'Priority 1 is required';
      } else if (saveResult.error === 'aiProviderPriorityDuplicateWarning') {
        statusTopDiv.textContent = getMessage('aiProviderPriorityDuplicateWarning') || 'Duplicate provider and model';
      } else {
        statusTopDiv.textContent = getMessage('saveError') || '設定の保存に失敗しました。';
      }
      statusTopDiv.className = 'error';
      return;
    }

    refreshLocalMarkdownScheduler();

    // Check if enabled
    const settings = await repo.getMany([StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED, StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]);
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
    // Test content with hardcoded markdown patterns (not user input)
    const testContent = `# ${date}\n\n- ${time} [Yasumaro Test](https://example.com)\n    - This is a test entry for local Markdown export. If you can see this file, the export is working correctly!`;

    // Download test file
    const exportPath = settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH] ?? 'Yasumaro';
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
