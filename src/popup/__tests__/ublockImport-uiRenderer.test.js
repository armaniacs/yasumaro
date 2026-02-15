/**
 * ublockImport-uiRenderer.test.js
 * uBlock Import - UIRendererモジュールのユニットテスト
 * 注意: jsdom環境で実際のDOM操作をテストします
 */

import {
  renderSourceList,
  updatePreviewUI,
  hidePreview,
  clearInput,
  exportSimpleFormat,
  buildUblockFormat
} from '../ublockImport/uiRenderer.ts';

describe('ublockImport - UIRenderer Module', () => {
  // ============================================================================
  // renderSourceList
  // ============================================================================

  describe('renderSourceList', () => {
    beforeEach(() => {
      // テストの前にDOM要素をセットアップ
      document.body.innerHTML = `
        <div id="uBlockSourceItems"></div>
        <div id="uBlockNoSources"></div>
      `;
    });

    afterEach(() => {
      // テストの後にDOMをクリーンアップ
      document.body.innerHTML = '';
    });

    test('空ソースリストで「ソースなし」メッセージを表示', () => {
      const sources = [];
      const deleteCallback = jest.fn();
      const reloadCallback = jest.fn();

      renderSourceList(sources, deleteCallback, reloadCallback);

      const noSourcesMsg = document.getElementById('uBlockNoSources');
      expect(noSourcesMsg.style.display).toBe('block');

      const container = document.getElementById('uBlockSourceItems');
      expect(container.innerHTML).toBe('');
    });

    test('ソースリストを正しく描画', () => {
      const sources = [
        { url: 'https://example.com/filters.txt', importedAt: Date.now(), ruleCount: 10, blockDomains: ['example.com'], exceptionDomains: [] }
      ];
      const deleteCallback = jest.fn();
      const reloadCallback = jest.fn();

      renderSourceList(sources, deleteCallback, reloadCallback);

      const noSourcesMsg = document.getElementById('uBlockNoSources');
      expect(noSourcesMsg.style.display).toBe('none');

      const container = document.getElementById('uBlockSourceItems');
      const items = container.querySelectorAll('.source-item');
      expect(items).toHaveLength(1);
    });

    test('手動入力ソースで「再読込」ボタンは表示しない', () => {
      const sources = [
        { url: 'manual', importedAt: Date.now(), ruleCount: 5, blockDomains: ['test.com'], exceptionDomains: [] }
      ];
      const deleteCallback = jest.fn();
      const reloadCallback = jest.fn();

      renderSourceList(sources, deleteCallback, reloadCallback);

      const container = document.getElementById('uBlockSourceItems');
      const reloadBtns = container.querySelectorAll('.reload-btn');
      expect(reloadBtns).toHaveLength(0);
    });

    test('URLソースで「再読込」ボタンを表示', () => {
      const sources = [
        { url: 'https://example.com/filters.txt', importedAt: Date.now(), ruleCount: 5, blockDomains: ['test.com'], exceptionDomains: [] }
      ];
      const deleteCallback = jest.fn();
      const reloadCallback = jest.fn();

      renderSourceList(sources, deleteCallback, reloadCallback);

      const container = document.getElementById('uBlockSourceItems');
      const reloadBtns = container.querySelectorAll('.reload-btn');
      expect(reloadBtns).toHaveLength(1);
    });

    test('XSS対策: 悪意あるURLがエスケープされる', () => {
      const sources = [
        { url: '<script>alert("XSS")</script>', importedAt: Date.now(), ruleCount: 1, blockDomains: ['test.com'], exceptionDomains: [] }
      ];
      const deleteCallback = jest.fn();
      const reloadCallback = jest.fn();

      renderSourceList(sources, deleteCallback, reloadCallback);

      const container = document.getElementById('uBlockSourceItems');
      const urlElement = container.querySelector('.source-url');
      expect(urlElement.textContent).toBe('<script>alert("XSS")</script>');
      expect(urlElement.innerHTML).not.toContain('<script>');
    });
  });

  // ============================================================================
  // updatePreviewUI
  // ============================================================================

  describe('updatePreviewUI', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="uBlockPreview"></div>
        <div id="uBlockRuleCount"></div>
        <div id="uBlockExceptionCount"></div>
        <div id="uBlockErrorCount"></div>
        <div id="uBlockErrorDetails"></div>
      `;
    });

    afterEach(() => {
      document.body.innerHTML = '';
    });

    test('エラーメッセージを表示', () => {
      updatePreviewUI('Test error message');

      expect(document.getElementById('uBlockRuleCount').textContent).toBe('0');
      expect(document.getElementById('uBlockExceptionCount').textContent).toBe('0');
      expect(document.getElementById('uBlockErrorCount').textContent).toBe('1');
      expect(document.getElementById('uBlockErrorDetails').textContent).toBe('Test error message');
      expect(document.getElementById('uBlockPreview').style.display).toBe('block');
    });

    test('プレビュー結果を表示', () => {
      const result = {
        blockCount: 10,
        exceptionCount: 5,
        errorCount: 0,
        errorDetails: []
      };

      updatePreviewUI(result);

      expect(document.getElementById('uBlockRuleCount').textContent).toBe('10');
      expect(document.getElementById('uBlockExceptionCount').textContent).toBe('5');
      expect(document.getElementById('uBlockErrorCount').textContent).toBe('0');
    });

    test('エラー詳細をフォーマットして表示', () => {
      const result = {
        blockCount: 5,
        exceptionCount: 2,
        errorCount: 2,
        errorDetails: [
          { lineNumber: 1, message: 'Invalid format' },
          { lineNumber: 5, message: 'Missing domain' }
        ]
      };

      updatePreviewUI(result);

      expect(document.getElementById('uBlockErrorCount').textContent).toBe('2');
      const errorText = document.getElementById('uBlockErrorDetails').textContent;
      expect(errorText).toContain('1: Invalid format');
      expect(errorText).toContain('5: Missing domain');
    });

    test('文字列配列のエラー詳細も処理', () => {
      const result = {
        blockCount: 3,
        exceptionCount: 1,
        errorCount: 1,
        errorDetails: ['Error message 1']
      };

      updatePreviewUI(result);

      expect(document.getElementById('uBlockErrorDetails').textContent).toBe('Error message 1');
    });
  });

  // ============================================================================
  // hidePreview
  // ============================================================================

  describe('hidePreview', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="uBlockPreview" style="display: block;"></div>
      `;
    });

    afterEach(() => {
      document.body.innerHTML = '';
    });

    test('プレビューを非表示にする', () => {
      hidePreview();

      const preview = document.getElementById('uBlockPreview');
      expect(preview.style.display).toBe('none');
    });

    test('プレビュー要素が存在しない場合はエラーを投げない', () => {
      document.body.innerHTML = '';

      expect(() => hidePreview()).not.toThrow();
    });
  });

  // ============================================================================
  // clearInput
  // ============================================================================

  describe('clearInput', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <textarea id="uBlockFilterInput">some content</textarea>
      `;
    });

    afterEach(() => {
      document.body.innerHTML = '';
    });

    test('入力エリアをクリアする', () => {
      clearInput();

      const textarea = document.getElementById('uBlockFilterInput');
      expect(textarea.value).toBe('');
    });

    test('テキストエリアが存在しない場合はエラーを投げない', () => {
      document.body.innerHTML = '';

      expect(() => clearInput()).not.toThrow();
    });
  });

  // ============================================================================
  // exportSimpleFormat
  // ============================================================================

  describe('exportSimpleFormat', () => {
    test('単一ソースをエクスポート', () => {
      const sources = [
        { url: 'https://example.com/filters.txt', importedAt: Date.now(), ruleCount: 2, blockDomains: ['example.com', 'test.com'], exceptionDomains: [] }
      ];

      const result = exportSimpleFormat(sources);

      const lines = result.split('\n');
      expect(lines).toContain('example.com');
      expect(lines).toContain('test.com');
      expect(lines).toHaveLength(2);
    });

    test('複数ソースをエクスポート（重複除去）', () => {
      const sources = [
        { url: 'https://example.com/filters1.txt', importedAt: Date.now(), blockDomains: ['example.com', 'test.com'], exceptionDomains: [] },
        { url: 'https://example.com/filters2.txt', importedAt: Date.now(), blockDomains: ['example.com', 'another.com'], exceptionDomains: [] }
      ];

      const result = exportSimpleFormat(sources);

      const lines = result.split('\n');
      expect(lines).toContain('example.com');
      expect(lines).toContain('test.com');
      expect(lines).toContain('another.com');
      // 重複除去されていることを確認
      const exampleCount = lines.filter(l => l === 'example.com').length;
      expect(exampleCount).toBe(1);
    });

    test('空ソースは空文字列を返す', () => {
      const sources = [];
      const result = exportSimpleFormat(sources);

      expect(result).toBe('');
    });

    test('例外ドメインはエクスポートされない', () => {
      const sources = [
        { url: 'manual', importedAt: Date.now(), blockDomains: ['block.com'], exceptionDomains: ['allow.com'] }
      ];

      const result = exportSimpleFormat(sources);

      expect(result).toContain('block.com');
      expect(result).not.toContain('allow.com');
    });

    test('blockDomainsが未定義のソースを安全に処理', () => {
      const sources = [
        { url: 'https://example.com/filters.txt', importedAt: Date.now(), ruleCount: 0, exceptionDomains: [] },
        { url: 'manual', importedAt: Date.now(), blockDomains: ['domain.com'], exceptionDomains: [] }
      ];

      const result = exportSimpleFormat(sources);

      expect(result).toContain('domain.com');
    });
  });

  // ============================================================================
  // buildUblockFormat
  // ============================================================================

  describe('buildUblockFormat', () => {
    test('基本形式でブロックルールを生成', () => {
      const sources = [
        { url: 'manual', importedAt: Date.now(), blockDomains: ['example.com', 'test.com'], exceptionDomains: [] }
      ];

      const result = buildUblockFormat(sources);

      expect(result).toContain('! Generated by Obsidian Smart History');
      expect(result).toContain('||example.com^');
      expect(result).toContain('||test.com^');
    });

    test('例外ルールも含める', () => {
      const sources = [
        { url: 'manual', importedAt: Date.now(), blockDomains: ['block.com'], exceptionDomains: ['allow.com'] }
      ];

      const result = buildUblockFormat(sources);

      expect(result).toContain('||block.com^');
      expect(result).toContain('@@||allow.com^');
    });

    test('複数ソースをマージ', () => {
      const sources = [
        { url: 'https://example.com/filters1.txt', importedAt: Date.now(), blockDomains: ['domain1.com'], exceptionDomains: [] },
        { url: 'https://example.com/filters2.txt', importedAt: Date.now(), blockDomains: ['domain2.com'], exceptionDomains: ['trusted.com'] }
      ];

      const result = buildUblockFormat(sources);

      expect(result).toContain('||domain1.com^');
      expect(result).toContain('||domain2.com^');
      expect(result).toContain('@@||trusted.com^');
    });

    test('空ソースはヘッダーのみを返す', () => {
      const sources = [];
      const result = buildUblockFormat(sources);

      expect(result).toContain('! Generated by Obsidian Smart History');
      expect(result.split('\n')).toHaveLength(2); // ヘッダーと空行
    });

    test('正しい改行区切り形式', () => {
      const sources = [
        { url: 'manual', importedAt: Date.now(), blockDomains: ['domain1.com', 'domain2.com'], exceptionDomains: ['allow.com'] }
      ];

      const result = buildUblockFormat(sources);
      const lines = result.split('\n');

      expect(lines[0]).toBe('! Generated by Obsidian Smart History');
      expect(lines[1]).toBe('');
      expect(lines).toContain('||domain1.com^');
      expect(lines).toContain('||domain2.com^');
      expect(lines).toContain('@@||allow.com^');
    });

    test('blockDomains/exceptionDomainsが未定義のソースを安全に処理', () => {
      const sources = [
        { url: 'https://example.com/filters.txt', importedAt: Date.now(), ruleCount: 0 },
        { url: 'manual', importedAt: Date.now(), ruleCount: 0, blockDomains: [], exceptionDomains: [] }
      ];

      const result = buildUblockFormat(sources);
      expect(() => buildUblockFormat(sources)).not.toThrow();
    });
  });
});