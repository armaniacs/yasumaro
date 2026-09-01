/**
 * messageHandlers-recordSecurity.test.ts
 * 記録系ハンドラ（recordingHandlers.ts の createManualRecordHandler /
 * createSaveRecordHandler）が持つセキュリティ境界を固定する:
 *
 *   1. VULN-004: 安全でないURLスキーム(javascript:, file:, http: 等)の拒否
 *   2. VULN-004: content script からの送信元拒否（拡張ページ専用の操作）
 *   3. プライバシー同意が無い場合の拒否
 *
 * これらが外れると、拡張機能が任意スキームのURLを記録し、
 * 任意のWebページが記録操作を起動できるようになる。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  addLog: vi.fn(),
  ErrorCode: { API_REQUEST_FAILURE: 'API_REQUEST_FAILURE' },
  LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' },
}));

import { createManualRecordHandler, createSaveRecordHandler } from '../recordingHandlers.js';
import type { ManualRecordHandlerDeps, SaveRecordHandlerDeps } from '../recordingHandlers.js';
import type { ManualRecordMessage, SaveRecordMessage } from '../../messageTypes.js';
import { createMessageRouter } from '../MessageRouter.js';
import type { MessageRouterDeps } from '../MessageRouter.js';

/** Sender representing an extension page (popup/dashboard), which is allowed. */
const EXTENSION_SENDER = { id: 'test-extension-id' } as chrome.runtime.MessageSender;

/** Sender representing a content script running in a tab, which is not allowed. */
const CONTENT_SCRIPT_SENDER = {
  id: 'test-extension-id',
  tab: { id: 1, url: 'https://evil.example' },
} as chrome.runtime.MessageSender;

