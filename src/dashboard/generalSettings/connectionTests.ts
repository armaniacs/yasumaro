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
import {
  OBSIDIAN_DEFAULT_HOST,
  OBSIDIAN_DEFAULT_PORT,
  validateObsidianHost,
  validateObsidianPort,
} from '../../utils/obsidianConfigValidator.js';
import type { FailureMetadata } from '../../utils/failureTaxonomy.js';
import { getMessageOr, getMessageWithSubstitutions } from '../../utils/i18n.js';
import { type AiTestProgress, type MultiProviderTestResult } from '../../background/ai/AIService.js';
import { messageTransport } from '../../messaging/messageTransport.js';
import { saveDashboardSettings, saveErrorText } from '../settingsPipeline.js';
import { syncStatusToTop } from '../statusView.js';
import { showStatus } from '../../utils/ui/settingsUiHelper.js';
import { formatProviderHeadline, formatProviderDetailLines } from '../aiTestResultView.js';
import { subscribeAiTestProgress, generateAiTestRunId } from '../aiTestProgressClient.js';
import { resolveSafeExportDir } from '../../utils/pathSanitizer.js';
import { getLocalDateString } from '../markdownExport.js';
import {
  buildAiTestProgressView,
  renderAiTestProgressLabel,
  renderAiTestProgressElapsed,
} from '../aiTestProgressView.js';

const SETTINGS_FORM_SELECTOR = '#panel-general';

const FIREFOX_CERT_GUIDE_FALLBACK =
  'Firefox keeps its own certificate store, separate from the OS one, so a certificate installed on the operating system can still be untrusted in Firefox. Do one of the following: (1) open the link above in a new tab and add a certificate exception, or (2) import the CA certificate under Settings → Privacy & Security → Certificates. Link target: {url}';

/**
 * Renders a saveDashboardSettings failure into a general-settings status area.
 * The wording comes from settingsPipeline (one definition for all four call
 * sites) and the message is not self-clearing: the next save or test replaces
 * it. The status area is the whole record of a failed save, so autoClear is off
 * here on purpose.
 */
function showSaveError(
  statusEl: HTMLElement,
  error: string | undefined,
  options: { syncTop?: boolean } = {},
): void {
  showStatus(statusEl, saveErrorText(error), 'error', { autoClear: false });
  if (options.syncTop) syncStatusToTop();
}

/** What the Dashboard needs from a TEST_OBSIDIAN answer: wording plus the
 * structured kind. `failure` is absent on success. */
export interface ObsidianTestOutcome {
  success: boolean;
  message: string;
  failure?: FailureMetadata;
}

/** Identity of the WebExtension host, as `chrome.runtime.getBrowserInfo` reports it. */
export interface BrowserIdentity {
  name?: string;
}

/** Host/port fallback, used when the form field is empty. */
export interface SavedObsidianEndpoint {
  host?: string | undefined;
  port?: string | undefined;
}

/**
 * Seams for `handleTestObsidian`. The handler is registered directly as a
 * click listener, so its single parameter is a MouseEvent in production; only
 * these two members are ever read off it (see `resolveConnectionTestDeps`).
 */
export interface ObsidianConnectionTestDeps {
  getBrowserInfo?: () => Promise<BrowserIdentity | undefined> | BrowserIdentity | undefined;
  readSavedEndpoint?: () => Promise<SavedObsidianEndpoint>;
}

/**
 * `chrome.runtime.getBrowserInfo` exists on Firefox only and rejects on some
 * Firefox builds, so the guard and the catch are both load-bearing: Chrome
 * must fall through to the generic guidance instead of throwing.
 */
async function readHostBrowser(): Promise<BrowserIdentity | undefined> {
  const runtime = chrome.runtime as typeof chrome.runtime & {
    getBrowserInfo?: () => Promise<BrowserIdentity>;
  };
  if (typeof runtime.getBrowserInfo !== 'function') return undefined;
  try {
    return await runtime.getBrowserInfo();
  } catch {
    return undefined;
  }
}

