// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { initGistSettings, type GistConnectionTester } from '../gistSettings.js';
import { StorageKeys } from '../../utils/storage/types.js';
import type { SettingsReader } from '../../utils/storage/SettingsRepository.js';

function emptyRepo(): SettingsReader {
  return {
    getAll: vi.fn().mockResolvedValue({}),
    getMany: vi.fn(),
  };
}

describe('gistSettings — SettingsRepository seam', () => {
  it('initGistSettings reads from injected repo', async () => {
    document.body.innerHTML = '<input id="gistEnabled" type="checkbox" /><input id="githubPat" />';
    const repo: SettingsReader = {
      getAll: vi.fn().mockResolvedValue({
        [StorageKeys.GIST_ENABLED]: true,
        [StorageKeys.GITHUB_PAT]: 'secret',
      }),
      getMany: vi.fn(),
    };

    await initGistSettings(repo);

    expect(repo.getAll).toHaveBeenCalledTimes(1);
    expect((document.getElementById('gistEnabled') as HTMLInputElement).checked).toBe(true);
  });
});

describe('gistSettings — connection tester seam', () => {
  function testDom(): { testBtn: HTMLButtonElement; statusEl: HTMLElement } {
    document.body.innerHTML = '<button id="testGistConnectionBtn" /><div id="gistStatus" />';
    return {
      testBtn: document.getElementById('testGistConnectionBtn') as HTMLButtonElement,
      statusEl: document.getElementById('gistStatus') as HTMLElement,
    };
  }

  it('runs the injected tester without touching any background module', async () => {
    const { testBtn, statusEl } = testDom();
    const tester: GistConnectionTester = {
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'injected ok' }),
    };

    await initGistSettings(emptyRepo(), () => tester);
    testBtn.click();
    await vi.waitFor(() => expect(statusEl.textContent).toBe('injected ok'));

    expect(tester.testConnection).toHaveBeenCalledTimes(1);
    expect(statusEl.className).toBe('status-message success');
  });

  it('surfaces a rejected factory through the test-failure status', async () => {
    const { testBtn, statusEl } = testDom();

    await initGistSettings(emptyRepo(), () => {
      throw new Error('no tester');
    });
    testBtn.click();
    await vi.waitFor(() => expect(statusEl.textContent).toBe('Test failed: no tester'));

    expect(statusEl.className).toBe('status-message error');
  });

  it('accepts an async factory that resolves the tester lazily', async () => {
    const { testBtn, statusEl } = testDom();

    await initGistSettings(emptyRepo(), async () => ({
      testConnection: async () => ({ success: false, message: 'Invalid PAT' }),
    }));
    testBtn.click();
    await vi.waitFor(() => expect(statusEl.textContent).toBe('Invalid PAT'));

    expect(statusEl.className).toBe('status-message error');
  });
});
