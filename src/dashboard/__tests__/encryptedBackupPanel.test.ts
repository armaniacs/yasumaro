// @vitest-environment jsdom
/**
 * encryptedBackupPanel.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../encryptedBackupService.js', () => ({
  exportEncryptedBackup: vi.fn(),
  importEncryptedBackup: vi.fn(),
  isEncryptedBackupFile: vi.fn(),
}));

vi.mock('../masterPassword.js', () => ({
  showPasswordAuthModal: vi.fn(),
}));

import { exportEncryptedBackup, importEncryptedBackup, isEncryptedBackupFile } from '../encryptedBackupService.js';
import { showPasswordAuthModal } from '../masterPassword.js';
import { initEncryptedBackupPanel } from '../encryptedBackupPanel.js';

function setDom() {
  document.body.innerHTML = `
    <button id="exportEncryptedBackupBtn"></button>
    <button id="importEncryptedBackupBtn"></button>
    <input type="file" id="importEncryptedBackupFileInput" />
    <div id="encryptedBackupStatus"></div>
  `;
}

beforeEach(() => {
  vi.clearAllMocks();
  setDom();
});

describe('initEncryptedBackupPanel', () => {
  it('triggers password modal and downloads on export click', async () => {
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, action) => {
      void action('my-password');
    });
    vi.mocked(exportEncryptedBackup).mockResolvedValue({
      version: 2, kdf: 'pbkdf2', hash: 'SHA-256', iterations: 600000, salt: 's', iv: 'i', data: 'd',
    });

    initEncryptedBackupPanel();
    document.getElementById('exportEncryptedBackupBtn')!.dispatchEvent(new Event('click'));
    await Promise.resolve();
    await Promise.resolve();

    expect(showPasswordAuthModal).toHaveBeenCalledWith('export', expect.any(Function));
    expect(exportEncryptedBackup).toHaveBeenCalledWith('my-password');
  });

  it('shows an error status when import fails due to wrong password', async () => {
    vi.mocked(isEncryptedBackupFile).mockReturnValue(true);
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, action) => {
      void action('wrong-password');
    });
    vi.mocked(importEncryptedBackup).mockResolvedValue({ success: false, error: 'Decryption failed' });

    initEncryptedBackupPanel();

    const fileInput = document.getElementById('importEncryptedBackupFileInput') as HTMLInputElement;
    const file = new File([JSON.stringify({ version: 2, kdf: 'pbkdf2', hash: 'SHA-256', iterations: 600000, salt: 's', iv: 'i', data: 'd' })], 'backup.json', { type: 'application/json' });
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fileInput.dispatchEvent(new Event('change'));

    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();

    const status = document.getElementById('encryptedBackupStatus')!;
    expect(status.textContent).toContain('Decryption failed');
  });

  it('shows a plain success status when no settings were skipped', async () => {
    vi.mocked(isEncryptedBackupFile).mockReturnValue(true);
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, action) => {
      void action('correct-password');
    });
    vi.mocked(importEncryptedBackup).mockResolvedValue({ success: true, skippedKeys: [] });

    initEncryptedBackupPanel();

    const fileInput = document.getElementById('importEncryptedBackupFileInput') as HTMLInputElement;
    const file = new File([JSON.stringify({ version: 2, kdf: 'pbkdf2', hash: 'SHA-256', iterations: 600000, salt: 's', iv: 'i', data: 'd' })], 'backup.json', { type: 'application/json' });
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fileInput.dispatchEvent(new Event('change'));

    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();

    const status = document.getElementById('encryptedBackupStatus')!;
    expect(status.textContent).toBe('バックアップから復元しました');
  });

  it('shows a skipped-count status when some settings were skipped during restore', async () => {
    vi.mocked(isEncryptedBackupFile).mockReturnValue(true);
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, action) => {
      void action('correct-password');
    });
    vi.mocked(importEncryptedBackup).mockResolvedValue({
      success: true,
      skippedKeys: ['obsidian_api_key', 'unknown_key'],
    });

    initEncryptedBackupPanel();

    const fileInput = document.getElementById('importEncryptedBackupFileInput') as HTMLInputElement;
    const file = new File([JSON.stringify({ version: 2, kdf: 'pbkdf2', hash: 'SHA-256', iterations: 600000, salt: 's', iv: 'i', data: 'd' })], 'backup.json', { type: 'application/json' });
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fileInput.dispatchEvent(new Event('change'));

    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();

    const status = document.getElementById('encryptedBackupStatus')!;
    expect(status.textContent).toContain('2件の設定項目は無効なためスキップされました');
  });
});
