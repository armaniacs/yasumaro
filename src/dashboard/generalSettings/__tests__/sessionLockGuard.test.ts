// @vitest-environment wasm-quickjs-dom
/**
 * sessionLockGuard.test.ts
 * PBI 2026-11-23-03: ロック中の初期設定画面の無効化表示。
 *
 * Outside-In の失敗試験: このファイルが先に存在し、実装モジュール
 * ../sessionLockGuard.js が無い状態で失敗することを確認してから実装する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/storage/authGuard.js', () => ({
  isLocked: vi.fn(),
}));

vi.mock('../../../utils/i18n.js', () => ({
  getMessage: vi.fn((key: string) => key),
  getMessageOr: vi.fn((_key: string, fallback: string) => fallback),
  getMessageWithSubstitutions: vi.fn((_key: string, _subs: unknown, fallback: string) => fallback),
}));

import { isLocked } from '../../../utils/storage/authGuard.js';
import {
  applySessionLockToPanel,
  refreshSessionLockState,
  SESSION_LOCK_NOTICE_ID,
  SESSION_LOCK_UNLOCK_BUTTON_ID,
} from '../sessionLockGuard.js';

function buildPanelDom(): void {
  document.body.innerHTML = `
    <button class="sidebar-nav-btn" data-panel="panel-privacy">Privacy</button>
    <section id="panel-general">
      <input type="password" id="apiKey" data-storage-key="obsidian_api_key" />
      <input type="password" id="geminiApiKey" data-storage-key="gemini_api_key" />
      <input type="text" id="geminiModel" data-storage-key="gemini_model" />
      <button id="saveTop">Save</button>
      <button id="save">Save</button>
      <button id="testAiBtnTop">Test AI</button>
      <button id="testAiBtn">Test AI</button>
      <div id="status"></div>
    </section>
  `;
}

beforeEach(() => {
  buildPanelDom();
  vi.clearAllMocks();
});

describe('applySessionLockToPanel (locked)', () => {
  it('APIキー欄と保存操作を無効化しアンロック導線を表示する', () => {
    const panel = document.getElementById('panel-general')!;

    applySessionLockToPanel(panel, true);

    expect((document.getElementById('apiKey') as HTMLInputElement).disabled).toBe(true);
    expect((document.getElementById('geminiApiKey') as HTMLInputElement).disabled).toBe(true);
    // APIキー以外の欄は触らない
    expect((document.getElementById('geminiModel') as HTMLInputElement).disabled).toBe(false);
    expect((document.getElementById('save') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('saveTop') as HTMLButtonElement).disabled).toBe(true);

    const notice = document.getElementById(SESSION_LOCK_NOTICE_ID);
    expect(notice).not.toBeNull();
    expect(notice!.hidden).toBe(false);
    expect(notice!.textContent).not.toBe('');
    expect(document.getElementById(SESSION_LOCK_UNLOCK_BUTTON_ID)).not.toBeNull();
  });

  it('アンロック導線のボタンは Privacy パネルへの移動を試みる', () => {
    const panel = document.getElementById('panel-general')!;
    applySessionLockToPanel(panel, true);

    let privacyClicked = false;
    document.querySelector('button[data-panel="panel-privacy"]')!.addEventListener('click', () => {
      privacyClicked = true;
    });

    (document.getElementById(SESSION_LOCK_UNLOCK_BUTTON_ID) as HTMLButtonElement).click();

    expect(privacyClicked).toBe(true);
  });
});

describe('applySessionLockToPanel (unlocked)', () => {
  it('無効化を解除し案内を隠す（未設定利用者の動作を変えない）', () => {
    const panel = document.getElementById('panel-general')!;

    applySessionLockToPanel(panel, true);
    applySessionLockToPanel(panel, false);

    expect((document.getElementById('apiKey') as HTMLInputElement).disabled).toBe(false);
    expect((document.getElementById('geminiApiKey') as HTMLInputElement).disabled).toBe(false);
    expect((document.getElementById('save') as HTMLButtonElement).disabled).toBe(false);
    expect((document.getElementById('saveTop') as HTMLButtonElement).disabled).toBe(false);
    const notice = document.getElementById(SESSION_LOCK_NOTICE_ID);
    expect(notice === null || notice.hidden).toBe(true);
  });
});

describe('refreshSessionLockState', () => {
  it('authGuard.isLocked の結果をパネルに反映して返す', async () => {
    vi.mocked(isLocked).mockResolvedValue(true);

    const locked = await refreshSessionLockState(document.getElementById('panel-general')!);

    expect(locked).toBe(true);
    expect((document.getElementById('apiKey') as HTMLInputElement).disabled).toBe(true);
  });

  it('未ロック時は無効化しない', async () => {
    vi.mocked(isLocked).mockResolvedValue(false);

    const locked = await refreshSessionLockState(document.getElementById('panel-general')!);

    expect(locked).toBe(false);
    expect((document.getElementById('apiKey') as HTMLInputElement).disabled).toBe(false);
  });
});