function makeManualDeps(overrides: Partial<ManualRecordHandlerDeps> = {}): ManualRecordHandlerDeps {
  return {
    isRecordingAllowed: vi.fn().mockResolvedValue(true),
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
    fetchContent: vi.fn().mockResolvedValue('content'),
    recordingPipeline: { record: vi.fn().mockResolvedValue({ success: true }) } as ManualRecordHandlerDeps['recordingPipeline'],
    getSettings: vi.fn().mockResolvedValue({}),
    setUrlContent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeSaveDeps(overrides: Partial<SaveRecordHandlerDeps> = {}): SaveRecordHandlerDeps {
  return {
    isRecordingAllowed: vi.fn().mockResolvedValue(true),
    recordingPipeline: { record: vi.fn().mockResolvedValue({ success: true }) } as SaveRecordHandlerDeps['recordingPipeline'],
    getSettings: vi.fn().mockResolvedValue({}),
    setUrlContent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function manualMessage(url: string): ManualRecordMessage {
  return {
    type: 'MANUAL_RECORD',
    payload: { url, title: 'Title', content: 'content', skipAi: true },
  } as ManualRecordMessage;
}

function saveMessage(url: string): SaveRecordMessage {
  return {
    type: 'SAVE_RECORD',
    payload: { url, title: 'Title', content: 'content', summary: 'summary', tags: [] },
  } as SaveRecordMessage;
}

/** Router deps sharing the per-test handler deps so assertions can observe them. */
function makeRouterDeps(
  manualDeps: ManualRecordHandlerDeps,
  saveDeps: SaveRecordHandlerDeps,
): MessageRouterDeps {
  return {
    runtimeId: 'test-extension-id',
    recordingPipeline: { record: async () => ({ success: true }) },
    tabCache: { add: () => undefined, update: () => undefined },
    obsidian: { testConnection: async () => ({ success: true }) },
    aiService: { testConnection: async () => ({ success: true }) },
    manualRecordDeps: manualDeps,
    saveRecordDeps: saveDeps,
    hasPrivacyConsent: async () => true,
    buildAllowedUrls: () => new Set(),
    getSettings: async () => ({}),
    isDomainAllowed: async () => true,
    clearSettingsCache: () => undefined,
    notifyAiTestProgress: () => undefined,
    getPrivacyCache: () => null,
    updateActivity: async () => undefined,
    lockSession: async () => undefined,
    autoSavedBadgeTabs: { add: () => undefined, has: () => false },
    initExportScheduler: async () => undefined,
    updateConsentBadge: async () => undefined,
    generateWeeklySummary: async () => true,
    generateMonthlySummary: async () => true,
    dashboardSqliteHandler: () => undefined,
  };
}

/** URL schemes that must never be recorded. */
const INSECURE_URLS = [
  'javascript:alert(1)',
  'file:///etc/passwd',
  'data:text/html,<script>alert(1)</script>',
  'chrome://settings',
  'ftp://example.com/file',
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension-id' },
    i18n: { getMessage: vi.fn((key: string) => key) },
  } as unknown as typeof chrome);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createManualRecordHandler — VULN-004 URL scheme validation', () => {
  it.each(INSECURE_URLS)('rejects %s', async (url) => {
    const deps = makeManualDeps();
    const handler = createManualRecordHandler(deps);
    const sendResponse = vi.fn();

    await handler(manualMessage(url), EXTENSION_SENDER, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'Insecure URL protocol not allowed',
    });
    // The insecure URL must never reach storage.
    expect(deps.setUrlContent).not.toHaveBeenCalled();
  });

  /**
   * Sender authorization moved from the handler body to the MessageRouter trust
   * table, so this dispatches through the router rather than calling the handler
   * directly — calling it directly would bypass the layer that now enforces the rule.
   */
  it('rejects a content script sender (extension-page-only operation)', async () => {
    const deps = makeManualDeps();
    const router = createMessageRouter(makeRouterDeps(deps, makeSaveDeps()));
    const sendResponse = vi.fn();

    const handled = router.dispatch(manualMessage('https://example.com'), CONTENT_SCRIPT_SENDER, sendResponse);
    await Promise.resolve();

    expect(handled).toBe(false);
    expect(deps.isRecordingAllowed).not.toHaveBeenCalled();
    expect(deps.setUrlContent).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'MANUAL_RECORD is not allowed from content scripts',
    });
  });

  it('refuses to record without privacy consent', async () => {
    const deps = makeManualDeps({ isRecordingAllowed: vi.fn().mockResolvedValue(false) });
    const handler = createManualRecordHandler(deps);
    const sendResponse = vi.fn();

    await handler(manualMessage('https://example.com'), EXTENSION_SENDER, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      reason: 'privacy_consent_required',
    });
    expect(deps.setUrlContent).not.toHaveBeenCalled();
  });
});

describe('createSaveRecordHandler — VULN-004 URL scheme validation', () => {
  it.each(INSECURE_URLS)('rejects %s', async (url) => {
    const deps = makeSaveDeps();
    const handler = createSaveRecordHandler(deps);
    const sendResponse = vi.fn();

    await handler(saveMessage(url), EXTENSION_SENDER, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'Insecure URL protocol not allowed',
    });
    expect(deps.setUrlContent).not.toHaveBeenCalled();
  });

  /** Dispatched through the router — see the MANUAL_RECORD case above. */
  it('rejects a content script sender', async () => {
    const deps = makeSaveDeps();
    const router = createMessageRouter(makeRouterDeps(makeManualDeps(), deps));
    const sendResponse = vi.fn();

    const handled = router.dispatch(saveMessage('https://example.com'), CONTENT_SCRIPT_SENDER, sendResponse);
    await Promise.resolve();

    expect(handled).toBe(false);
    expect(deps.isRecordingAllowed).not.toHaveBeenCalled();
    expect(deps.setUrlContent).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'SAVE_RECORD is not allowed from content scripts',
    });
  });

  it('refuses to record without privacy consent', async () => {
    const deps = makeSaveDeps({ isRecordingAllowed: vi.fn().mockResolvedValue(false) });
    const handler = createSaveRecordHandler(deps);
    const sendResponse = vi.fn();

    await handler(saveMessage('https://example.com'), EXTENSION_SENDER, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      reason: 'privacy_consent_required',
    });
    expect(deps.setUrlContent).not.toHaveBeenCalled();
  });
});

