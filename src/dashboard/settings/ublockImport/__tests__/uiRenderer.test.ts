// @vitest-environment jsdom
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
  buildUblockFormat,
  copyToClipboard
} from '../uiRenderer.js';

// uiRenderer does not export its Source type; mirror it here (fields the renderers read).
type TestSource = {
  url: string;
  importedAt: number;
  ruleCount?: number;
  blockDomains?: string[];
  exceptionDomains?: string[];
};
const sourceList = (items: TestSource[]): Parameters<typeof renderSourceList>[0] =>
  items as unknown as Parameters<typeof renderSourceList>[0];
function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as unknown as T;
}

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
      const sources: TestSource[] = [];
      const deleteCallback = vi.fn();
      const reloadCallback = vi.fn();

      renderSourceList(sourceList(sources), deleteCallback, reloadCallback);

      const noSourcesMsg = byId('uBlockNoSources');
      expect(noSourcesMsg.style.display).toBe('block');

      const container = byId('uBlockSourceItems');
      expect(container.innerHTML).toBe('');
    });

    test('ソースリストを正しく描画', () => {
      const sources: TestSource[] = [
        { url: 'https://example.com/filters.txt', importedAt: Date.now(), ruleCount: 10, blockDomains: ['example.com'], exceptionDomains: [] }
      ];
      const deleteCallback = vi.fn();
      const reloadCallback = vi.fn();

      renderSourceList(sourceList(sources), deleteCallback, reloadCallback);

      const noSourcesMsg = byId('uBlockNoSources');
      expect(noSourcesMsg.style.display).toBe('none');

      const container = byId('uBlockSourceItems');
      const items = container.querySelectorAll('.source-item');
      expect(items).toHaveLength(1);
    });

    test('手動入力ソースで「再読込」ボタンは表示しない', () => {
      const sources: TestSource[] = [
        { url: 'manual', importedAt: Date.now(), ruleCount: 5, blockDomains: ['test.com'], exceptionDomains: [] }
      ];
      const deleteCallback = vi.fn();
      const reloadCallback = vi.fn();

      renderSourceList(sourceList(sources), deleteCallback, reloadCallback);

      const container = byId('uBlockSourceItems');
      const reloadBtns = container.querySelectorAll('.reload-btn');
      expect(reloadBtns).toHaveLength(0);
    });

    test('URLソースで「再読込」ボタンを表示', () => {
      const sources: TestSource[] = [
        { url: 'https://example.com/filters.txt', importedAt: Date.now(), ruleCount: 5, blockDomains: ['test.com'], exceptionDomains: [] }
      ];
      const deleteCallback = vi.fn();
      const reloadCallback = vi.fn();

      renderSourceList(sourceList(sources), deleteCallback, reloadCallback);

      const container = byId('uBlockSourceItems');
      const reloadBtns = container.querySelectorAll('.reload-btn');
      expect(reloadBtns).toHaveLength(1);
    });

    test('XSS対策: 悪意あるURLがエスケープされる', () => {
      const sources: TestSource[] = [
        { url: '<script>alert("XSS")</script>', importedAt: Date.now(), ruleCount: 1, blockDomains: ['test.com'], exceptionDomains: [] }
      ];
      const deleteCallback = vi.fn();
      const reloadCallback = vi.fn();

      renderSourceList(sourceList(sources), deleteCallback, reloadCallback);

      const container = byId('uBlockSourceItems');
      const urlElement = container.querySelector('.source-url')!;
      expect(urlElement.textContent).toBe('<script>alert("XSS")</script>');
      expect(urlElement.innerHTML).not.toContain('<script>');
    });

    test('削除ボタンクリックでdeleteCallbackが呼ばれる', () => {
      const sources: TestSource[] = [
        { url: 'https://example.com/filters.txt', importedAt: Date.now(), ruleCount: 5, blockDomains: ['test.com'], exceptionDomains: [] }
      ];
      const deleteCallback = vi.fn();
      const reloadCallback = vi.fn();

      renderSourceList(sourceList(sources), deleteCallback, reloadCallback);

      const container = byId('uBlockSourceItems');
      const deleteBtn = container.querySelector('.delete-btn') as HTMLElement;
      deleteBtn.click();

      expect(deleteCallback).toHaveBeenCalledWith(0);
    });

    test('再読込ボタンクリックでreloadCallbackが呼ばれる', () => {
      const sources: TestSource[] = [
        { url: 'https://example.com/filters.txt', importedAt: Date.now(), ruleCount: 5, blockDomains: ['test.com'], exceptionDomains: [] }
      ];
      const deleteCallback = vi.fn();
      const reloadCallback = vi.fn();

      renderSourceList(sourceList(sources), deleteCallback, reloadCallback);

      const container = byId('uBlockSourceItems');
      const reloadBtn = container.querySelector('.reload-btn') as HTMLElement;
      reloadBtn.click();

      expect(reloadCallback).toHaveBeenCalledWith(0);
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

      expect(byId('uBlockRuleCount').textContent).toBe('0');
      expect(byId('uBlockExceptionCount').textContent).toBe('0');
      expect(byId('uBlockErrorCount').textContent).toBe('1');
      expect(byId('uBlockErrorDetails').textContent).toBe('Test error message');
      expect(byId('uBlockPreview').style.display).toBe('block');
    });

    test('プレビュー結果を表示', () => {
      const result = {
        blockCount: 10,
        exceptionCount: 5,
        errorCount: 0,
        errorDetails: []
      };

      updatePreviewUI(result);

      expect(byId('uBlockRuleCount').textContent).toBe('10');
      expect(byId('uBlockExceptionCount').textContent).toBe('5');
      expect(byId('uBlockErrorCount').textContent).toBe('0');
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

      expect(byId('uBlockErrorCount').textContent).toBe('2');
      const errorText = byId('uBlockErrorDetails').textContent;
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

      expect(byId('uBlockErrorDetails').textContent).toBe('Error message 1');
    });

    test('errorDetailsが文字列の場合も処理', () => {
      const result = {
        blockCount: 0,
        exceptionCount: 0,
        errorCount: 1,
        errorDetails: 'Some string error' as any
      };

      updatePreviewUI(result);

      expect(byId('uBlockErrorDetails').textContent).toBe('Some string error');
    });

    test('ラベルspanのdata-i18n-argsが更新される', () => {
      document.body.innerHTML = `
        <div id="uBlockPreview"></div>
        <div>
          <span data-i18n="ruleCount">Rules</span>
          <div id="uBlockRuleCount">0</div>
        </div>
        <div>
          <span data-i18n="exceptionCount">Exceptions</span>
          <div id="uBlockExceptionCount">0</div>
        </div>
        <div>
          <span data-i18n="errorCount">Errors</span>
          <div id="uBlockErrorCount">0</div>
        </div>
        <div id="uBlockErrorDetails"></div>
      `;

      const result = {
        blockCount: 5,
        exceptionCount: 2,
        errorCount: 1,
        errorDetails: []
      };

      updatePreviewUI(result);

      const ruleLabel = document.querySelector('[data-i18n="ruleCount_other"]');
      expect(ruleLabel).not.toBeNull();
      expect(ruleLabel!.getAttribute('data-i18n')).toBe('ruleCount_other');
      expect(ruleLabel!.getAttribute('data-i18n-args')).toBe(JSON.stringify({ count: 5 }));
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

      const preview = byId('uBlockPreview');
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

      const textarea = byId<HTMLTextAreaElement>('uBlockFilterInput');
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
      const sources: TestSource[] = [
        { url: 'https://example.com/filters.txt', importedAt: Date.now(), ruleCount: 2, blockDomains: ['example.com', 'test.com'], exceptionDomains: [] }
      ];

      const result = exportSimpleFormat(sourceList(sources));

      const lines = result.split('\n');
      expect(lines).toContain('example.com');
      expect(lines).toContain('test.com');
      expect(lines).toHaveLength(2);
    });

    test('複数ソースをエクスポート（重複除去）', () => {
      const sources: TestSource[] = [
        { url: 'https://example.com/filters1.txt', importedAt: Date.now(), blockDomains: ['example.com', 'test.com'], exceptionDomains: [] },
        { url: 'https://example.com/filters2.txt', importedAt: Date.now(), blockDomains: ['example.com', 'another.com'], exceptionDomains: [] }
      ];

      const result = exportSimpleFormat(sourceList(sources));

      const lines = result.split('\n');
      expect(lines).toContain('example.com');
      expect(lines).toContain('test.com');
      expect(lines).toContain('another.com');
      // 重複除去されていることを確認
      const exampleCount = lines.filter(l => l === 'example.com').length;
      expect(exampleCount).toBe(1);
    });

    test('空ソースは空文字列を返す', () => {
      const sources: TestSource[] = [];
      const result = exportSimpleFormat(sourceList(sources));

      expect(result).toBe('');
    });

    test('例外ドメインはエクスポートされない', () => {
      const sources: TestSource[] = [
        { url: 'manual', importedAt: Date.now(), blockDomains: ['block.com'], exceptionDomains: ['allow.com'] }
      ];

      const result = exportSimpleFormat(sourceList(sources));

      expect(result).toContain('block.com');
      expect(result).not.toContain('allow.com');
    });

    test('blockDomainsが未定義のソースを安全に処理', () => {
      const sources: TestSource[] = [
        { url: 'https://example.com/filters.txt', importedAt: Date.now(), ruleCount: 0, exceptionDomains: [] },
        { url: 'manual', importedAt: Date.now(), blockDomains: ['domain.com'], exceptionDomains: [] }
      ];

      const result = exportSimpleFormat(sourceList(sources));

      expect(result).toContain('domain.com');
    });
  });

  // ============================================================================
  // buildUblockFormat
  // ============================================================================

  describe('buildUblockFormat', () => {
    test('基本形式でブロックルールを生成', () => {
      const sources: TestSource[] = [
        { url: 'manual', importedAt: Date.now(), blockDomains: ['example.com', 'test.com'], exceptionDomains: [] }
      ];

      const result = buildUblockFormat(sourceList(sources));

      expect(result).toContain('! Generated by Yasumaro');
      expect(result).toContain('||example.com^');
      expect(result).toContain('||test.com^');
    });

    test('例外ルールも含める', () => {
      const sources: TestSource[] = [
        { url: 'manual', importedAt: Date.now(), blockDomains: ['block.com'], exceptionDomains: ['allow.com'] }
      ];

      const result = buildUblockFormat(sourceList(sources));

      expect(result).toContain('||block.com^');
      expect(result).toContain('@@||allow.com^');
    });

    test('複数ソースをマージ', () => {
      const sources: TestSource[] = [
        { url: 'https://example.com/filters1.txt', importedAt: Date.now(), blockDomains: ['domain1.com'], exceptionDomains: [] },
        { url: 'https://example.com/filters2.txt', importedAt: Date.now(), blockDomains: ['domain2.com'], exceptionDomains: ['trusted.com'] }
      ];

      const result = buildUblockFormat(sourceList(sources));

      expect(result).toContain('||domain1.com^');
      expect(result).toContain('||domain2.com^');
      expect(result).toContain('@@||trusted.com^');
    });

    test('空ソースはヘッダーのみを返す', () => {
      const sources: TestSource[] = [];
      const result = buildUblockFormat(sourceList(sources));

      expect(result).toContain('! Generated by Yasumaro');
      expect(result.split('\n')).toHaveLength(2); // ヘッダーと空行
    });

    test('正しい改行区切り形式', () => {
      const sources: TestSource[] = [
        { url: 'manual', importedAt: Date.now(), blockDomains: ['domain1.com', 'domain2.com'], exceptionDomains: ['allow.com'] }
      ];

      const result = buildUblockFormat(sourceList(sources));
      const lines = result.split('\n');

      expect(lines[0]).toBe('! Generated by Yasumaro');
      expect(lines[1]).toBe('');
      expect(lines).toContain('||domain1.com^');
      expect(lines).toContain('||domain2.com^');
      expect(lines).toContain('@@||allow.com^');
    });

    test('blockDomains/exceptionDomainsが未定義のソースを安全に処理', () => {
      const sources: TestSource[] = [
        { url: 'https://example.com/filters.txt', importedAt: Date.now(), ruleCount: 0 },
        { url: 'manual', importedAt: Date.now(), ruleCount: 0, blockDomains: [], exceptionDomains: [] }
      ];

      const result = buildUblockFormat(sourceList(sources));
      expect(() => buildUblockFormat(sourceList(sources))).not.toThrow();
    });
  });

  // ============================================================================
  // copyToClipboard
  // ============================================================================

  describe('copyToClipboard', () => {
    test('クリップボードにテキストをコピーしてtrueを返す', async () => {
      const writeTextMock = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        configurable: true,
      });

      const result = await copyToClipboard('test text');

      expect(result).toBe(true);
      expect(writeTextMock).toHaveBeenCalledWith('test text');
    });

    test('クリップボード失敗時にエラーを投げる', async () => {
      const writeTextMock = vi.fn(() => Promise.reject(new Error('denied')));
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        configurable: true,
      });

      await expect(copyToClipboard('test')).rejects.toThrow();
    });
  });
});