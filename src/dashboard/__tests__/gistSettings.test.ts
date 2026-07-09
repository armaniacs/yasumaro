// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initGistSettings } from '../gistSettings.js';

const { mockGetSettings, mockSaveSettings, mockTestConnection } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockSaveSettings: vi.fn(),
  mockTestConnection: vi.fn(),
}));

vi.mock('../../utils/storage.js', () => ({
  getSettings: mockGetSettings,
  saveSettings: mockSaveSettings,
  StorageKeys: {
    GIST_ENABLED: 'gist_enabled',
    GITHUB_PAT: 'github_pat',
    GIST_ID: 'gist_id',
  },
}));

vi.mock('../../background/syncTargets/gistSyncTarget.js', () => ({
  GistSyncTarget: vi.fn(function () {
    return { testConnection: mockTestConnection };
  }),
}));

vi.mock('../../background/sqliteClient.js', () => ({
  SqliteClient: vi.fn(function () {
    return {};
  }),
}));

function setupDom(): {
  gistEnabled: HTMLInputElement;
  githubPat: HTMLInputElement;
  saveBtn: HTMLButtonElement;
  testBtn: HTMLButtonElement;
  statusEl: HTMLElement;
} {
  document.body.innerHTML = '';
  const gistEnabled = document.createElement('input');
  gistEnabled.type = 'checkbox';
  gistEnabled.id = 'gistEnabled';
  document.body.appendChild(gistEnabled);

  const githubPat = document.createElement('input');
  githubPat.type = 'text';
  githubPat.id = 'githubPat';
  document.body.appendChild(githubPat);

  const saveBtn = document.createElement('button');
  saveBtn.id = 'saveGistSettingsBtn';
  document.body.appendChild(saveBtn);

  const testBtn = document.createElement('button');
  testBtn.id = 'testGistConnectionBtn';
  document.body.appendChild(testBtn);

  const statusEl = document.createElement('div');
  statusEl.id = 'gistStatus';
  document.body.appendChild(statusEl);

  return { gistEnabled, githubPat, saveBtn, testBtn, statusEl };
}