// These success/failure cases pin the recording-handler behaviour when driven
// through the minimal base deps (deep-dig 子PBI 4): the handler must only
// require isRecordingAllowed / recordingPipeline / getSettings / setUrlContent
// (plus checkRateLimit and fetchContent for MANUAL_RECORD), and the existing
// result mapping must be preserved.
describe('recording handlers — minimal base deps behaviour', () => {
  it('MANUAL_RECORD forwards the pipeline result and backfills content on success', async () => {
    const pipeline = { record: vi.fn().mockResolvedValue({ success: true, url: 'https://example.com' }) };
    const deps = makeManualDeps({ recordingPipeline: pipeline as never });
    const handler = createManualRecordHandler(deps);
    const sendResponse = vi.fn();

    await handler(manualMessage('https://example.com'), EXTENSION_SENDER, sendResponse);

    expect(pipeline.record).toHaveBeenCalledTimes(1);
    expect(deps.setUrlContent).toHaveBeenCalledWith('https://example.com', 'content');
    expect(sendResponse).toHaveBeenCalledWith({ success: true, url: 'https://example.com' });
  });

  it('MANUAL_RECORD does not backfill content when recording fails', async () => {
    const pipeline = { record: vi.fn().mockResolvedValue({ success: false, error: 'boom' }) };
    const deps = makeManualDeps({ recordingPipeline: pipeline as never });
    const handler = createManualRecordHandler(deps);
    const sendResponse = vi.fn();

    await handler(manualMessage('https://example.com'), EXTENSION_SENDER, sendResponse);

    expect(deps.setUrlContent).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'boom' });
  });

  it('MANUAL_RECORD rejects when the rate limit is exceeded (skipAi)', async () => {
    const deps = makeManualDeps({
      checkRateLimit: vi.fn().mockResolvedValue({ allowed: false, error: 'rate limited' }),
    });
    const handler = createManualRecordHandler(deps);
    const sendResponse = vi.fn();

    await handler(manualMessage('https://example.com'), EXTENSION_SENDER, sendResponse);

    expect(deps.recordingPipeline.record).not.toHaveBeenCalled();
    expect(deps.setUrlContent).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'rate limited' });
  });

  it('MANUAL_RECORD fetches content only when none was supplied', async () => {
    const fetchContent = vi.fn().mockResolvedValue('fetched');
    const deps = makeManualDeps({ fetchContent });
    const handler = createManualRecordHandler(deps);
    const sendResponse = vi.fn();

    await handler(
      { type: 'MANUAL_RECORD', payload: { url: 'https://example.com', title: 'T', content: '', force: true, skipAi: false } } as ManualRecordMessage,
      EXTENSION_SENDER,
      sendResponse,
    );

    expect(fetchContent).toHaveBeenCalledWith('https://example.com');
    expect(deps.setUrlContent).toHaveBeenCalledWith('https://example.com', 'fetched');
  });

  it('SAVE_RECORD forwards the pipeline result and backfills content on success', async () => {
    const pipeline = { record: vi.fn().mockResolvedValue({ success: true, url: 'https://example.com' }) };
    const deps = makeSaveDeps({ recordingPipeline: pipeline as never });
    const handler = createSaveRecordHandler(deps);
    const sendResponse = vi.fn();

    await handler(saveMessage('https://example.com'), EXTENSION_SENDER, sendResponse);

    expect(pipeline.record).toHaveBeenCalledTimes(1);
    expect(deps.setUrlContent).toHaveBeenCalledWith('https://example.com', 'content');
    expect(sendResponse).toHaveBeenCalledWith({ success: true, url: 'https://example.com' });
  });

  it('SAVE_RECORD does not backfill content when recording fails', async () => {
    const pipeline = { record: vi.fn().mockResolvedValue({ success: false, error: 'boom' }) };
    const deps = makeSaveDeps({ recordingPipeline: pipeline as never });
    const handler = createSaveRecordHandler(deps);
    const sendResponse = vi.fn();

    await handler(saveMessage('https://example.com'), EXTENSION_SENDER, sendResponse);

    expect(deps.setUrlContent).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'boom' });
  });
});