async function readSavedObsidianEndpoint(): Promise<SavedObsidianEndpoint> {
  const saved = await settingsRepository.getMany([StorageKeys.OBSIDIAN_HOST, StorageKeys.OBSIDIAN_PORT]);
  return {
    host: saved[StorageKeys.OBSIDIAN_HOST],
    port: saved[StorageKeys.OBSIDIAN_PORT],
  };
}

function resolveConnectionTestDeps(options?: Event | ObsidianConnectionTestDeps): Required<ObsidianConnectionTestDeps> {
  const candidate = (options ?? {}) as Partial<ObsidianConnectionTestDeps>;
  return {
    getBrowserInfo: typeof candidate.getBrowserInfo === 'function' ? candidate.getBrowserInfo : readHostBrowser,
    readSavedEndpoint: typeof candidate.readSavedEndpoint === 'function' ? candidate.readSavedEndpoint : readSavedObsidianEndpoint,
  };
}

/**
 * Firefox keeps its own certificate store, so a CA installed at the OS level
 * may still be untrusted there and the walkthrough differs from Chrome's.
 * Resolved before rendering because `getBrowserInfo` is asynchronous.
 */
async function isFirefoxHost(
  getBrowserInfo: Required<ObsidianConnectionTestDeps>['getBrowserInfo'],
): Promise<boolean> {
  try {
    const info = await getBrowserInfo();
    return info?.name === 'Firefox';
  } catch {
    return false;
  }
}

/**
 * Certificate-approval URL for the endpoint the test actually used.
 * The scheme is fixed and both components are re-validated, so a host typed
 * into the form can never inject another scheme, a path, or a second
 * authority; an invalid value degrades to the default endpoint instead.
 */
function buildCertificateUrl(host: string | undefined, port: string | undefined): string {
  const safeHost = tryOrDefault(() => validateObsidianHost(host), OBSIDIAN_DEFAULT_HOST);
  const safePort = tryOrDefault(() => validateObsidianPort(port), OBSIDIAN_DEFAULT_PORT);
  return `https://${safeHost}:${safePort}/`;
}

function tryOrDefault<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

async function readSavedEndpointSafely(
  read: Required<ObsidianConnectionTestDeps>['readSavedEndpoint'],
): Promise<SavedObsidianEndpoint | undefined> {
  try {
    return await read();
  } catch {
    // Best-effort: the guidance is still worth rendering with the defaults.
    return undefined;
  }
}

/**
 * A certificate walkthrough only helps when the transport itself failed over
 * HTTPS, and the decision is read from `failure.kind` — never from `message`,
 * which the Service Worker rewrites and which differs per browser.
 */
function isCertificateFailure(outcome: ObsidianTestOutcome, protocol: string | undefined): boolean {
  return !outcome.success && outcome.failure?.kind === 'network' && protocol === 'https';
}

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
    Promise.resolve(messageTransport.send({ type: 'REFRESH_LOCAL_MARKDOWN_SCHEDULER' })).catch(() => {});
  } catch {
    // sendMessage can throw synchronously (e.g. extension context invalidated).
  }
}

export function createConnectionStatusElement(label: string, result: { success: boolean; message: string }): HTMLElement {
  const statusDiv = document.createElement('div');
  statusDiv.className = 'diag-indent';

  const labelEl = document.createElement('strong');
  labelEl.textContent = getMessageWithSubstitutions('connectionStatusLabel', { label }, `${label}: `);
  statusDiv.appendChild(labelEl);

  const spanEl = document.createElement('span');
  if (result.success) {
    spanEl.textContent = getMessageOr('connectionSuccess', '接続成功');
    spanEl.className = 'diag-success';
  } else {
    spanEl.textContent = result.message;
    spanEl.className = 'diag-error';
  }
  statusDiv.appendChild(spanEl);

  return statusDiv;
}

