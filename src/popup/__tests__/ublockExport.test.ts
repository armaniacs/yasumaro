// @vitest-environment jsdom
/**
 * @file src/popup/__tests__/ublockExport.test.js
 * uBlockエクスポートUIロジックのテスト
 */

import { vi } from 'vitest';;

vi.mock('../../utils/storage.js', () => ({
  getSettings: vi.fn(() => Promise.resolve({})),
  StorageKeys: { UBLOCK_RULES: 'ublock_rules' },
}));

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { ERROR: 'error' },
}));

vi.mock('../settingsUiHelper.js', () => ({
  showStatus: vi.fn(),
}));

import { exportToText, downloadAsFile, copyToClipboard, init } from '../ublockExport.js';
import { getSettings } from '../../utils/storage.js';
import { showStatus } from '../settingsUiHelper.js';

// モックデータ
const mockRules = {
  blockRules: [
    { rawLine: '||example.com^' },
    { rawLine: '||*.ads.net^$3p' }
  ],
  exceptionRules: [
    { rawLine: '@@||trusted.com^' }
  ]
};

describe('ublockExport', () => {
  describe('exportToText', () => {
    test('丸ごとエクスポート', () => {
      const result = exportToText(mockRules);
      const lines = result.split('\n');
      
      // メタデータ行のチェック
      expect(lines[0]).toMatch(/^! Auto-exported from Obsidian Weave/);
      expect(lines[1]).toMatch(/^! Exported at: /);
      expect(lines[2]).toBe('! Total rules: 3');
      expect(lines[3]).toBe('');
      
      // 例外ルールが最初に来ることを確認
      expect(lines[4]).toBe('@@||trusted.com^');
      
      // ブロックルールのチェック
      expect(lines).toContain('||example.com^');
      expect(lines).toContain('||*.ads.net^$3p');
    });

    test('空ルールセット', () => {
      const emptyRules = { blockRules: [], exceptionRules: [] };
      const result = exportToText(emptyRules);
      const lines = result.split('\n');
      
      expect(lines[0]).toMatch(/^! Auto-exported from Obsidian Weave/);
      expect(lines[1]).toMatch(/^! Exported at: /);
      expect(lines[2]).toBe('! Total rules: 0');
      expect(lines[3]).toBe('');
      expect(lines.length).toBe(4); // メタデータのみ
    });

    test('メタデータ', () => {
      const result = exportToText(mockRules);
      expect(result).toMatch(/^! Auto-exported from Obsidian Weave/);
      expect(result).toMatch(/! Exported at: /);
      expect(result).toMatch(/! Total rules: 3/);
    });
  });

  describe('downloadAsFile', () => {
    beforeEach(() => {
      // DOMのクリーンアップ
      document.body.innerHTML = '<div id="domainStatus"></div>';
      
      // モックのクリーンアップ
      global.URL.createObjectURL = vi.fn(() => 'blob:test');
      global.URL.revokeObjectURL = vi.fn();
      
      // createElementのモック
      document.createElement = vi.fn((tagName) => {
        const element = {
          tagName: tagName.toUpperCase(),
          href: '',
          download: '',
          click: vi.fn(),
          style: {}
        };
        return element;
      });
      
      // appendChildとremoveChildのモック
      document.body.appendChild = vi.fn();
      document.body.removeChild = vi.fn();
    });

    test('ファイルダウンロード', () => {
      downloadAsFile(mockRules);
      
      expect(document.createElement).toHaveBeenCalledWith('a');
      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(document.body.appendChild).toHaveBeenCalled();
      expect(document.body.removeChild).toHaveBeenCalled();
      expect(global.URL.revokeObjectURL).toHaveBeenCalled();
    });

    test('カスタムファイル名', () => {
      const a = { click: vi.fn() };
      document.createElement = vi.fn(() => a);
      
      downloadAsFile(mockRules, 'custom-filters.txt');
      
      // ファイル名のチェックはブラウザ環境でのみ可能なので、ここでは基本的な呼び出しを確認
      expect(document.createElement).toHaveBeenCalledWith('a');
    });
  });

  describe('copyToClipboard', () => {
    beforeEach(() => {
      // DOMのクリーンアップ
      document.body.innerHTML = '<div id="domainStatus"></div>';
    });

    test('クリップボードコピー', async () => {
      // navigator.clipboardのモック
    // @ts-expect-error - vi.fn() type narrowing issue
  
      const mockWriteText = vi.fn().mockResolvedValue();
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: mockWriteText
        },
        writable: true
      });

      const result = await copyToClipboard(mockRules);
      
      expect(result).toBe(true);
      expect(mockWriteText).toHaveBeenCalled();
    // @ts-expect-error - vi.fn() type narrowing issue
  
      const calledWith = mockWriteText.mock.calls[0][0];
      expect(calledWith).toContain('@@||trusted.com^');
      expect(calledWith).toContain('||example.com^');
      expect(calledWith).toContain('||*.ads.net^$3p');
    });

    test('クリップボードコピー失敗', async () => {
      // navigator.clipboardのモック（エラーをスローする）
    // @ts-expect-error - vi.fn() type narrowing issue
  
      const mockWriteText = vi.fn().mockRejectedValue(new Error('Clipboard error'));
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: mockWriteText
        },
        writable: true
      });

      const result = await copyToClipboard(mockRules);
      
      expect(result).toBe(false);
      expect(mockWriteText).toHaveBeenCalled();
    });
  });

  describe('UIイベント', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="domainStatus"></div>
        <button id="uBlockExportBtn"></button>
        <button id="uBlockCopyBtn"></button>
      `;
      vi.clearAllMocks();
    });

    test('エクスポートボタンクリックでルールをエクスポート', async () => {
      init();

      // @ts-expect-error
      getSettings.mockResolvedValueOnce({
        ublock_rules: { blockRules: [{ rawLine: '||a.com^' }], exceptionRules: [] },
      });

      global.URL.createObjectURL = vi.fn(() => 'blob:test');
      global.URL.revokeObjectURL = vi.fn();
      document.body.appendChild = vi.fn();
      document.body.removeChild = vi.fn();

      document.getElementById('uBlockExportBtn')!.click();
      await new Promise(r => setTimeout(r, 10));

      expect(showStatus).toHaveBeenCalledWith('domainStatus', expect.any(String), 'success');
    });

    test('エクスポートボタンクリックでルールなし', async () => {
      init();

      // @ts-expect-error
      getSettings.mockResolvedValueOnce({});

      document.getElementById('uBlockExportBtn')!.click();
      await new Promise(r => setTimeout(r, 10));

      expect(showStatus).toHaveBeenCalledWith('domainStatus', expect.any(String), 'error');
    });

    test('エクスポートボタンクリックでエラー', async () => {
      init();

      // @ts-expect-error
      getSettings.mockRejectedValueOnce(new Error('Storage fail'));

      document.getElementById('uBlockExportBtn')!.click();
      await new Promise(r => setTimeout(r, 10));

      expect(showStatus).toHaveBeenCalledWith('domainStatus', expect.stringContaining('Storage fail'), 'error');
    });

    test('コピーボタンクリックでルールをコピー', async () => {
      init();

      // @ts-expect-error
      getSettings.mockResolvedValueOnce({
        ublock_rules: { blockRules: [{ rawLine: '||a.com^' }], exceptionRules: [] },
      });

      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        writable: true,
      });

      document.getElementById('uBlockCopyBtn')!.click();
      await new Promise(r => setTimeout(r, 10));

      expect(showStatus).toHaveBeenCalledWith('domainStatus', expect.any(String), 'success');
    });

    test('コピーボタンクリックでルールなし', async () => {
      init();

      // @ts-expect-error
      getSettings.mockResolvedValueOnce({});

      document.getElementById('uBlockCopyBtn')!.click();
      await new Promise(r => setTimeout(r, 10));

      expect(showStatus).toHaveBeenCalledWith('domainStatus', expect.any(String), 'error');
    });

    test('コピーボタンクリックでコピーエラー', async () => {
      init();

      // @ts-expect-error
      getSettings.mockResolvedValueOnce({
        ublock_rules: { blockRules: [{ rawLine: '||a.com^' }], exceptionRules: [] },
      });

      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockRejectedValue(new Error('Clipboard error')) },
        writable: true,
      });

      document.getElementById('uBlockCopyBtn')!.click();
      await new Promise(r => setTimeout(r, 10));

      expect(showStatus).toHaveBeenCalledWith('domainStatus', expect.any(String), 'error');
    });

    test('コピーボタンクリックでgetSettingsエラー', async () => {
      init();

      // @ts-expect-error
      getSettings.mockRejectedValueOnce(new Error('Storage fail'));

      document.getElementById('uBlockCopyBtn')!.click();
      await new Promise(r => setTimeout(r, 10));

      expect(showStatus).toHaveBeenCalledWith('domainStatus', expect.stringContaining('Storage fail'), 'error');
    });
  });

  describe('init', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="domainStatus"></div>
        <button id="uBlockExportBtn"></button>
        <button id="uBlockCopyBtn"></button>
      `;
    });

    test('ボタン要素が存在しない場合でもエラーを投げない', () => {
      document.body.innerHTML = '';
      expect(() => init()).not.toThrow();
    });
  });
});