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
import { DOWNLOAD_REVOKE_DELAY_MS } from '../exportLogsService.js';
import { useTimerClock } from '../../../testDir/waitPolicy.js';

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
    expect(exportEncryptedBackup).toHaveBeenCalledWith('my-password', expect.any(Function));
  });

  it('announces the backup filename before creation and downloads with the same name', async () => {
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, action) => {
      void action('my-password');
    });
    vi.mocked(exportEncryptedBackup).mockResolvedValue({
      version: 2, kdf: 'pbkdf2', hash: 'SHA-256', iterations: 600000, salt: 's', iv: 'i', data: 'd',
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:announced-backup');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const downloaded: string[] = [];
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      if (node instanceof HTMLAnchorElement) downloaded.push(node.download);
      return node;
    });
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

    initEncryptedBackupPanel();

    // Record every status write in order: the pre-creation announcement must
    // carry the same single-generated filename later used for the download.
    // getExportFilename is module-private so a call-count spy is impossible
    // without exporting it; equality of announced and downloaded names is the
    // behavioral proof that one value reaches both sinks.
    const statusEl = document.getElementById('encryptedBackupStatus')!;
    const statuses: string[] = [];
    let current: string | null = '';
    Object.defineProperty(statusEl, 'textContent', {
      configurable: true,
      get: () => current,
      set: (value: string | null) => {
        current = value;
        statuses.push(value ?? '');
      },
    });

    try {
      document.getElementById('exportEncryptedBackupBtn')!.dispatchEvent(new Event('click'));
      await vi.waitFor(() => {
        expect(statuses.some((s) => s.startsWith('Encrypted backup created:'))).toBe(true);
      });

      expect(downloaded).toHaveLength(1);
      expect(downloaded[0]).toMatch(/yasumaro-backup-.*\.encrypted\.json/);
      const announced = statuses.find((s) => s.startsWith('Creating '));
      expect(announced).toBe(`Creating ${downloaded[0]}...`);
      expect(statuses[statuses.length - 1]).toBe(`Encrypted backup created: ${downloaded[0]}`);
    } finally {
      vi.restoreAllMocks();
    }
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
    expect(status.textContent).toBe('Restored from backup');
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
    expect(status.textContent).toContain('2 invalid settings items were skipped');
  });

  it('keeps the error visible: the panel status does not auto-clear', async () => {
    useTimerClock();
    try {
      initEncryptedBackupPanel();

      const fileInput = document.getElementById('importEncryptedBackupFileInput') as HTMLInputElement;
      const file = new File(['x'], 'big.json', { type: 'application/json' });
      Object.defineProperty(file, 'size', { value: 60 * 1024 * 1024 });
      Object.defineProperty(fileInput, 'files', { value: [file] });
      fileInput.dispatchEvent(new Event('change'));
      await vi.advanceTimersByTimeAsync(0);

      const status = document.getElementById('encryptedBackupStatus')!;
      expect(status.className).toBe('status-message error');

      await vi.advanceTimersByTimeAsync(60000);
      expect(status.textContent).toBe('Backup file is too large');
      expect(status.className).toBe('status-message error');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a second export click while a run is in flight', async () => {
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, action) => {
      void action('my-password');
    });
    let resolveExport!: (value: unknown) => void;
    const pending = new Promise((resolve) => { resolveExport = resolve; });
    vi.mocked(exportEncryptedBackup).mockReturnValue(pending as never);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:double-run');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    initEncryptedBackupPanel();
    const exportBtn = document.getElementById('exportEncryptedBackupBtn')!;
    exportBtn.dispatchEvent(new Event('click'));
    exportBtn.dispatchEvent(new Event('click'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(exportEncryptedBackup).toHaveBeenCalledTimes(1);

    resolveExport({
      version: 2, kdf: 'pbkdf2', hash: 'SHA-256', iterations: 600000, salt: 's', iv: 'i', data: 'd',
    });
    await pending;
    await Promise.resolve();
    await Promise.resolve();
    vi.restoreAllMocks();
  });

  it('ignores a second import while a run is in flight and resets the flag afterwards', async () => {
    vi.mocked(isEncryptedBackupFile).mockReturnValue(true);
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, action) => {
      void action('correct-password');
    });
    let resolveImport!: (value: unknown) => void;
    const pending = new Promise((resolve) => { resolveImport = resolve; });
    vi.mocked(importEncryptedBackup).mockReturnValue(pending as never);

    initEncryptedBackupPanel();

    const fileInput = document.getElementById('importEncryptedBackupFileInput') as HTMLInputElement;
    const makeFile = () => new File(
      [JSON.stringify({ version: 2, kdf: 'pbkdf2', hash: 'SHA-256', iterations: 600000, salt: 's', iv: 'i', data: 'd' })],
      'backup.json',
      { type: 'application/json' },
    );
    Object.defineProperty(fileInput, 'files', { value: [makeFile()], configurable: true });
    fileInput.dispatchEvent(new Event('change'));
    Object.defineProperty(fileInput, 'files', { value: [makeFile()], configurable: true });
    fileInput.dispatchEvent(new Event('change'));

    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();

    expect(importEncryptedBackup).toHaveBeenCalledTimes(1);

    resolveImport({ success: true, skippedKeys: [] });
    await pending;
    await Promise.resolve();
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));

    Object.defineProperty(fileInput, 'files', { value: [makeFile()], configurable: true });
    fileInput.dispatchEvent(new Event('change'));

    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();

    expect(importEncryptedBackup).toHaveBeenCalledTimes(2);
  });

  describe('export download unification (PBI 2026-10-03-19)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it('downloads via the shared blob path: no sync revoke, revoke after the 60s bound', async () => {
      useTimerClock();
      const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:encrypted-backup');
      vi.spyOn(document.body, 'appendChild').mockImplementation((n) => n);
      vi.spyOn(document.body, 'removeChild').mockImplementation((n) => n);
      vi.mocked(showPasswordAuthModal).mockImplementation((_type, action) => {
        void action('my-password');
      });
      vi.mocked(exportEncryptedBackup).mockResolvedValue({
        version: 2, kdf: 'pbkdf2', hash: 'SHA-256', iterations: 600000, salt: 's', iv: 'i', data: 'd',
      });

      initEncryptedBackupPanel();
      document.getElementById('exportEncryptedBackupBtn')!.dispatchEvent(new Event('click'));
      await vi.advanceTimersByTimeAsync(0);

      // The envelope goes through exportLogsService.downloadBlob, which
      // revokes on a bounded delay — a synchronous revoke killed long
      // downloads before Chromium persisted the backup.
      expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(revokeSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(DOWNLOAD_REVOKE_DELAY_MS - 1);
      expect(revokeSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(revokeSpy).toHaveBeenCalledTimes(1);
      expect(revokeSpy).toHaveBeenCalledWith('blob:encrypted-backup');
    });
  });
});