export async function testObsidianConnection(apiKey: string): Promise<ObsidianTestOutcome> {
  const protocolInput = document.getElementById('protocol') as HTMLInputElement | null;
  const portInput = document.getElementById('port') as HTMLInputElement | null;
  const hostInput = document.getElementById('obsidianHost') as HTMLInputElement | null;
  // Forward the form values so the SW-side loopback rule evaluates the config
  // being edited, not the last saved one (PBI 2026-09-19-22). Empty fields are
  // omitted; an empty payload keeps the stored-settings path.
  const protocol = protocolInput?.value?.trim();
  const port = portInput?.value?.trim();
  const host = hostInput?.value?.trim();
  const hasFormValue = Boolean(apiKey || protocol || port || host);
  const testResult = await messageTransport.send({
    type: 'TEST_OBSIDIAN',
    payload: hasFormValue
      ? {
          ...(apiKey ? { apiKey } : {}),
          ...(protocol ? { protocol } : {}),
          ...(port ? { port } : {}),
          ...(host ? { host } : {}),
        }
      : {}
  }) as { obsidian?: ObsidianTestOutcome };

  return testResult?.obsidian || { success: false, message: getMessageOr('connectionNoResponse', 'No response')};
}

export async function testAiConnection(runId?: string): Promise<MultiProviderTestResult> {
  const testResult = await messageTransport.send({
    type: 'TEST_AI',
    payload: {},
    ...(runId !== undefined ? { runId } : {}),
  }) as { ai?: MultiProviderTestResult };

  return testResult?.ai || { success: false, message: getMessageOr('connectionNoResponse', 'No response'), providers: [] };
}

export async function handleSaveOnly(): Promise<void> {
  const statusDiv = document.getElementById('status') as HTMLElement | null;
  if (!statusDiv) return;
  statusDiv.textContent = '';
  statusDiv.className = '';

  const result = await saveDashboardSettings({
    onSuccess: () => {
      statusDiv.textContent = getMessageOr('saveSuccess', '設定を保存しました。');
      statusDiv.className = 'success';
      refreshLocalMarkdownScheduler();
      syncStatusToTop();
    },
  });

  if (!result.success) {
    showSaveError(statusDiv, result.error, { syncTop: true });
    return;
  }
}

