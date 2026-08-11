/**
 * messageHandlers-recordSecurity.test.ts
 * PBI 2026-08-08-06: 記録系ハンドラのセキュリティチェックにテストを付ける
 *
 * messageHandlers.ts は732行・17ファクトリだが、専用テストは
 * createValidVisitHandler 1つ分しかなかった。ここでは
 * createManualRecordHandler / createSaveRecordHandler が持つ
 * 2つのセキュリティ境界を固定する:
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

import { createManualRecordHandler, createSaveRecordHandler } from '../messageHandlers.js';
import type { ManualRecordHandlerDeps, SaveRecordHandlerDeps } from '../messageHandlers.js';
import type { ManualRecordMessage, SaveRecordMessage } from '../../messageTypes.js';
import { MessageHandlerRegistry } from '../MessageHandlerRegistry.js';

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
    getPrivacyInfoWithCache: vi.fn().mockResolvedValue(null),
    obsidian: {} as ManualRecordHandlerDeps['obsidian'],
    aiService: null,
    sqliteClient: null,
    recordingPipeline: { execute: vi.fn().mockResolvedValue({ success: true }) } as ManualRecordHandlerDeps['recordingPipeline'],
    getSettings: vi.fn().mockResolvedValue({}),
    setUrlContent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeSaveDeps(overrides: Partial<SaveRecordHandlerDeps> = {}): SaveRecordHandlerDeps {
  return {
    isRecordingAllowed: vi.fn().mockResolvedValue(true),
    getPrivacyInfoWithCache: vi.fn().mockResolvedValue(null),
    obsidian: {} as SaveRecordHandlerDeps['obsidian'],
    aiService: null,
    sqliteClient: null,
    recordingPipeline: { execute: vi.fn().mockResolvedValue({ success: true }) } as SaveRecordHandlerDeps['recordingPipeline'],
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
   * Sender authorization moved from the handler body to the registry, so this
   * dispatches through the registry rather than calling the handler directly —
   * calling it directly would bypass the layer that now enforces the rule.
   */
  it('rejects a content script sender (extension-page-only operation)', async () => {
    const deps = makeManualDeps();
    const registry = new MessageHandlerRegistry('test-extension-id');
    const sendResponse = vi.fn();

    registry.register('MANUAL_RECORD', createManualRecordHandler(deps), 'extension-only');
    registry.dispatch('MANUAL_RECORD', manualMessage('https://example.com'), CONTENT_SCRIPT_SENDER, sendResponse);
    await Promise.resolve();

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

  /** Dispatched through the registry — see the MANUAL_RECORD case above. */
  it('rejects a content script sender', async () => {
    const deps = makeSaveDeps();
    const registry = new MessageHandlerRegistry('test-extension-id');
    const sendResponse = vi.fn();

    registry.register('SAVE_RECORD', createSaveRecordHandler(deps), 'extension-only');
    registry.dispatch('SAVE_RECORD', saveMessage('https://example.com'), CONTENT_SCRIPT_SENDER, sendResponse);
    await Promise.resolve();

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
