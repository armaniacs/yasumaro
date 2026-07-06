/**
 * encryptedBackupPanel.ts
 * ダッシュボードの「暗号化バックアップ」ボタン・モーダルの結線
 */

import { showPasswordAuthModal } from './masterPassword.js';
import {
  exportEncryptedBackup,
  importEncryptedBackup,
  isEncryptedBackupFile,
} from './encryptedBackupService.js';
import { errorMessage } from '../utils/errorUtils.js';

function getExportFilename(): string {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `yasumaro-backup-${y}${m}${d}-${hh}${mm}${ss}.encrypted.json`;
}

function setStatus(message: string, isError: boolean): void {
  const el = document.getElementById('encryptedBackupStatus');
  if (!el) return;
  el.textContent = message;
  el.className = isError ? 'status-message error' : 'status-message success';
}

function downloadJson(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function initEncryptedBackupPanel(): void {
  const exportBtn = document.getElementById('exportEncryptedBackupBtn');
  const importBtn = document.getElementById('importEncryptedBackupBtn');
  const importFileInput = document.getElementById('importEncryptedBackupFileInput') as HTMLInputElement | null;

  exportBtn?.addEventListener('click', () => {
    showPasswordAuthModal('export', async (password: string) => {
      try {
        const envelope = await exportEncryptedBackup(password);
        downloadJson(envelope, getExportFilename());
        setStatus('暗号化バックアップを作成しました', false);
      } catch (error) {
        setStatus(`バックアップ作成に失敗しました: ${errorMessage(error)}`, true);
      }
    });
  });

  importBtn?.addEventListener('click', () => {
    importFileInput?.click();
  });

  importFileInput?.addEventListener('change', async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (!isEncryptedBackupFile(parsed)) {
        setStatus('不正なバックアップファイルです', true);
        if (importFileInput) importFileInput.value = '';
        return;
      }

      showPasswordAuthModal('import', async (password: string) => {
        const result = await importEncryptedBackup(parsed, password);
        if (result.success) {
          setStatus('バックアップから復元しました', false);
          document.dispatchEvent(new CustomEvent('reload-general-settings'));
        } else {
          setStatus(`復元に失敗しました: ${result.error}`, true);
        }
      });
    } catch (error) {
      setStatus(`ファイルの読み込みに失敗しました: ${errorMessage(error)}`, true);
    }

    if (importFileInput) importFileInput.value = '';
  });
}