describe('initGistSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  describe('element-missing guards', () => {
    it('handles missing gistEnabled element', async () => {
      mockGetSettings.mockResolvedValue({});
      document.body.innerHTML = '<input id="githubPat" /><button id="saveGistSettingsBtn" />';
      await expect(initGistSettings()).resolves.toBeUndefined();
    });

    it('handles missing githubPat element', async () => {
      mockGetSettings.mockResolvedValue({});
      document.body.innerHTML = '<input id="gistEnabled" /><button id="saveGistSettingsBtn" />';
      await expect(initGistSettings()).resolves.toBeUndefined();
    });

    it('handles missing save button', async () => {
      mockGetSettings.mockResolvedValue({});
      document.body.innerHTML = '<input id="gistEnabled" /><input id="githubPat" />';
      await expect(initGistSettings()).resolves.toBeUndefined();
    });

    it('handles missing test button', async () => {
      mockGetSettings.mockResolvedValue({});
      document.body.innerHTML = '<input id="gistEnabled" /><input id="githubPat" /><button id="saveGistSettingsBtn" />';
      await expect(initGistSettings()).resolves.toBeUndefined();
    });

    it('handles complete absence of all elements', async () => {
      mockGetSettings.mockResolvedValue({});
      document.body.innerHTML = '';
      await expect(initGistSettings()).resolves.toBeUndefined();
    });
  });

  describe('populating from settings', () => {
    it('sets checkbox to checked when GIST_ENABLED is true', async () => {
      const { gistEnabled } = setupDom();
      mockGetSettings.mockResolvedValue({ gist_enabled: true, github_pat: 'ghi789' });

      await initGistSettings();

      expect(gistEnabled.checked).toBe(true);
    });

    it('sets checkbox to unchecked when GIST_ENABLED is falsy', async () => {
      const { gistEnabled } = setupDom();
      mockGetSettings.mockResolvedValue({ gist_enabled: false, github_pat: '' });

      await initGistSettings();

      expect(gistEnabled.checked).toBe(false);
    });

    it('sets githubPat value from settings', async () => {
      const { githubPat } = setupDom();
      mockGetSettings.mockResolvedValue({ gist_enabled: true, github_pat: 'pat-123' });

      await initGistSettings();

      expect(githubPat.value).toBe('pat-123');
    });

    it('sets githubPat to empty string when not in settings', async () => {
      const { githubPat } = setupDom();
      mockGetSettings.mockResolvedValue({ gist_enabled: false });

      await initGistSettings();

      expect(githubPat.value).toBe('');
    });
  });

  describe('save handler', () => {
    it('calls saveSettings with correct values on click and shows success status', async () => {
      const { gistEnabled, githubPat, saveBtn, statusEl } = setupDom();
      mockGetSettings.mockResolvedValue({ gist_enabled: true, github_pat: 'pat-123' });
      mockSaveSettings.mockResolvedValue(undefined);

      await initGistSettings();

      saveBtn.click();
      await vi.waitFor(() => expect(statusEl.textContent).toBe('Gist settings saved'));

      expect(mockSaveSettings).toHaveBeenCalledWith({
        gist_enabled: true,
        github_pat: 'pat-123',
      });
      expect(statusEl.className).toBe('status-message success');
    });

    it('shows error status when saveSettings throws', async () => {
      const { saveBtn, statusEl } = setupDom();
      mockGetSettings.mockResolvedValue({ gist_enabled: true, github_pat: '' });
      mockSaveSettings.mockRejectedValue(new Error('quota exceeded'));

      await initGistSettings();

      saveBtn.click();
      await vi.waitFor(() =>
        expect(statusEl.textContent).toBe('Save failed: quota exceeded')
      );
      expect(statusEl.className).toBe('status-message error');
    });

    it('uses fallback values when elements are null', async () => {
      document.body.innerHTML = '<button id="saveGistSettingsBtn" />';
      mockGetSettings.mockResolvedValue({});
      mockSaveSettings.mockResolvedValue(undefined);

      await initGistSettings();

      document.getElementById('saveGistSettingsBtn')!.click();
      await vi.waitFor(() => {
        expect(mockSaveSettings).toHaveBeenCalledWith({
          gist_enabled: false,
          github_pat: '',
        });
      });
    });
  });

  describe('test connection handler', () => {
    it('shows success status when testConnection succeeds', async () => {
      const { testBtn, statusEl } = setupDom();
      mockGetSettings.mockResolvedValue({ gist_enabled: true, github_pat: 'pat' });
      mockTestConnection.mockResolvedValue({ success: true, message: 'Connected!' });

      await initGistSettings();

      testBtn.click();
      await vi.waitFor(() => expect(statusEl.textContent).toBe('Connected!'));
      expect(statusEl.className).toBe('status-message success');
    });

    it('shows error status when testConnection returns non-success', async () => {
      const { testBtn, statusEl } = setupDom();
      mockGetSettings.mockResolvedValue({ gist_enabled: true, github_pat: 'bad-pat' });
      mockTestConnection.mockResolvedValue({ success: false, message: 'Invalid PAT' });

      await initGistSettings();

      testBtn.click();
      await vi.waitFor(() => expect(statusEl.textContent).toBe('Invalid PAT'));
      expect(statusEl.className).toBe('status-message error');
    });

    it('shows error status when testConnection throws', async () => {
      const { testBtn, statusEl } = setupDom();
      mockGetSettings.mockResolvedValue({ gist_enabled: true, github_pat: 'pat' });
      mockTestConnection.mockRejectedValue(new Error('network error'));

      await initGistSettings();

      testBtn.click();
      await vi.waitFor(() =>
        expect(statusEl.textContent).toBe('Test failed: network error')
      );
      expect(statusEl.className).toBe('status-message error');
    });
  });
});
