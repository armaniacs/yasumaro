// @vitest-environment wasm-quickjs-dom
/**
 * sessionLockConnectionGate.test.ts
 * PBI 2026-11-23-03: ロック中の保存抑止と AI テスト抑止。
 *
 * Outside-In の失敗試験: handleSaveOnly / handleTestAi がロック時に
 * 保存要求 (saveDashboardSettings) も TEST_AI 送信も行わず、
 * ロック中の案内を表示することを確認する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIsLocked = vi.hoisted(() => vi.fn());
const mockSaveDashboardSettings = vi.hoisted(() => vi.fn());
const mockSend = vi.hoisted(() => vi.fn());

vi.mock('../../../utils/storage/authGuard.js', () => ({
  isLocked: mockIsLocked,
}));

vi.mock('../../../utils/i18n.js', () => ({
  getMessage: vi.fn((key: string) => key),
  getMessageOr: vi.fn((_key: string, fallback: string) => fallback),
  getMessageWithSubstitutions: vi.fn((_key: string, _subs: unknown, fallback: string) => fallback),
}));

vi.mock('../../settingsPipeline.js', () => ({
  saveDashboardSettings: (...args: unknown[]) => mockSaveDashboardSettings(...args),
  saveErrorText: vi.fn(() => 'saveError'),
}));

vi.mock('../../../messaging/messageTransport.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../messaging/messageTransport.js')>();
  return {
    ...actual,
    messageTransport: { send: (...args: unknown[]) => mockSend(...args) },
  };
});

import { handleSaveOnly, handleTestAi } from '../connectionTests.js';

function buildDom(): void {
  document.body.innerHTML = `
    <section id="panel-general">
      <input type="password" id="apiKey" data-storage-key="obsidian_api_key" />
      <button id="saveTop">Save</button>
      <button id="save">Save</button>
      <button id="testAiBtnTop">Test AI</button>
      <button id="testAiBtn">Test AI</button>
      <div id="statusTop"></div>
      <div id="status"></div>
    </section>
  `;
}

beforeEach(() => {
  buildDom();
  vi.clearAllMocks();
  mockIsLocked.mockResolvedValue(false);
  mockSaveDashboardSettings.mockResolvedValue({ success: true });
  mockSend.mockResolvedValue({});
});

describe('handleSaveOnly (locked)', () => {
  it('保存要求を実行せずロック中の案内を表示する', async () => {
    mockIsLocked.mockResolvedValue(true);

    await handleSaveOnly();

    expect(mockSaveDashboardSettings).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(document.getElementById('status')!.textContent).not.toBe('');
    expect(document.getElementById('status')!.className).toContain('error');
  });
});

describe('handleTestAi (locked)', () => {
  it('復号処理に入る前にロック中の案内を表示し既存設定を変更しない', async () => {
    mockIsLocked.mockResolvedValue(true);

    await handleTestAi();

    // 保存 (復号の入口) も TEST_AI 送信も行わない
    expect(mockSaveDashboardSettings).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(document.getElementById('status')!.textContent).not.toBe('');
    expect(document.getElementById('status')!.className).toContain('error');
  });
});

describe('handleSaveOnly / handleTestAi (unlocked)', () => {
  it('未ロック時は従来通り保存要求を行う', async () => {
    mockIsLocked.mockResolvedValue(false);

    await handleSaveOnly();

    expect(mockSaveDashboardSettings).toHaveBeenCalled();
  });
});
