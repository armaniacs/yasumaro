// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { useTimerClock, waitForMock } from '../../../../testDir/waitPolicy.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import type { SettingsReader } from '../../../utils/storage/SettingsRepository.js';

// ------------------------------------------------------------------
// Mock dependencies – hoisted by vitest
// ------------------------------------------------------------------
// Only the save pipeline is faked; saveErrorText is the real one, because the
// save-error wording is the single definition these tests pin against.
vi.mock('../../settingsPipeline.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../settingsPipeline.js')>()),
  saveDashboardSettings: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../../utils/i18n.js', async () => {
  const { mockGetMessage } = await import('../../../../testDir/i18nMock.js');
  const getMessage = vi.fn((key: string) => key);
  return mockGetMessage(getMessage);
});

vi.mock('../../aiTestResultView.js', () => ({
  formatProviderHeadline: vi.fn((p: any) => `headline:${p.provider}`),
  formatProviderDetailLines: vi.fn(() => []),
}));

vi.mock('../../aiTestProgressClient.js', () => ({
  subscribeAiTestProgress: vi.fn(() => vi.fn()),
  generateAiTestRunId: vi.fn(() => 'test-run-id'),
}));

vi.mock('../../aiTestProgressView.js', () => ({
  buildAiTestProgressView: vi.fn(() => {
    const label = document.createElement('span');
    const elapsedEl = document.createElement('div');
    elapsedEl.className = 'ai-test-elapsed';
    return { label, elapsedEl };
  }),
  renderAiTestProgressLabel: vi.fn(),
  renderAiTestProgressElapsed: vi.fn(),
}));

// ------------------------------------------------------------------
// Imports after mocks
// ------------------------------------------------------------------
import {
  createConnectionStatusElement,
  testObsidianConnection,
  testAiConnection,
  handleSaveOnly,
  handleTestObsidian,
  handleTestAi,
  handleTestLocalMarkdown,
} from '../connectionTests.js';
import { saveDashboardSettings } from '../../settingsPipeline.js';
import { getMessage } from '../../../utils/i18n.js';
import { formatProviderHeadline, formatProviderDetailLines } from '../../aiTestResultView.js';
import { subscribeAiTestProgress, generateAiTestRunId } from '../../aiTestProgressClient.js';
import { buildAiTestProgressView, renderAiTestProgressLabel, renderAiTestProgressElapsed } from '../../aiTestProgressView.js';

const mockedSaveDashboardSettings = vi.mocked(saveDashboardSettings);
const mockedGetMessage = vi.mocked(getMessage);
const mockedFormatHeadline = vi.mocked(formatProviderHeadline);
const mockedFormatDetailLines = vi.mocked(formatProviderDetailLines);
const mockedSubscribe = vi.mocked(subscribeAiTestProgress);
const mockedGenerateRunId = vi.mocked(generateAiTestRunId);
const mockedBuildView = vi.mocked(buildAiTestProgressView);
const mockedRenderLabel = vi.mocked(renderAiTestProgressLabel);
const mockedRenderElapsed = vi.mocked(renderAiTestProgressElapsed);

// helpers
function setupChrome(overrides: Record<string, any> = {}) {
  const base: any = {
    runtime: {
      id: 'test-extension-id',
      sendMessage: vi.fn().mockResolvedValue({}),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    downloads: { download: vi.fn().mockResolvedValue('dl-id') },
    i18n: { getMessage: vi.fn((k: string) => k), getUILanguage: vi.fn(() => 'en') },
    storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
  };
  const merged = { ...base, ...overrides };
  // allow nested overrides
  if (overrides.runtime) merged.runtime = { ...base.runtime, ...overrides.runtime };
  if (overrides.downloads) merged.downloads = { ...base.downloads, ...overrides.downloads };
  (globalThis as any).chrome = merged;
  return merged;
}

// Identity mock that mirrors src/utils/i18n.ts named-substitution behavior for
// the connection label format key, so label-rendering tests keep seeing
// `<label>: ` instead of the raw key name.
function labelAwareGetMessage(extra?: (key: string) => string): typeof getMessage {
  return ((key: string, subs?: unknown) => {
    if (
      key === 'connectionStatusLabel' &&
      subs !== null &&
      typeof subs === 'object' &&
      !Array.isArray(subs) &&
      'label' in subs
    ) {
      return `${(subs as Record<string, unknown>).label}: `;
    }
    return extra ? extra(key) : key;
  }) as typeof getMessage;
}

function resetDomForLocalMarkdown() {
  document.body.innerHTML = `
    <button id="testLocalMarkdownBtnTop"></button>
    <div id="statusTop"></div>
    <form id="panel-general"></form>
    <div id="status"></div>
  `;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
  mockedGetMessage.mockImplementation(labelAwareGetMessage());
  mockedFormatHeadline.mockImplementation((p: any) => `headline:${p.provider}`);
  mockedFormatDetailLines.mockReturnValue([]);
  mockedSubscribe.mockReturnValue(vi.fn());
  mockedGenerateRunId.mockReturnValue('test-run-id');
  mockedBuildView.mockImplementation(() => {
    const label = document.createElement('span');
    const elapsedEl = document.createElement('div');
    elapsedEl.className = 'ai-test-elapsed';
    return { label, elapsedEl };
  });
  mockedRenderLabel.mockClear();
  mockedRenderElapsed.mockClear();
  setupChrome();
  // URL mocks - ensure they are vi fns
  (globalThis.URL as any).createObjectURL = vi.fn(() => 'blob:mock-url');
  (globalThis.URL as any).revokeObjectURL = vi.fn();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// ------------------------------------------------------------------
// createConnectionStatusElement
// ------------------------------------------------------------------
describe('createConnectionStatusElement', () => {
  it('creates success element with getMessage success text', () => {
    mockedGetMessage.mockImplementation(labelAwareGetMessage((k) => k === 'connectionSuccess' ? '接続成功' : k));
    const el = createConnectionStatusElement('Obsidian', { success: true, message: 'ok' });
    expect(el.className).toBe('diag-indent');
    expect(el.querySelector('strong')!.textContent).toBe('Obsidian: ');
    const span = el.querySelector('span')!;
    expect(span.textContent).toBe('接続成功');
    expect(span.className).toBe('diag-success');
  });

  it('creates success element with fallback when getMessage returns falsy', () => {
    mockedGetMessage.mockReturnValue('' as any);
    const el = createConnectionStatusElement('AI', { success: true, message: 'ok' });
    expect(el.querySelector('span')!.textContent).toBe('接続成功');
    expect(el.querySelector('span')!.className).toBe('diag-success');
  });

  it('renders connection label via connectionStatusLabel key with English fallback', () => {
    mockedGetMessage.mockReturnValue('' as any);
    const el = createConnectionStatusElement('Obsidian', { success: true, message: 'ok' });
    expect(mockedGetMessage).toHaveBeenCalledWith('connectionStatusLabel', { label: 'Obsidian' });
    expect(el.querySelector('strong')!.textContent).toBe('Obsidian: ');
  });

  it('creates error element', () => {
    const el = createConnectionStatusElement('Obsidian', { success: false, message: 'Failed' });
    expect(el.querySelector('span')!.textContent).toBe('Failed');
    expect(el.querySelector('span')!.className).toBe('diag-error');
  });
});

// ------------------------------------------------------------------
// testObsidianConnection
// ------------------------------------------------------------------
describe('testObsidianConnection', () => {
  it('sends protocol/port/apiKey when apiKey present', async () => {
    document.body.innerHTML = `<input id="protocol" value=" https " /><input id="port" value=" 27124 " />`;
    const sendMessage = vi.fn().mockResolvedValue({ obsidian: { success: true, message: 'OK' } });
    setupChrome({ runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    const res = await testObsidianConnection('my-key');
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'TEST_OBSIDIAN',
      payload: { protocol: 'https', port: '27124', apiKey: 'my-key' },
    }));
    expect(res.success).toBe(true);
  });

  it('sends empty payload when apiKey empty', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ obsidian: { success: true, message: 'OK' } });
    setupChrome({ runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    document.body.innerHTML = '';
    const res = await testObsidianConnection('');
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ payload: {} }));
    expect(res.success).toBe(true);
  });

  it('sends empty payload when apiKey undefined and missing inputs', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ obsidian: { success: true, message: 'OK' } });
    setupChrome({ runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    document.body.innerHTML = '';
    const res = await testObsidianConnection('' as any);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ payload: {} }));
    expect(res).toEqual({ success: true, message: 'OK' });
  });

  it('returns connectionNoResponse key when obsidian field missing', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    setupChrome({ runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    const res = await testObsidianConnection('k');
    expect(mockedGetMessage).toHaveBeenCalledWith('connectionNoResponse');
    expect(res).toEqual({ success: false, message: 'connectionNoResponse' });
  });

  it('returns English fallback when connectionNoResponse key missing', async () => {
    mockedGetMessage.mockReturnValue('' as any);
    const sendMessage = vi.fn().mockResolvedValue({});
    setupChrome({ runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    const res = await testObsidianConnection('k');
    expect(res.message).toBe('No response');
  });

  it('returns connectionNoResponse key when sendMessage returns undefined', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    setupChrome({ runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    const res = await testObsidianConnection('k');
    expect(res.message).toBe('connectionNoResponse');
  });

  it('handles missing protocol/port elements gracefully', async () => {
    document.body.innerHTML = '';
    const sendMessage = vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'err' } });
    setupChrome({ runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    const res = await testObsidianConnection('key');
    // PBI 2026-09-19-22: missing form values are omitted, not sent as undefined
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      payload: { apiKey: 'key' },
    }));
    expect(res.success).toBe(false);
  });
});

