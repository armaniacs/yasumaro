// @vitest-environment jsdom
/**
 * encryptedBackupPanel-backupCap.test.ts (PBI 2026-11-06-02)
 *
 * An over-cap envelope must be reported as too large BEFORE any decryption
 * (password prompt) starts; a within-cap envelope proceeds to the prompt.
 * The limits registry is shrunk via module mock so the test needs no
 * multi-megabyte allocations to reach the branches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../encryptedBackupService.js', () => ({
  exportEncryptedBackup: vi.fn(),
  importEncryptedBackup: vi.fn(),
  isEncryptedBackupFile: vi.fn(),
}));

vi.mock('../masterPassword.js', () => ({
  showPasswordAuthModal: vi.fn(),
  setPasswordAuthProgress: vi.fn(),
}));

vi.mock('../../utils/limits.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/limits.js')>();
  return {
    ...actual,
    MAX_BACKUP_FILE_BYTES: 5_000,
    MAX_BACKUP_ENVELOPE_BASE64_LENGTH: 10,
  };
});

import { importEncryptedBackup, isEncryptedBackupFile } from '../encryptedBackupService.js';
import { showPasswordAuthModal } from '../masterPassword.js';
import { initEncryptedBackupPanel } from '../encryptedBackupPanel.js';

function setDom(): void {
  document.body.innerHTML = `
    <button id="exportEncryptedBackupBtn"></button>
    <button id="importEncryptedBackupBtn"></button>
    <input type="file" id="importEncryptedBackupFileInput" />
    <div id="encryptedBackupStatus"></div>
    <div id="passwordAuthProgress" role="status" aria-live="polite"></div>
  `;
}

function selectFile(content: string): void {
  const fileInput = document.getElementById('importEncryptedBackupFileInput') as HTMLInputElement;
  const file = new File([content], 'backup.json', { type: 'application/json' });
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
  fileInput.dispatchEvent(new Event('change'));
}

function envelopeJson(dataChars: string): string {
  return JSON.stringify({
    version: 2,
    kdf: 'pbkdf2',
    hash: 'SHA-256',
    iterations: 600000,
    salt: 's',
    iv: 'i',
    data: dataChars,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setDom();
});

describe('encryptedBackupPanel backup cap (PBI 2026-11-06-02)', () => {
  it('reports an over-cap envelope as too large before asking for a password', async () => {
    vi.mocked(isEncryptedBackupFile).mockReturnValue(true);

    initEncryptedBackupPanel();
    selectFile(envelopeJson('x'.repeat(11)));

    await vi.waitFor(() => {
      expect(document.getElementById('encryptedBackupStatus')!.textContent).toBe(
        'Backup file is too large',
      );
    });
    expect(showPasswordAuthModal).not.toHaveBeenCalled();
    expect(importEncryptedBackup).not.toHaveBeenCalled();
  });

  it('proceeds to the password prompt when the envelope is within the cap', async () => {
    vi.mocked(isEncryptedBackupFile).mockReturnValue(true);
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, action) => {
      void action('correct-password').catch(() => {});
    });
    vi.mocked(importEncryptedBackup).mockResolvedValue({ success: true, skippedKeys: [] });

    initEncryptedBackupPanel();
    selectFile(envelopeJson('x'.repeat(10)));

    await vi.waitFor(() => {
      expect(showPasswordAuthModal).toHaveBeenCalledWith('import', expect.any(Function));
    });
  });

  it('treats data exactly at the cap as within bounds, not over', async () => {
    vi.mocked(isEncryptedBackupFile).mockReturnValue(true);
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, action) => {
      void action('correct-password').catch(() => {});
    });
    vi.mocked(importEncryptedBackup).mockResolvedValue({ success: true, skippedKeys: [] });

    initEncryptedBackupPanel();
    selectFile(envelopeJson('y'.repeat(10)));

    await vi.waitFor(() => {
      expect(showPasswordAuthModal).toHaveBeenCalled();
    });
    expect(document.getElementById('encryptedBackupStatus')!.textContent).not.toBe(
      'Backup file is too large',
    );
  });
});