export async function handleTestObsidian(options?: Event | ObsidianConnectionTestDeps): Promise<void> {
  const testObsidianBtn = document.getElementById('testObsidianBtn') as HTMLButtonElement | null;
  const statusDiv = document.getElementById('status') as HTMLElement | null;
  if (!testObsidianBtn || !statusDiv) return;

  const deps = resolveConnectionTestDeps(options);

  statusDiv.innerHTML = '';
  statusDiv.className = '';
  statusDiv.textContent = getMessageOr('testingConnection', '接続テスト中...');

  testObsidianBtn.disabled = true;
  try {
    const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement | null;
    const protocolInput = document.getElementById('protocol') as HTMLInputElement | null;
    const hostInput = document.getElementById('obsidianHost') as HTMLInputElement | null;
    const portInput = document.getElementById('port') as HTMLInputElement | null;
    const typedApiKey = apiKeyInput?.value?.trim();
    const obsidianResult = await testObsidianConnection(typedApiKey || '');

    // Resolved before rendering: the guidance text differs per browser.
    const isFirefox = await isFirefoxHost(deps.getBrowserInfo);

    statusDiv.innerHTML = '';
    statusDiv.appendChild(createConnectionStatusElement('Obsidian', obsidianResult));

    if (isCertificateFailure(obsidianResult, protocolInput?.value)) {
      const form = {
        host: hostInput?.value?.trim() ?? '',
        port: portInput?.value?.trim() ?? '',
      };
      const saved = form.host !== '' && form.port !== ''
        ? undefined
        : await readSavedEndpointSafely(deps.readSavedEndpoint);
      const url = buildCertificateUrl(form.host || saved?.host, form.port || saved?.port);

      statusDiv.appendChild(document.createElement('br'));
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.textContent = getMessageOr('acceptCertificate', '証明書を承認する');
      link.rel = 'noopener noreferrer';
      statusDiv.appendChild(link);

      if (isFirefox) {
        const note = document.createElement('div');
        note.className = 'diag-indent';
        note.textContent = getMessageWithSubstitutions(
          'certGuideFirefox',
          { url },
          FIREFOX_CERT_GUIDE_FALLBACK,
        );
        statusDiv.appendChild(note);
      }
    }

    statusDiv.className = obsidianResult.success ? 'success' : 'error';
    syncStatusToTop();
  } catch (_e) {
    statusDiv.textContent = getMessageOr('testError', '接続テストに失敗しました。');
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
        showSaveError(statusDiv, saveResult.error, { syncTop: true });
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
        header.textContent = getMessageOr('aiResultHeader', 'AI: ');
        container.appendChild(header);

        const statusEl = document.createElement('span');
        statusEl.textContent = aiResult.success
          ? (getMessageOr('connectionSuccess', '接続成功'))
          : (getMessageOr('connectionFailed', '接続失敗'));
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
      statusDiv.textContent = getMessageOr('testError', '接続テストに失敗しました。');
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
  statusTopDiv.textContent = getMessageOr('testingConnection', '接続テスト中...');

  testLocalMarkdownBtn.disabled = true;
  try {
    // Save current settings first
    const saveResult = await saveDashboardSettings({
      formSelector: SETTINGS_FORM_SELECTOR,
      includeTiming: true,
    });
    if (!saveResult.success) {
      showSaveError(statusTopDiv, saveResult.error);
      return;
    }

    refreshLocalMarkdownScheduler();

    // Check if enabled
    const settings = await repo.getMany([StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED, StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]);
    const localExportEnabled = settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED];
    if (!localExportEnabled) {
      statusTopDiv.textContent = getMessageOr('testLocalMarkdownDisabled', 'ローカルMarkdown書き出しが無効です。まず有効にしてください。');
      statusTopDiv.className = 'error';
      return;
    }

    // Create test content
    const now = new Date();
    // PBI 2026-09-21-12: local date (was UTC via toISOString), matching the
    // production export paths. Near midnight JST the stamped day shifts.
    const date = getLocalDateString(now.getTime());
    const time = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    // Test content with hardcoded markdown patterns (not user input)
    const testContent = `# ${date}\n\n- ${time} [Yasumaro Test](https://example.com)\n    - This is a test entry for local Markdown export. If you can see this file, the export is working correctly!`;

    // Download test file
    const exportPath = settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH] ?? 'Yasumaro';
    const blob = new Blob([testContent], { type: 'text/markdown' });
    const blobUrl = URL.createObjectURL(blob);

    // PBI 27: exportPath はユーザー設定の自由文字列。filename 組み立て時に
    // sanitize し、失敗時は既定フォルダにフォールバックする。
    await chrome.downloads.download({
      url: blobUrl,
      filename: `${resolveSafeExportDir(exportPath)}/test-${date}.md`,
      saveAs: false,
      // PBI 27 上書きガード方針: テスト書き出しの再実行は冪等な再書き込み
      // が正しい動作のため明示 'overwrite'（全 4 箇所で統一）。
      conflictAction: 'overwrite'
    });

    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

    statusTopDiv.textContent = getMessageOr('testLocalMarkdownSuccess', 'ローカルMarkdown書き出しテスト: ファイルのダウンロードに成功しました');
    statusTopDiv.className = 'success';
  } catch (_e) {
    statusTopDiv.textContent = getMessageOr('testLocalMarkdownError', 'ローカルMarkdown書き出しテストに失敗しました');
    statusTopDiv.className = 'error';
  } finally {
    testLocalMarkdownBtn.disabled = false;
  }
}