// ------------------------------------------------------------------
// testAiConnection
// ------------------------------------------------------------------
describe('testAiConnection', () => {
  it('calls sendMessage without runId when not provided', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ai: { success: true, message: 'OK', providers: [] } });
    setupChrome({ runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    const res = await testAiConnection();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'TEST_AI', payload: {} }));
    // ensure runId not present
    const arg = sendMessage.mock.calls[0]?.[0];
    expect(arg.runId).toBeUndefined();
    expect(res.success).toBe(true);
  });

  it('includes runId when provided', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ai: { success: true, message: 'OK', providers: [] } });
    setupChrome({ runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    const res = await testAiConnection('run-123');
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-123' }));
    expect(res.success).toBe(true);
  });

  it('returns connectionNoResponse key fallback when ai missing', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    setupChrome({ runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    const res = await testAiConnection();
    expect(mockedGetMessage).toHaveBeenCalledWith('connectionNoResponse');
    expect(res).toEqual({ success: false, message: 'connectionNoResponse', providers: [] });
  });

  it('returns English fallback when connectionNoResponse key missing', async () => {
    mockedGetMessage.mockReturnValue('' as any);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    setupChrome({ runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    const res = await testAiConnection();
    expect(res.message).toBe('No response');
  });

  it('returns undefined response fallback', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    setupChrome({ runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    const res = await testAiConnection();
    expect(res.message).toBe('connectionNoResponse');
  });

  it('returns providers from ai response', async () => {
    const ai = { success: true, message: 'OK', providers: [{ provider: 'gemini', success: true, message: 'ok' }] };
    const sendMessage = vi.fn().mockResolvedValue({ ai });
    setupChrome({ runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    const res = await testAiConnection();
    expect(res.providers).toHaveLength(1);
  });
});

// ------------------------------------------------------------------
// handleSaveOnly
// ------------------------------------------------------------------
describe('handleSaveOnly', () => {
  it('returns early when statusDiv missing', async () => {
    document.body.innerHTML = '';
    await handleSaveOnly();
    expect(mockedSaveDashboardSettings).not.toHaveBeenCalled();
  });

  it('saves successfully and shows success message (truthy getMessage)', async () => {
    document.body.innerHTML = `<div id="status"></div><div id="statusTop"></div>`;
    mockedGetMessage.mockImplementation((k: string) => k === 'saveSuccess' ? '保存しました' : k);
    // ensure saveDashboardSettings calls onSuccess
    mockedSaveDashboardSettings.mockImplementation(async (opts: any) => {
      opts?.onSuccess?.();
      return { success: true } as any;
    });
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({}), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleSaveOnly();
    const status = document.getElementById('status')!;
    expect(status.textContent).toBe('保存しました');
    expect(status.className).toBe('status-message success');
  });

  it('saves successfully with fallback when getMessage returns falsy', async () => {
    document.body.innerHTML = `<div id="status"></div>`;
    mockedGetMessage.mockReturnValue('' as any);
    mockedSaveDashboardSettings.mockImplementation(async (opts: any) => { opts?.onSuccess?.(); return { success: true } as any; });
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({}), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleSaveOnly();
    expect(document.getElementById('status')!.textContent).toBe('設定を保存しました。');
  });

  it('handles save failure with fallback message', async () => {
    document.body.innerHTML = `<div id="status"></div><div id="statusTop"></div>`;
    mockedGetMessage.mockReturnValue('' as any);
    mockedSaveDashboardSettings.mockResolvedValue({ success: false, error: 'validation_failed' } as any);
    await handleSaveOnly();
    expect(document.getElementById('status')!.textContent).toBe('設定の保存に失敗しました。');
    expect(document.getElementById('status')!.className).toBe('status-message error');
  });

  it('shows saveError key when getMessage returns truthy', async () => {
    document.body.innerHTML = `<div id="status"></div>`;
    mockedGetMessage.mockImplementation((k: string) => k === 'saveError' ? 'SAVE_ERR' : k);
    mockedSaveDashboardSettings.mockResolvedValue({ success: false } as any);
    await handleSaveOnly();
    expect(document.getElementById('status')!.textContent).toBe('SAVE_ERR');
  });

  // The three save-error kinds used to be spelled out per handler, so the
  // wording could drift between the four call sites. They now come from
  // settingsPipeline's single definition, and these are the three keys it maps.
  it.each([
    ['aiProviderPriority1Required', 'Priority 1 is required'],
    ['aiProviderPriorityDuplicateWarning', 'Duplicate provider and model'],
    ['http_confirm_cancelled', '設定の保存に失敗しました。'],
  ])('derives the save-error wording for %s from the shared definition', async (error, expected) => {
    document.body.innerHTML = `<div id="status"></div><div id="statusTop"></div>`;
    mockedGetMessage.mockReturnValue('' as any);
    mockedSaveDashboardSettings.mockResolvedValue({ success: false, error } as any);
    await handleSaveOnly();
    expect(document.getElementById('status')!.textContent).toBe(expected);
  });

  it('refreshLocalMarkdownScheduler swallowed sync throw', async () => {
    document.body.innerHTML = `<div id="status"></div>`;
    mockedGetMessage.mockReturnValue('saveSuccess' as any);
    mockedSaveDashboardSettings.mockImplementation(async (opts: any) => { opts?.onSuccess?.(); return { success: true } as any; });
    const sendMessage = vi.fn(() => { throw new Error('context invalidated'); });
    setupChrome({ runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await expect(handleSaveOnly()).resolves.toBeUndefined();
    expect(document.getElementById('status')!.textContent).toBe('saveSuccess');
  });

  it('refreshLocalMarkdownScheduler swallowed async rejection', async () => {
    document.body.innerHTML = `<div id="status"></div>`;
    mockedGetMessage.mockReturnValue('saveSuccess' as any);
    mockedSaveDashboardSettings.mockImplementation(async (opts: any) => { opts?.onSuccess?.(); return { success: true } as any; });
    const sendMessage = vi.fn().mockRejectedValue(new Error('async fail'));
    setupChrome({ runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await expect(handleSaveOnly()).resolves.toBeUndefined();
    // still success
    expect(document.getElementById('status')!.className).toBe('status-message success');
  });
});

// ------------------------------------------------------------------
// handleTestObsidian
// ------------------------------------------------------------------
describe('handleTestObsidian', () => {
  it('returns early when button missing', async () => {
    document.body.innerHTML = `<div id="status"></div>`;
    await expect(handleTestObsidian()).resolves.toBeUndefined();
  });

  it('returns early when statusDiv missing', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button>`;
    await expect(handleTestObsidian()).resolves.toBeUndefined();
  });

  it('shows testingConnection then success', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><div id="statusTop"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/><input id="port" value="27124"/>`;
    mockedGetMessage.mockImplementation(labelAwareGetMessage((k) => k === 'testingConnection' ? 'テスト中' : k));
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: true, message: 'OK' } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestObsidian();
    const status = document.getElementById('status')!;
    expect(status.className).toBe('status-message success');
    expect(status.innerHTML).toContain('Obsidian');
    expect((document.getElementById('testObsidianBtn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows testingConnection fallback when getMessage falsy', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value=""/><input id="protocol" value="https"/><input id="port" value="27124"/>`;
    mockedGetMessage.mockReturnValue('' as any);
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: true, message: 'OK' } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    // need to capture initial text before overwritten? The function sets then clears; final is success.
    // Instead verify fallback path exercised via coverage: ensure no throw
    await handleTestObsidian();
    expect(document.getElementById('status')!.className).toBe('status-message success');
  });

  it('handles typedApiKey trimming and empty fallback', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="  "/><input id="protocol" value="https"/>`;
    const sendMessage = vi.fn().mockResolvedValue({ obsidian: { success: true, message: 'OK' } });
    setupChrome({ runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestObsidian();
    // PBI 2026-09-19-22: non-empty form values are forwarded even when the
    // typed apiKey trims to empty; empty fields (apiKey here) are omitted
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ payload: { protocol: 'https' } }));
  });

  it('shows certificate link when https + a network-kind failure arrives', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/><input id="host" value=""/><input id="obsidianHost" value=""/><input id="port" value="27124"/>`;
    mockedGetMessage.mockImplementation((k: string) => k === 'acceptCertificate' ? '証明書を承認' : k);
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'Cannot connect. Check if Obsidian is running and Local REST API is enabled.', failure: { kind: 'network' } } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestObsidian({
      readSavedEndpoint: async () => ({ host: '127.0.0.1', port: '27124' }),
    });
    const link = document.querySelector('#status a') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.href).toContain('https://127.0.0.1:27124/');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.textContent).toBe('証明書を承認');
  });

  it('ignores the message wording and keys off failure.kind alone', async () => {
    // PBI 2026-09-26-09: the old condition matched a raw transport message the
    // Service Worker never returns. Firefox's wording differs from Chrome's, so
    // any wording must show the link as long as the kind is `network`.
    for (const message of [
      'Cannot connect. Check if Obsidian is running and Local REST API is enabled.',
      'NetworkError when attempting to fetch resource.',
      'Failed to fetch',
    ]) {
      document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/><input id="obsidianHost" value="127.0.0.1"/><input id="port" value="27124"/>`;
      setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message, failure: { kind: 'network' } } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
      await handleTestObsidian();
      expect(document.querySelector('#status a')).not.toBeNull();
    }
  });

  it('builds the link URL from the configured host instead of a hardcoded 127.0.0.1', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/><input id="obsidianHost" value="vault.example.com"/><input id="port" value="27124"/>`;
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'x', failure: { kind: 'network' } } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestObsidian();
    const link = document.querySelector('#status a') as HTMLAnchorElement;
    expect(link.href).toContain('https://vault.example.com:27124/');
    expect(link.href).not.toContain('127.0.0.1');
  });

  it('falls back to the saved endpoint when the form host is empty', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/><input id="obsidianHost" value="  "/><input id="port" value="27124"/>`;
    const readSavedEndpoint = vi.fn().mockResolvedValue({ host: 'obsidian.lan', port: '27124' });
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'x', failure: { kind: 'network' } } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestObsidian({ readSavedEndpoint });
    expect(readSavedEndpoint).toHaveBeenCalled();
    expect((document.querySelector('#status a') as HTMLAnchorElement).href).toContain('https://obsidian.lan:27124/');
  });

  it('prefers the form port over the saved port', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/><input id="obsidianHost" value=""/><input id="port" value="8443"/>`;
    const readSavedEndpoint = vi.fn().mockResolvedValue({ host: 'saved.example.com', port: '1111' });
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'x', failure: { kind: 'network' } } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestObsidian({ readSavedEndpoint });
    const href = (document.querySelector('#status a') as HTMLAnchorElement).href;
    expect(href).toContain('https://saved.example.com:8443/');
  });

  it('uses the default endpoint when neither the form nor storage has a host or port', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/>`;
    const readSavedEndpoint = vi.fn().mockResolvedValue({});
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'x', failure: { kind: 'network' } } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestObsidian({ readSavedEndpoint });
    expect((document.querySelector('#status a') as HTMLAnchorElement).href).toContain('https://127.0.0.1:27124/');
  });

  it('never lets a form value change the scheme or inject an authority', async () => {
    for (const host of ['evil.example.com@127.0.0.1', 'host/../..', '127.0.0.1#', 'a b', '127.0.0.1\nX-Injected: 1']) {
      document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/><input id="obsidianHost" value="${host.replace(/"/g, '&quot;')}"/><input id="port" value="27124"/>`;
      setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'x', failure: { kind: 'network' } } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
      await handleTestObsidian({ readSavedEndpoint: async () => ({}) });
      // getAttribute is the literal href that was assigned, so this pins the
      // built string rather than the browser's normalized form.
      const href = (document.querySelector('#status a') as HTMLAnchorElement).getAttribute('href') ?? '';
      expect(href).toBe('https://127.0.0.1:27124/');
      expect(href).not.toContain('@');
    }
  });

  it('keeps an IPv6 host bracketed and drops an out-of-range port', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/><input id="obsidianHost" value="::1"/><input id="port" value="99999"/>`;
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'x', failure: { kind: 'network' } } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestObsidian();
    const link = document.querySelector('#status a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://[::1]:27124/');
  });

  it('adds the Firefox steps when running on Firefox', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/><input id="obsidianHost" value="127.0.0.1"/><input id="port" value="27124"/>`;
    mockedGetMessage.mockImplementation((k: string) => {
      if (k === 'acceptCertificate') return '証明書を承認';
      if (k === 'certGuideFirefox') return 'FFGUIDE https://127.0.0.1:27124/';
      return k;
    });
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'x', failure: { kind: 'network' } } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestObsidian({ getBrowserInfo: async () => ({ name: 'Firefox' }) });
    expect(document.getElementById('status')!.textContent).toContain('FFGUIDE https://127.0.0.1:27124/');
  });

  it('shows only the generic guidance on Chrome', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/><input id="obsidianHost" value="127.0.0.1"/><input id="port" value="27124"/>`;
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'x', failure: { kind: 'network' } } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    // Chrome has no getBrowserInfo at all — the typeof guard must absorb that.
    await handleTestObsidian();
    expect(document.querySelector('#status a')).not.toBeNull();
    expect(document.getElementById('status')!.textContent).not.toContain('FFGUIDE');
  });

  it('treats a rejecting or non-Firefox getBrowserInfo as not Firefox', async () => {
    for (const getBrowserInfo of [
      async () => { throw new Error('unsupported'); },
      async () => ({ name: 'Chrome' }),
      async () => undefined,
    ]) {
      document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/><input id="obsidianHost" value="127.0.0.1"/><input id="port" value="27124"/>`;
      mockedGetMessage.mockImplementation((k: string) => k === 'certGuideFirefox' ? 'FFGUIDE' : k);
      setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'x', failure: { kind: 'network' } } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
      await handleTestObsidian({ getBrowserInfo: getBrowserInfo as never });
      expect(document.getElementById('status')!.textContent).not.toContain('FFGUIDE');
    }
  });

  it('uses the English Firefox fallback when the key is missing', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/><input id="obsidianHost" value="127.0.0.1"/><input id="port" value="27124"/>`;
    mockedGetMessage.mockReturnValue('' as any);
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'x', failure: { kind: 'network' } } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestObsidian({ getBrowserInfo: async () => ({ name: 'Firefox' }) });
    const text = document.getElementById('status')!.textContent ?? '';
    expect(text).toContain('Firefox keeps its own certificate store');
  });

  it('uses fallback acceptCertificate text when getMessage returns falsy', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/><input id="obsidianHost" value="127.0.0.1"/><input id="port" value="27124"/>`;
    mockedGetMessage.mockReturnValue('' as any);
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'x', failure: { kind: 'network' } } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestObsidian();
    const link = document.querySelector('#status a') as HTMLAnchorElement;
    expect(link.textContent).toBe('証明書を承認する');
  });

  it('does not show link when protocol is http even on a network failure', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/><input id="protocol" value="http"/><input id="obsidianHost" value="127.0.0.1"/><input id="port" value="27124"/>`;
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'Failed to fetch', failure: { kind: 'network' } } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestObsidian();
    expect(document.querySelector('#status a')).toBeNull();
  });

  it('does not show link on a timeout failure', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/><input id="obsidianHost" value="127.0.0.1"/><input id="port" value="27124"/>`;
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'Connection timeout. Is Obsidian running?', failure: { kind: 'timeout' } } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestObsidian();
    expect(document.querySelector('#status a')).toBeNull();
    expect(document.getElementById('status')!.textContent).toContain('Connection timeout');
  });

  it.each(['auth', 'http', 'configuration', undefined])(
    'does not show link when failure kind is %s',
    async (kind) => {
      document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/><input id="obsidianHost" value="127.0.0.1"/><input id="port" value="27124"/>`;
      const failure = kind === undefined ? undefined : { kind };
      setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'Failed to fetch', failure } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
      await handleTestObsidian();
      expect(document.querySelector('#status a')).toBeNull();
    },
  );

  it('does not show link on a successful connection', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/><input id="obsidianHost" value="127.0.0.1"/><input id="port" value="27124"/>`;
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: true, message: 'OK' } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestObsidian();
    expect(document.querySelector('#status a')).toBeNull();
  });

  it('handles port with whitespace trimming', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/><input id="obsidianHost" value="127.0.0.1"/><input id="port" value="  8080 "/>`;
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'x', failure: { kind: 'network' } } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestObsidian();
    expect((document.querySelector('#status a') as HTMLAnchorElement).href).toContain(':8080/');
  });

  it('still renders when the saved endpoint cannot be read', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/><input id="obsidianHost" value=""/><input id="port" value=""/>`;
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'x', failure: { kind: 'network' } } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestObsidian({ readSavedEndpoint: async () => { throw new Error('storage unavailable'); } });
    expect((document.querySelector('#status a') as HTMLAnchorElement).href).toContain('https://127.0.0.1:27124/');
  });

  it('sets error class on failed obsidian', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/><input id="port" value="27124"/>`;
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'fail' } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestObsidian();
    expect(document.getElementById('status')!.className).toBe('status-message error');
  });

  it('catches thrown error and shows testError fallback', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div><input id="apiKey" value="k"/>`;
    mockedGetMessage.mockReturnValue('' as any);
    setupChrome({ runtime: { sendMessage: vi.fn().mockRejectedValue(new Error('boom')), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestObsidian();
    expect(document.getElementById('status')!.textContent).toBe('接続テストに失敗しました。');
    expect(document.getElementById('status')!.className).toBe('status-message error');
  });

  it('catches thrown error with truthy getMessage', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div>`;
    mockedGetMessage.mockImplementation((k: string) => k === 'testError' ? 'TEST_ERR' : k);
    setupChrome({ runtime: { sendMessage: vi.fn().mockRejectedValue(new Error('boom')), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestObsidian();
    expect(document.getElementById('status')!.textContent).toBe('TEST_ERR');
  });

  it('always re-enables button after success or failure', async () => {
    document.body.innerHTML = `<button id="testObsidianBtn"></button><div id="status"></div>`;
    setupChrome({ runtime: { sendMessage: vi.fn().mockRejectedValue(new Error('x')), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestObsidian();
    expect((document.getElementById('testObsidianBtn') as HTMLButtonElement).disabled).toBe(false);
  });
});

// ------------------------------------------------------------------
// handleTestAi
// ------------------------------------------------------------------
describe('handleTestAi', () => {
  function buildDomWithTop() {
    document.body.innerHTML = `
      <button id="testAiBtn"></button>
      <button id="testAiBtnTop"></button>
      <div id="status"></div>
      <div id="statusTop"></div>
      <form id="panel-general"></form>
    `;
  }

  it('returns early when testAiBtn missing', async () => {
    document.body.innerHTML = `<div id="status"></div>`;
    await expect(handleTestAi()).resolves.toBeUndefined();
    expect(mockedGenerateRunId).not.toHaveBeenCalled();
  });

  it('returns early when statusDiv missing', async () => {
    document.body.innerHTML = `<button id="testAiBtn"></button>`;
    await expect(handleTestAi()).resolves.toBeUndefined();
  });

  it('guards re-entrancy via the shared runner in-flight guard', async () => {
    buildDomWithTop();
    // make saveDashboardSettings hang
    let resolveSave: (v: any) => void;
    mockedSaveDashboardSettings.mockReturnValue(new Promise(res => { resolveSave = res; }));
    const sendMessage = vi.fn().mockResolvedValue({ ai: { success: true, message: 'OK', providers: [] } });
    setupChrome({ runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });

    const first = handleTestAi(); // takes the runner's in-flight guard
    // second call should return immediately without calling sendMessage again
    await handleTestAi();
    expect(sendMessage).not.toHaveBeenCalled(); // first hasn't reached sendMessage yet due to pending save

    resolveSave!({ success: true });
    await first;
    // now inFlight reset, a third call should go through – count only TEST_AI messages
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    sendMessage.mockClear();
    sendMessage.mockResolvedValue({ ai: { success: true, message: 'OK', providers: [] } });
    await handleTestAi();
    const testAiCalls = sendMessage.mock.calls.filter((c: any) => c[0]?.type === 'TEST_AI');
    expect(testAiCalls).toHaveLength(1);
  });

  it('handles save failure shows saveError with fallback', async () => {
    buildDomWithTop();
    mockedGetMessage.mockReturnValue('' as any);
    mockedSaveDashboardSettings.mockResolvedValue({ success: false } as any);
    setupChrome({ runtime: { sendMessage: vi.fn(), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestAi();
    expect(document.getElementById('status')!.textContent).toBe('設定の保存に失敗しました。');
    expect(document.getElementById('status')!.className).toBe('status-message error');
    expect((document.getElementById('testAiBtn') as HTMLButtonElement).disabled).toBe(false);
    expect((document.getElementById('testAiBtnTop') as HTMLButtonElement).disabled).toBe(false);
  });

  it('handles save failure with truthy getMessage', async () => {
    buildDomWithTop();
    mockedGetMessage.mockImplementation((k: string) => k === 'saveError' ? 'SAVE_ERR' : k);
    mockedSaveDashboardSettings.mockResolvedValue({ success: false } as any);
    setupChrome({ runtime: { sendMessage: vi.fn(), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestAi();
    expect(document.getElementById('status')!.textContent).toBe('SAVE_ERR');
  });

  it('renders single provider via createConnectionStatusElement branch', async () => {
    buildDomWithTop();
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const ai = { success: true, message: 'OK', providers: [{ provider: 'gemini', success: true, message: 'ok', elapsedMs: 123 }] };
    // need single provider -> else branch (providers length <=1)
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ ai }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    // also mock obsidian? not needed. But saveDashboardSettings will be called.
    // Provide truthy getMessage for connectionSuccess branch
    mockedGetMessage.mockImplementation(labelAwareGetMessage((k) => k === 'connectionSuccess' ? '成功' : k));
    await handleTestAi();
    expect(document.getElementById('status')!.className).toBe('status-message success');
    // single provider renders via createConnectionStatusElement -> should contain AI label
    expect(document.getElementById('status')!.innerHTML).toContain('AI');
  });

  it('renders single provider with no providers field (else branch)', async () => {
    buildDomWithTop();
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const ai = { success: false, message: 'bad', providers: [] } as any;
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ ai }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    mockedGetMessage.mockReturnValue('' as any);
    await handleTestAi();
    expect(document.getElementById('status')!.className).toBe('status-message error');
    expect(document.getElementById('status')!.innerHTML).toContain('AI');
  });

  it('renders single provider when providers undefined', async () => {
    buildDomWithTop();
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const ai = { success: true, message: 'OK' } as any;
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ ai }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    mockedGetMessage.mockReturnValue('' as any);
    await handleTestAi();
    expect(document.getElementById('status')!.innerHTML).toContain('AI');
  });

  it('renders multi-provider success and failure headlines', async () => {
    buildDomWithTop();
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    mockedFormatHeadline.mockImplementation((p: any) => `head:${p.provider}:${p.success}`);
    mockedFormatDetailLines.mockReturnValue(['line1', 'line2']);
    const ai = {
      success: false,
      message: 'partial',
      providers: [
        { provider: 'gemini', success: true, message: 'ok', elapsedMs: 100 },
        { provider: 'openai', success: false, message: 'fail', elapsedMs: 200 },
      ],
    };
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ ai }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    mockedGetMessage.mockImplementation((k: string) => {
      if (k === 'connectionFailed') return '失敗';
      if (k === 'connectionSuccess') return '成功';
      return k;
    });
    await handleTestAi();
    const status = document.getElementById('status')!;
    // multi-provider container + 2 rows + 2*2 detail rows
    expect(status.innerHTML).toContain('head:gemini:true');
    expect(status.innerHTML).toContain('head:openai:false');
    expect(status.innerHTML).toContain('line1');
    expect(status.innerHTML).toContain('line2');
    expect(status.className).toBe('status-message error');
  });

  it('renders multi-provider success true with fallback messages', async () => {
    buildDomWithTop();
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    mockedFormatDetailLines.mockReturnValue([]);
    const ai = {
      success: true,
      message: 'all ok',
      providers: [
        { provider: 'gemini', success: true, message: 'ok', elapsedMs: 10 },
        { provider: 'openai', success: true, message: 'ok', elapsedMs: 10 },
      ],
    };
    mockedGetMessage.mockReturnValue('' as any); // trigger fallbacks
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ ai }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestAi();
    expect(document.getElementById('status')!.innerHTML).toContain('接続成功');
    expect(document.getElementById('status')!.className).toBe('status-message success');
  });

  it('renders multi-provider with connectionFailed fallback', async () => {
    buildDomWithTop();
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const ai = { success: false, message: 'fail', providers: [{ provider: 'a', success: false, message: 'x', elapsedMs: 1 }, { provider: 'b', success: false, message: 'y', elapsedMs: 1 }] };
    mockedGetMessage.mockReturnValue('' as any);
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ ai }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestAi();
    expect(document.getElementById('status')!.innerHTML).toContain('接続失敗');
  });

  it('renders multi-provider header via aiResultHeader key', async () => {
    buildDomWithTop();
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const ai = { success: true, message: 'ok', providers: [{ provider: 'a', success: true, message: 'x', elapsedMs: 1 }, { provider: 'b', success: true, message: 'y', elapsedMs: 1 }] };
    mockedGetMessage.mockImplementation(((k: string) => k) as typeof getMessage);
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ ai }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestAi();
    expect(mockedGetMessage).toHaveBeenCalledWith('aiResultHeader');
    expect(document.getElementById('status')!.querySelector('strong')!.textContent).toBe('aiResultHeader');
  });

  it('renders multi-provider header with English fallback when key missing', async () => {
    buildDomWithTop();
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const ai = { success: true, message: 'ok', providers: [{ provider: 'a', success: true, message: 'x', elapsedMs: 1 }, { provider: 'b', success: true, message: 'y', elapsedMs: 1 }] };
    mockedGetMessage.mockReturnValue('' as any);
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ ai }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestAi();
    expect(document.getElementById('status')!.querySelector('strong')!.textContent).toBe('AI: ');
  });

  it('handles exception in testAiConnection with fallback', async () => {
    buildDomWithTop();
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    setupChrome({ runtime: { sendMessage: vi.fn().mockRejectedValue(new Error('boom')), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    mockedGetMessage.mockReturnValue('' as any);
    await handleTestAi();
    expect(document.getElementById('status')!.textContent).toBe('接続テストに失敗しました。');
    expect(document.getElementById('status')!.className).toBe('status-message error');
  });

  it('handles exception with truthy getMessage', async () => {
    buildDomWithTop();
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    setupChrome({ runtime: { sendMessage: vi.fn().mockRejectedValue(new Error('boom')), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    mockedGetMessage.mockImplementation((k: string) => k === 'testError' ? 'TEST_ERR' : k);
    await handleTestAi();
    expect(document.getElementById('status')!.textContent).toBe('TEST_ERR');
  });

  it('cleans up timer and unsubscribe and resets buttons in finally', async () => {
    buildDomWithTop();
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const unsubscribe = vi.fn();
    mockedSubscribe.mockReturnValue(unsubscribe);
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ ai: { success: true, message: 'OK', providers: [] } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestAi();
    expect(unsubscribe).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
    expect((document.getElementById('testAiBtn') as HTMLButtonElement).disabled).toBe(false);
    expect((document.getElementById('testAiBtnTop') as HTMLButtonElement).disabled).toBe(false);
    clearSpy.mockRestore();
  });

  it('handles missing testAiBtnTop gracefully (null branch)', async () => {
    document.body.innerHTML = `<button id="testAiBtn"></button><div id="status"></div><form id="panel-general"></form>`;
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ ai: { success: true, message: 'OK', providers: [] } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await handleTestAi();
    expect((document.getElementById('testAiBtn') as HTMLButtonElement).disabled).toBe(false);
    expect(document.getElementById('status')!.className).toBe('status-message success');
  });

  it('subscribes with runId and handles progress updates (changed provider)', async () => {
    buildDomWithTop();
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    let capturedCb: (p: any) => void;
    mockedSubscribe.mockImplementation((runId: string, cb: any) => {
      expect(runId).toBe('test-run-id');
      capturedCb = cb;
      return vi.fn();
    });
    const ai = { success: true, message: 'OK', providers: [] };
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ ai }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });

    const promise = handleTestAi();
    // trigger progress callbacks before resolved
    // need to wait a tick for subscribe to be called
    await new Promise(r => setTimeout(r, 0));
    capturedCb!({ provider: 'gemini', index: 0, total: 2 });
    expect(mockedRenderLabel).toHaveBeenCalled();
    expect(mockedRenderElapsed).toHaveBeenCalled();
    // same provider/index should not announce again but still update elapsed
    const callCountBefore = mockedRenderLabel.mock.calls.length;
    capturedCb!({ provider: 'gemini', index: 0, total: 2 });
    // second same key => changed false => renderLabel not called again for announce part
    // but our mock tracks all calls; we check that label not called again with announceProvider false path?
    // Actually updateView(changed) only calls renderLabel when changed true, so call count should stay same
    expect(mockedRenderLabel.mock.calls.length).toBe(callCountBefore);
    // different provider should trigger again
    capturedCb!({ provider: 'openai', index: 1, total: 2 });
    expect(mockedRenderLabel.mock.calls.length).toBe(callCountBefore + 1);

    await promise;
  });

  it('updates elapsed timer ticks without a manual status mirror', async () => {
    useTimerClock();
    buildDomWithTop();
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    // keep real setInterval tracking
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    let capturedCb: any;
    mockedSubscribe.mockImplementation((_id: string, cb: any) => { capturedCb = cb; return vi.fn(); });
    setupChrome({ runtime: { sendMessage: vi.fn().mockImplementation(() => new Promise(res => vi.advanceTimersByTimeAsync(350).then(() => res({ ai: { success: true, message: 'OK', providers: [] } })))), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    // add statusTop element for sync
    document.body.innerHTML += `<div id="statusTop"><div class="ai-test-elapsed"></div></div>`;
    const promise = handleTestAi();
    await vi.advanceTimersByTimeAsync(10);
    capturedCb({ provider: 'gemini', index: 0, total: 1 });
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 200);
    // Wait for interval tick to happen at least once before promise resolves (handle runs 350ms > 200ms)
    await vi.advanceTimersByTimeAsync(250);
    expect(mockedRenderElapsed).toHaveBeenCalled();
    await promise;
    setIntervalSpy.mockRestore();
  });

  it('covers finally false branches when buildAiTestProgressView throws before timer', async () => {
    buildDomWithTop();
    mockedBuildView.mockImplementation(() => { throw new Error('build fail'); });
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ ai: { success: true, message: 'OK', providers: [] } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    mockedGetMessage.mockReturnValue('' as any);
    // The outer panel guard absorbs the throw and renders the generic error
    // instead of rejecting; the buttons are still restored.
    await expect(handleTestAi()).resolves.toBeUndefined();
    expect(document.getElementById('status')!.textContent).toBe('接続テストに失敗しました。');
    expect(document.getElementById('status')!.className).toBe('status-message error');
    // finally should have run and reset state despite rejection (the guard release allows next call)
    expect((document.getElementById('testAiBtn') as HTMLButtonElement).disabled).toBe(false);
    // verify re-entrancy guard cleared
    mockedBuildView.mockImplementation(() => {
      const label = document.createElement('span');
      const elapsedEl = document.createElement('div');
      elapsedEl.className = 'ai-test-elapsed';
      return { label, elapsedEl };
    });
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({ ai: { success: true, message: 'OK', providers: [] } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    await expect(handleTestAi()).resolves.toBeUndefined();
  });

  it('handles saveDashboardSettings throwing exception', async () => {
    buildDomWithTop();
    mockedSaveDashboardSettings.mockRejectedValue(new Error('save boom'));
    setupChrome({ runtime: { sendMessage: vi.fn(), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    mockedGetMessage.mockReturnValue('' as any);
    await handleTestAi();
    expect(document.getElementById('status')!.textContent).toBe('接続テストに失敗しました。');
  });
});

// ------------------------------------------------------------------
// handleTestLocalMarkdown – the main gap from task description
// ------------------------------------------------------------------
describe('handleTestLocalMarkdown', () => {
  it('reads export settings from injected repo (existing)', async () => {
    resetDomForLocalMarkdown();
    const repo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({
        [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: false,
        [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: 'ExportDir',
      }),
      getAll: vi.fn(),
    };
    await handleTestLocalMarkdown(repo);
    expect(repo.getMany).toHaveBeenCalledWith([
      StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED,
      StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH,
    ]);
  });

  it('returns early when button missing', async () => {
    document.body.innerHTML = `<div id="statusTop"></div>`;
    const repo: SettingsReader = { getMany: vi.fn(), getAll: vi.fn() };
    await handleTestLocalMarkdown(repo);
    expect(vi.mocked(repo.getMany)).not.toHaveBeenCalled();
  });

  it('returns early when statusTop missing', async () => {
    document.body.innerHTML = `<button id="testLocalMarkdownBtnTop"></button>`;
    const repo: SettingsReader = { getMany: vi.fn(), getAll: vi.fn() };
    await handleTestLocalMarkdown(repo);
    expect(vi.mocked(repo.getMany)).not.toHaveBeenCalled();
  });

  it('shows testingConnection with fallback when getMessage falsy', async () => {
    resetDomForLocalMarkdown();
    mockedGetMessage.mockReturnValue('' as any);
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const repo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({ [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: false, [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: 'Yasumaro' }),
      getAll: vi.fn(),
    };
    await handleTestLocalMarkdown(repo);
    // after disabled check, it should show disabled error fallback, not testing text
    expect(document.getElementById('status')!.className).toBe('status-message error');
  });

  it('shows saveError when save fails with fallback', async () => {
    resetDomForLocalMarkdown();
    mockedGetMessage.mockReturnValue('' as any);
    mockedSaveDashboardSettings.mockResolvedValue({ success: false } as any);
    const repo: SettingsReader = { getMany: vi.fn(), getAll: vi.fn() };
    await handleTestLocalMarkdown(repo);
    expect(document.getElementById('status')!.textContent).toBe('設定の保存に失敗しました。');
    expect(document.getElementById('status')!.className).toBe('status-message error');
    expect((document.getElementById('testLocalMarkdownBtnTop') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows saveError with truthy getMessage', async () => {
    resetDomForLocalMarkdown();
    mockedGetMessage.mockImplementation((k: string) => k === 'saveError' ? 'SAVE_ERR' : k);
    mockedSaveDashboardSettings.mockResolvedValue({ success: false } as any);
    const repo: SettingsReader = { getMany: vi.fn(), getAll: vi.fn() };
    await handleTestLocalMarkdown(repo);
    expect(document.getElementById('status')!.textContent).toBe('SAVE_ERR');
  });

  it('shows disabled error with truthy getMessage', async () => {
    resetDomForLocalMarkdown();
    mockedGetMessage.mockImplementation((k: string) => k === 'testLocalMarkdownDisabled' ? 'DISABLED_MSG' : k);
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const repo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({ [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: false, [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: 'Yasumaro' }),
      getAll: vi.fn(),
    };
    await handleTestLocalMarkdown(repo);
    expect(document.getElementById('status')!.textContent).toBe('DISABLED_MSG');
    expect(document.getElementById('status')!.className).toBe('status-message error');
  });

  it('shows disabled error with fallback when getMessage falsy', async () => {
    resetDomForLocalMarkdown();
    mockedGetMessage.mockReturnValue('' as any);
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const repo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({ [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: false }),
      getAll: vi.fn(),
    };
    await handleTestLocalMarkdown(repo);
    expect(document.getElementById('status')!.textContent).toBe('ローカルMarkdown書き出しが無効です。まず有効にしてください。');
  });

  it('treats falsy enabled (undefined) as disabled', async () => {
    resetDomForLocalMarkdown();
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const repo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({ [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: undefined }),
      getAll: vi.fn(),
    };
    await handleTestLocalMarkdown(repo);
    expect(document.getElementById('status')!.className).toBe('status-message error');
  });

  it('successful export with custom path and verifies download filename', async () => {
    resetDomForLocalMarkdown();
    const downloadMock = vi.fn().mockResolvedValue('id');
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({}), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } }, downloads: { download: downloadMock } });
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    mockedGetMessage.mockImplementation((k: string) => k === 'testLocalMarkdownSuccess' ? 'SUCCESS_MSG' : k);
    const repo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({ [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: true, [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: 'MyExport' }),
      getAll: vi.fn(),
    };
    await handleTestLocalMarkdown(repo);
    expect(downloadMock).toHaveBeenCalledWith(expect.objectContaining({
      filename: expect.stringContaining('MyExport/test-'),
      saveAs: false,
      conflictAction: 'overwrite',
    }));
    expect((globalThis.URL as any).createObjectURL).toHaveBeenCalled();
    // filename should end with .md
    expect(downloadMock.mock.calls[0]?.[0].filename).toMatch(/\.md$/);
    expect(document.getElementById('status')!.textContent).toBe('SUCCESS_MSG');
    expect(document.getElementById('status')!.className).toBe('status-message success');
    expect((globalThis.URL as any).revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect((document.getElementById('testLocalMarkdownBtnTop') as HTMLButtonElement).disabled).toBe(false);
  });

  it('successful export with fallback success message when getMessage falsy', async () => {
    resetDomForLocalMarkdown();
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({}), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } }, downloads: { download: vi.fn().mockResolvedValue('id') } });
    mockedGetMessage.mockReturnValue('' as any);
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const repo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({ [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: true, [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: 'Yasumaro' }),
      getAll: vi.fn(),
    };
    await handleTestLocalMarkdown(repo);
    expect(document.getElementById('status')!.textContent).toBe('ローカルMarkdown書き出しテスト: ファイルのダウンロードに成功しました');
    expect((globalThis.URL as any).revokeObjectURL).toHaveBeenCalled();
  });

  it('uses default exportPath Yasumaro when settings missing (nullish coalescing)', async () => {
    resetDomForLocalMarkdown();
    const downloadMock = vi.fn().mockResolvedValue('id');
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({}), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } }, downloads: { download: downloadMock } });
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const repo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({ [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: true }),
      getAll: vi.fn(),
    };
    await handleTestLocalMarkdown(repo);
    expect(downloadMock.mock.calls[0]?.[0].filename).toContain('Yasumaro/test-');
    expect((globalThis.URL as any).revokeObjectURL).toHaveBeenCalled();
  });

  it('uses default exportPath when getMany returns null value explicitly', async () => {
    resetDomForLocalMarkdown();
    const downloadMock = vi.fn().mockResolvedValue('id');
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({}), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } }, downloads: { download: downloadMock } });
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const repo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({ [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: true, [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: null }),
      getAll: vi.fn(),
    };
    // ??? null ?? 'Yasumaro' -> 'Yasumaro' but undefined path via ?? ensures Yasumaro
    await handleTestLocalMarkdown(repo);
    // Depending on null vs undefined, ?? treats null as fallback too, so Yasumaro
    expect(downloadMock.mock.calls[0]?.[0].filename).toContain('Yasumaro/test-');
    expect((globalThis.URL as any).revokeObjectURL).toHaveBeenCalled();
  });

  it('revokes the object url once the download promise resolves, without a timer', async () => {
    resetDomForLocalMarkdown();
    let releaseDownload: ((id: string) => void) | undefined;
    const downloadMock = vi.fn().mockImplementation(() => new Promise<string>((resolve) => { releaseDownload = resolve; }));
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({}), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } }, downloads: { download: downloadMock } });
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const repo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({ [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: true, [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: 'Yasumaro' }),
      getAll: vi.fn(),
    };
    const promise = handleTestLocalMarkdown(repo);
    await waitForMock(() => expect(downloadMock).toHaveBeenCalled());
    // Still in flight: the url must stay usable.
    expect((globalThis.URL as any).revokeObjectURL).not.toHaveBeenCalled();
    releaseDownload!('dl-id');
    await promise;
    expect((globalThis.URL as any).revokeObjectURL).toHaveBeenCalledTimes(1);
    expect((globalThis.URL as any).revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(document.getElementById('status')!.className).toBe('status-message success');
  });

  it('revokes the object url when the download rejects', async () => {
    resetDomForLocalMarkdown();
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({}), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } }, downloads: { download: vi.fn().mockRejectedValue(new Error('dl fail')) } });
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const repo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({ [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: true, [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: 'Yasumaro' }),
      getAll: vi.fn(),
    };
    await handleTestLocalMarkdown(repo);
    expect((globalThis.URL as any).revokeObjectURL).toHaveBeenCalledTimes(1);
    expect((globalThis.URL as any).revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    // the failure still reports the error and re-enables the button
    expect(document.getElementById('status')!.className).toBe('status-message error');
    expect((document.getElementById('testLocalMarkdownBtnTop') as HTMLButtonElement).disabled).toBe(false);
  });

  it('leaves no object url alive when save fails or export is disabled', async () => {
    resetDomForLocalMarkdown();
    mockedSaveDashboardSettings.mockResolvedValue({ success: false } as any);
    const enabledRepo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({ [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: true }),
      getAll: vi.fn(),
    };
    await handleTestLocalMarkdown(enabledRepo);
    expect((globalThis.URL as any).createObjectURL).not.toHaveBeenCalled();
    expect((globalThis.URL as any).revokeObjectURL).not.toHaveBeenCalled();

    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const disabledRepo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({ [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: false }),
      getAll: vi.fn(),
    };
    await handleTestLocalMarkdown(disabledRepo);
    expect((globalThis.URL as any).createObjectURL).not.toHaveBeenCalled();
    expect((globalThis.URL as any).revokeObjectURL).not.toHaveBeenCalled();
  });

  it('handles download throwing and shows error fallback', async () => {
    resetDomForLocalMarkdown();
    mockedGetMessage.mockReturnValue('' as any);
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({}), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } }, downloads: { download: vi.fn().mockRejectedValue(new Error('dl fail')) } });
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const repo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({ [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: true, [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: 'Yasumaro' }),
      getAll: vi.fn(),
    };
    await handleTestLocalMarkdown(repo);
    expect(document.getElementById('status')!.textContent).toBe('ローカルMarkdown書き出しテストに失敗しました');
    expect(document.getElementById('status')!.className).toBe('status-message error');
    expect((document.getElementById('testLocalMarkdownBtnTop') as HTMLButtonElement).disabled).toBe(false);
  });

  it('handles download throwing with truthy getMessage', async () => {
    resetDomForLocalMarkdown();
    mockedGetMessage.mockImplementation((k: string) => k === 'testLocalMarkdownError' ? 'DL_ERR' : k);
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({}), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } }, downloads: { download: vi.fn().mockRejectedValue(new Error('fail')) } });
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const repo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({ [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: true, [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: 'Yasumaro' }),
      getAll: vi.fn(),
    };
    await handleTestLocalMarkdown(repo);
    expect(document.getElementById('status')!.textContent).toBe('DL_ERR');
  });

  it('handles repo.getMany throwing', async () => {
    resetDomForLocalMarkdown();
    mockedGetMessage.mockReturnValue('' as any);
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({}), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const repo: SettingsReader = {
      getMany: vi.fn().mockRejectedValue(new Error('repo fail')),
      getAll: vi.fn(),
    };
    await handleTestLocalMarkdown(repo);
    expect(document.getElementById('status')!.textContent).toBe('ローカルMarkdown書き出しテストに失敗しました');
  });

  it('handles saveDashboardSettings throwing', async () => {
    resetDomForLocalMarkdown();
    mockedSaveDashboardSettings.mockRejectedValue(new Error('save err'));
    const repo: SettingsReader = { getMany: vi.fn(), getAll: vi.fn() };
    await handleTestLocalMarkdown(repo);
    expect(document.getElementById('status')!.className).toBe('status-message error');
  });

  it('disables button during test and re-enables even on success', async () => {
    resetDomForLocalMarkdown();
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({}), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } }, downloads: { download: vi.fn().mockResolvedValue('id') } });
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const repo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({ [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: true, [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: 'Yasumaro' }),
      getAll: vi.fn(),
    };
    const btn = document.getElementById('testLocalMarkdownBtnTop') as HTMLButtonElement;
    const p = handleTestLocalMarkdown(repo);
    expect(btn.disabled).toBe(true);
    await p;
    expect(btn.disabled).toBe(false);
  });

  it('verifies blob content type and revokes the url exactly once per export', async () => {
    resetDomForLocalMarkdown();
    const downloadMock = vi.fn().mockResolvedValue('id');
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({}), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } }, downloads: { download: downloadMock } });
    // spy Blob
    const origBlob = globalThis.Blob;
    let capturedBlob: Blob | undefined;
    (globalThis as any).Blob = class extends origBlob {
      constructor(parts: any, opts: any) {
        super(parts, opts);
        capturedBlob = this as any;
        // store for assertion
        (this as any)._parts = parts;
        (this as any)._opts = opts;
      }
    };
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    const repo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({ [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: true, [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: 'YPath' }),
      getAll: vi.fn(),
    };
    try {
      await handleTestLocalMarkdown(repo);
    } finally {
      globalThis.Blob = origBlob;
    }
    expect(capturedBlob).toBeDefined();
    expect((capturedBlob as any)._opts.type).toBe('text/markdown');
    expect(downloadMock).toHaveBeenCalledWith(expect.objectContaining({ url: 'blob:mock-url' }));
    // Revoked by the time the handler settles, and only for that one export.
    expect((globalThis.URL as any).revokeObjectURL).toHaveBeenCalledTimes(1);
    expect((globalThis.URL as any).revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('covers default repo parameter via settingsRepository seam', async () => {
    // This test ensures the default param branch is exercised by calling without arg
    // We need to mock the actual settingsRepository module default
    // Instead verify that passing undefined uses fallback repo (we already tested injected repo)
    // For coverage, call with injected repo that returns enabled true, ensures path works
    resetDomForLocalMarkdown();
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({}), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } }, downloads: { download: vi.fn().mockResolvedValue('id') } });
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    // We cannot easily test default repo without importing real storage, but we ensure branch 39 covered:
    // calling with explicit repo still counts; but we also call without param to hit default
    // The default repo will try chrome.storage.local.get -> returns {} => disabled path
    document.body.innerHTML = `<button id="testLocalMarkdownBtnTop"></button><div id="status"></div><div id="statusTop"></div><form id="panel-general"></form>`;
    // ensure save succeeds, then getMany from real repo returns {} (disabled)
    // We already have chrome mock; the real settingsRepository will read from mocked chrome.storage
    // So calling without arg should hit disabled error branch
    mockedGetMessage.mockReturnValue('' as any);
    // handleTestLocalMarkdown with no arg uses default settingsRepository
    // Need to ensure it doesn't throw for missing chrome storage keys
    await handleTestLocalMarkdown(); // default param
    expect(document.getElementById('status')!.className).toBe('status-message error');
  });
});

// ------------------------------------------------------------------
// Button pair guards (PBI 2026-10-05-11)
// ------------------------------------------------------------------
describe('button pair guards', () => {
  it('suppresses a second Save while the first is in flight and restores both buttons', async () => {
    document.body.innerHTML = `<button id="saveTop"></button><button id="save"></button><div id="status"></div><div id="statusTop"></div>`;
    let resolveSave: (v: any) => void;
    mockedSaveDashboardSettings.mockReturnValue(new Promise((res) => { resolveSave = res; }));
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({}), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });

    const first = handleSaveOnly();
    await waitForMock(() => expect(mockedSaveDashboardSettings).toHaveBeenCalledTimes(1));
    expect((document.getElementById('saveTop') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('save') as HTMLButtonElement).disabled).toBe(true);

    await handleSaveOnly();
    expect(mockedSaveDashboardSettings).toHaveBeenCalledTimes(1);

    resolveSave!({ success: true });
    await first;
    expect((document.getElementById('saveTop') as HTMLButtonElement).disabled).toBe(false);
    expect((document.getElementById('save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('suppresses a second Test Obsidian from the paired button and mirrors status', async () => {
    document.body.innerHTML = `<button id="testObsidianBtnTop"></button><button id="testObsidianBtn"></button><div id="status"></div><div id="statusTop"></div><input id="apiKey" value="k"/><input id="protocol" value="https"/><input id="port" value="27124"/>`;
    let releaseSend: (v: any) => void;
    const sendMessage = vi.fn().mockImplementation(() => new Promise((res) => { releaseSend = res; }));
    setupChrome({ runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });

    const first = handleTestObsidian();
    await waitForMock(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect((document.getElementById('testObsidianBtnTop') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('testObsidianBtn') as HTMLButtonElement).disabled).toBe(true);

    await handleTestObsidian();
    expect(sendMessage).toHaveBeenCalledTimes(1);

    releaseSend!({ obsidian: { success: true, message: 'OK' } });
    await first;
    expect((document.getElementById('testObsidianBtnTop') as HTMLButtonElement).disabled).toBe(false);
    expect((document.getElementById('testObsidianBtn') as HTMLButtonElement).disabled).toBe(false);
    expect(document.getElementById('status')!.className).toBe('status-message success');
  });

  it('suppresses a second Test Local Markdown while the first is in flight', async () => {
    document.body.innerHTML = `<button id="testLocalMarkdownBtnTop"></button><button id="testLocalMarkdownBtnBottom"></button><div id="status"></div><div id="statusTop"></div><form id="panel-general"></form>`;
    let resolveSave: (v: any) => void;
    mockedSaveDashboardSettings.mockReturnValue(new Promise((res) => { resolveSave = res; }));
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({}), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    const repo: SettingsReader = { getMany: vi.fn(), getAll: vi.fn() };

    const first = handleTestLocalMarkdown(repo);
    await waitForMock(() => expect(mockedSaveDashboardSettings).toHaveBeenCalledTimes(1));

    await handleTestLocalMarkdown(repo);
    expect(mockedSaveDashboardSettings).toHaveBeenCalledTimes(1);

    resolveSave!({ success: true });
    await first;
    expect((document.getElementById('testLocalMarkdownBtnTop') as HTMLButtonElement).disabled).toBe(false);
    expect((document.getElementById('testLocalMarkdownBtnBottom') as HTMLButtonElement).disabled).toBe(false);
  });

  it('writes Local Markdown results to #status and always mirrors to top', async () => {
    resetDomForLocalMarkdown();
    document.body.innerHTML += `<button id="testLocalMarkdownBtnBottom"></button>`;
    setupChrome({ runtime: { sendMessage: vi.fn().mockResolvedValue({}), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } }, downloads: { download: vi.fn().mockResolvedValue('id') } });
    mockedSaveDashboardSettings.mockResolvedValue({ success: true } as any);
    mockedGetMessage.mockImplementation((k: string) => k === 'testLocalMarkdownSuccess' ? 'SUCCESS_MSG' : k);
    const repo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({ [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: true, [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: 'Yasumaro' }),
      getAll: vi.fn(),
    };
    await handleTestLocalMarkdown(repo);
    expect(document.getElementById('status')!.textContent).toBe('SUCCESS_MSG');
    expect(document.getElementById('status')!.className).toBe('status-message success');
  });
});

// ------------------------------------------------------------------
// Certificate-guidance i18n parity (PBI 2026-09-26-09)
// ------------------------------------------------------------------
describe('certificate guidance i18n', () => {
  const LOCALE_ROOT = path.resolve(__dirname, '../../../../public/_locales');
  const readLocale = (locale: string): Record<string, { message: string }> =>
    JSON.parse(fs.readFileSync(path.join(LOCALE_ROOT, locale, 'messages.json'), 'utf-8'));

  it('defines the certificate guidance keys in both locales', () => {
    for (const locale of ['ja', 'en']) {
      const messages = readLocale(locale);
      expect(messages.acceptCertificate?.message).toBeTruthy();
      expect(messages.certGuideFirefox?.message).toBeTruthy();
    }
  });

  it('keeps the {url} substitution and both Firefox routes in either locale', () => {
    // Route (a): add a certificate exception for the host in a tab.
    // Route (b): import the CA in Firefox's own certificate manager.
    const routes = {
      ja: ['例外を追加する', 'インポートする', 'プライバシーとセキュリティ'],
      en: ['add a certificate exception', 'import the CA certificate', 'Privacy & Security'],
    } as const;

    for (const locale of ['ja', 'en'] as const) {
      const text = readLocale(locale).certGuideFirefox!.message;
      // The URL is substituted at render time, so a missing placeholder would
      // silently drop the endpoint the user is told to open.
      expect(text).toContain('{url}');
      for (const marker of routes[locale]) {
        expect(text).toContain(marker);
      }
    }
  });
});
