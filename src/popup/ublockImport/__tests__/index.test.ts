// @vitest-environment jsdom
/**
 * index.test.ts
 * Tests for src/popup/ublockImport/index.ts
 * Covers init(), setupDragAndDrop(), and re-exported public API
 */

import { vi } from 'vitest';;

// Mock all sub-modules
vi.mock('../fileReader.js', () => ({
  readFile: vi.fn(() => Promise.resolve('file content')),
}));

vi.mock('../urlFetcher.js', () => ({
  fetchFromUrl: vi.fn(() => Promise.resolve('||example.com^')),
}));

vi.mock('../validation.js', () => ({
  isValidUrl: vi.fn((url: string) => url.startsWith('https://')),
}));

vi.mock('../rulesBuilder.js', () => ({
  rebuildRulesFromSources: vi.fn(() => ({
    blockDomains: ['example.com'],
    exceptionDomains: [],
    metadata: { ruleCount: 1 },
  })),
  previewUblockFilter: vi.fn(() => ({
    blockDomains: ['example.com'],
    exceptionDomains: [],
    errorDomains: [],
  })),
}));

vi.mock('../sourceManager.js', () => ({
  loadAndDisplaySources: vi.fn((cb: Function) => {
    cb([]);
    return Promise.resolve();
  }),
  deleteSource: vi.fn(() => Promise.resolve()),
  reloadSource: vi.fn(() => Promise.resolve({ sources: [], ruleCount: 0 })),
  saveUblockSettings: vi.fn(() => Promise.resolve({ sources: [], action: 'created', ruleCount: 1 })),
}));

vi.mock('../uiRenderer.js', () => ({
  renderSourceList: vi.fn(),
  updatePreviewUI: vi.fn(),
  hidePreview: vi.fn(),
  clearInput: vi.fn(),
  exportSimpleFormat: vi.fn(() => 'example.com'),
  copyToClipboard: vi.fn(() => Promise.resolve()),
  buildUblockFormat: vi.fn(() => '||example.com^'),
}));

vi.mock('../../settingsUiHelper.js', () => ({
  showStatus: vi.fn(),
}));

vi.mock('../../../utils/logger.js', () => ({
  LogType: { ERROR: 'ERROR', INFO: 'INFO' },
  addLog: vi.fn(),
}));

vi.mock('../../../utils/storage.js', () => ({
  StorageKeys: { UBLOCK_SOURCES: 'ublock_sources', UBLOCK_FORMAT_ENABLED: 'ublock_format_enabled' },
  getSettings: vi.fn(() => Promise.resolve({ ublock_sources: [], ublock_format_enabled: false })),
  saveSettings: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../i18n.js', () => ({
  getMessage: vi.fn((key: string, subs?: Record<string, string>) => {
    const msgs: Record<string, string> = {
      fileLoaded: 'Loaded "{filename}"',
      fileReadError: 'File read error',
      textFileOnly: 'Only text files are supported',
      loadEmptyUrl: 'Please enter a URL',
      loadingUrl: 'Loading...',
      importFromUrl: 'Import from URL',
      loadedFromUrl: 'Loaded from "{url}"',
      nothingToExport: 'Nothing to export',
      exportError: 'Export error',
      noTextToCopy: 'No text to copy',
      copiedToClipboard: 'Copied to clipboard',
      copyError: 'Copy error',
      deleteError: 'Delete error',
      reloadError: 'Reload error',
      fileExported: 'File exported',
      sourceUpdatedWithDiff: 'Updated ({ruleCount} rules, {diff})',
    };
    let msg = msgs[key] || key;
    if (subs) {
      for (const [k, v] of Object.entries(subs)) {
        msg = msg.replace(`{${k}}`, v);
      }
    }
    return msg;
  }),
}));

function setupUblockDOM() {
  document.body.innerHTML = `
    <textarea id="uBlockFilterInput"></textarea>
    <button id="uBlockFileSelectBtn"></button>
    <input type="file" id="uBlockFileInput" />
    <button id="uBlockUrlImportBtn"></button>
    <input id="uBlockUrlInput" />
    <button id="uBlockExportBtn"></button>
    <button id="uBlockCopyBtn"></button>
    <div id="uBlockDropZone"></div>
    <div id="uBlockFormatUI"></div>
  `;
}

describe('ublockImport/index.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    document.body.innerHTML = '';
  });

  // =========================================================================
  // Re-exports
  // =========================================================================
  describe('re-exports', () => {
    test('should re-export isValidUrl from validation.js', async () => {
      const { isValidUrl } = await import('../index.js');
      expect(isValidUrl).toBeDefined();
      expect(isValidUrl('https://example.com')).toBe(true);
    });

    test('should re-export rebuildRulesFromSources from rulesBuilder.js', async () => {
      const { rebuildRulesFromSources } = await import('../index.js');
      expect(rebuildRulesFromSources).toBeDefined();
    });

    test('should re-export previewUblockFilter from rulesBuilder.js', async () => {
      const { previewUblockFilter } = await import('../index.js');
      expect(previewUblockFilter).toBeDefined();
    });

    test('should re-export fetchFromUrl from urlFetcher.js', async () => {
      const { fetchFromUrl } = await import('../index.js');
      expect(fetchFromUrl).toBeDefined();
    });

    test('should re-export readFile from fileReader.js', async () => {
      const { readFile } = await import('../index.js');
      expect(readFile).toBeDefined();
    });

    test('should re-export renderSourceList from uiRenderer.js', async () => {
      const { renderSourceList } = await import('../index.js');
      expect(renderSourceList).toBeDefined();
    });

    test('should re-export updatePreviewUI from uiRenderer.js', async () => {
      const { updatePreviewUI } = await import('../index.js');
      expect(updatePreviewUI).toBeDefined();
    });

    test('should re-export hidePreview from uiRenderer.js', async () => {
      const { hidePreview } = await import('../index.js');
      expect(hidePreview).toBeDefined();
    });

    test('should re-export clearInput from uiRenderer.js', async () => {
      const { clearInput } = await import('../index.js');
      expect(clearInput).toBeDefined();
    });

    test('should re-export loadAndDisplaySources from sourceManager.js', async () => {
      const { loadAndDisplaySources } = await import('../index.js');
      expect(loadAndDisplaySources).toBeDefined();
    });

    test('should re-export deleteSource from sourceManager.js', async () => {
      const { deleteSource } = await import('../index.js');
      expect(deleteSource).toBeDefined();
    });

    test('should re-export reloadSource from sourceManager.js', async () => {
      const { reloadSource } = await import('../index.js');
      expect(reloadSource).toBeDefined();
    });

    test('should re-export saveUblockSettings from sourceManager.js', async () => {
      const { saveUblockSettings } = await import('../index.js');
      expect(saveUblockSettings).toBeDefined();
    });

    test('should export handleSaveUblockSettings', async () => {
      const { handleSaveUblockSettings } = await import('../index.js');
      expect(handleSaveUblockSettings).toBeDefined();
      expect(typeof handleSaveUblockSettings).toBe('function');
    });
  });

  // =========================================================================
  // init()
  // =========================================================================
  describe('init()', () => {
    test('should set up event listeners and load sources', async () => {
      setupUblockDOM();

      const { init } = await import('../index.js');
      await init();

      const { loadAndDisplaySources } = await import('../sourceManager.js');
      expect(loadAndDisplaySources).toHaveBeenCalled();
    });

    test('should work when optional DOM elements are missing', async () => {
      const { init } = await import('../index.js');
      await expect(init()).resolves.not.toThrow();
    });
  });

  // =========================================================================
  // setupDragAndDrop()
  // =========================================================================
  describe('setupDragAndDrop()', () => {
    test('should set up drag and drop when all elements exist', async () => {
      setupUblockDOM();
      const { setupDragAndDrop } = await import('../index.js');
      expect(() => setupDragAndDrop()).not.toThrow();
    });

    test('should return early when dropZone is missing', async () => {
      document.body.innerHTML = `
        <textarea id="uBlockFilterInput"></textarea>
        <div id="uBlockFormatUI"></div>
      `;
      const { setupDragAndDrop } = await import('../index.js');
      expect(() => setupDragAndDrop()).not.toThrow();
    });

    test('should return early when textarea is missing', async () => {
      document.body.innerHTML = `
        <div id="uBlockDropZone"></div>
        <div id="uBlockFormatUI"></div>
      `;
      const { setupDragAndDrop } = await import('../index.js');
      expect(() => setupDragAndDrop()).not.toThrow();
    });

    test('should return early when uBlockFormatUI is missing', async () => {
      document.body.innerHTML = `
        <div id="uBlockDropZone"></div>
        <textarea id="uBlockFilterInput"></textarea>
      `;
      const { setupDragAndDrop } = await import('../index.js');
      expect(() => setupDragAndDrop()).not.toThrow();
    });

    test('should show drop zone on dragover', async () => {
      setupUblockDOM();
      const { setupDragAndDrop } = await import('../index.js');
      setupDragAndDrop();

      const textarea = document.getElementById('uBlockFilterInput')!;
      const dropZone = document.getElementById('uBlockDropZone')!;

      textarea.dispatchEvent(new Event('dragover', { bubbles: true }));

      expect(dropZone.style.display).toBe('block');
      expect(dropZone.classList.contains('active')).toBe(true);
    });

    test('should not re-activate drop zone on repeated dragover', async () => {
      setupUblockDOM();
      const { setupDragAndDrop } = await import('../index.js');
      setupDragAndDrop();

      const textarea = document.getElementById('uBlockFilterInput')!;
      const dropZone = document.getElementById('uBlockDropZone')!;

      textarea.dispatchEvent(new Event('dragover', { bubbles: true }));
      // Second dragover should not re-add 'active'
      textarea.dispatchEvent(new Event('dragover', { bubbles: true }));

      expect(dropZone.classList.contains('active')).toBe(true);
    });

    test('should hide drop zone on drop with no files (non-text)', async () => {
      setupUblockDOM();
      const { setupDragAndDrop } = await import('../index.js');
      setupDragAndDrop();

      const dropZone = document.getElementById('uBlockDropZone')!;

      // Activate drop zone first
      const textarea = document.getElementById('uBlockFilterInput')!;
      textarea.dispatchEvent(new Event('dragover', { bubbles: true }));
      expect(dropZone.classList.contains('active')).toBe(true);

      // Drop with empty dataTransfer (no files = not text/plain)
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: { files: [] },
      });
      Object.defineProperty(dropEvent, 'preventDefault', {
        value: vi.fn(),
      });
      dropZone.dispatchEvent(dropEvent);

      const { showStatus } = await import('../../settingsUiHelper.js');
      expect(showStatus).toHaveBeenCalledWith('domainStatus', expect.any(String), 'error');
    });

    test('should process drop with text/plain file', async () => {
      setupUblockDOM();
      const { setupDragAndDrop } = await import('../index.js');
      setupDragAndDrop();

      const dropZone = document.getElementById('uBlockDropZone')!;

      // Activate first
      const textarea = document.getElementById('uBlockFilterInput')!;
      textarea.dispatchEvent(new Event('dragover', { bubbles: true }));

      // Drop with text file
      const file = new File(['||example.com^'], 'filters.txt', { type: 'text/plain' });
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: { files: [file] },
      });
      Object.defineProperty(dropEvent, 'preventDefault', {
        value: vi.fn(),
      });
      dropZone.dispatchEvent(dropEvent);

      await new Promise(r => setTimeout(r, 10));

      const { readFile } = await import('../fileReader.js');
      expect(readFile).toHaveBeenCalledWith(file);

      expect(dropZone.classList.contains('active')).toBe(false);
    });

    test('should handle file read error on drop', async () => {
      const { readFile } = await import('../fileReader.js');
      (readFile as vi.Mock).mockRejectedValueOnce(new Error('Read error'));

      setupUblockDOM();
      const { setupDragAndDrop } = await import('../index.js');
      setupDragAndDrop();

      const dropZone = document.getElementById('uBlockDropZone')!;

      const file = new File(['bad'], 'bad.txt', { type: 'text/plain' });
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: { files: [file] },
      });
      Object.defineProperty(dropEvent, 'preventDefault', {
        value: vi.fn(),
      });
      dropZone.dispatchEvent(dropEvent);

      await new Promise(r => setTimeout(r, 10));

      const { showStatus } = await import('../../settingsUiHelper.js');
      expect(showStatus).toHaveBeenCalledWith('domainStatus', expect.stringContaining('Read error'), 'error');
    });
  });

  // =========================================================================
  // Text input preview
  // =========================================================================
  describe('text input preview', () => {
    test('should trigger preview on input event', async () => {
      setupUblockDOM();
      const textarea = document.getElementById('uBlockFilterInput') as HTMLTextAreaElement;
      textarea.value = '||example.com^';

      const { init } = await import('../index.js');
      await init();

      textarea.dispatchEvent(new Event('input', { bubbles: true }));

      const { previewUblockFilter } = await import('../rulesBuilder.js');
      expect(previewUblockFilter).toHaveBeenCalledWith('||example.com^');
    });
  });

  // =========================================================================
  // File input
  // =========================================================================
  describe('file input', () => {
    test('should click file input when file button is clicked', async () => {
      setupUblockDOM();
      const fileInput = document.getElementById('uBlockFileInput') as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {});

      const { init } = await import('../index.js');
      await init();

      const fileBtn = document.getElementById('uBlockFileSelectBtn')!;
      fileBtn.dispatchEvent(new Event('click'));

      expect(clickSpy).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // URL import
  // =========================================================================
  describe('URL import', () => {
    test('should show error when URL is empty', async () => {
      setupUblockDOM();
      const urlInput = document.getElementById('uBlockUrlInput') as HTMLInputElement;
      urlInput.value = '';

      const { init } = await import('../index.js');
      await init();

      const urlImportBtn = document.getElementById('uBlockUrlImportBtn')!;
      urlImportBtn.dispatchEvent(new Event('click'));

      await new Promise(r => setTimeout(r, 0));

      const { showStatus } = await import('../../settingsUiHelper.js');
      expect(showStatus).toHaveBeenCalledWith('domainStatus', expect.stringContaining('URL'), 'error');
    });

    test('should show error when URL is whitespace only', async () => {
      setupUblockDOM();
      const urlInput = document.getElementById('uBlockUrlInput') as HTMLInputElement;
      urlInput.value = '   ';

      const { init } = await import('../index.js');
      await init();

      const urlImportBtn = document.getElementById('uBlockUrlImportBtn')!;
      urlImportBtn.dispatchEvent(new Event('click'));

      await new Promise(r => setTimeout(r, 0));

      const { showStatus } = await import('../../settingsUiHelper.js');
      expect(showStatus).toHaveBeenCalledWith('domainStatus', expect.stringContaining('URL'), 'error');
    });

    test('should disable button during loading and re-enable after', async () => {
      setupUblockDOM();
      const urlInput = document.getElementById('uBlockUrlInput') as HTMLInputElement;
      urlInput.value = 'https://example.com/filters.txt';
      const urlImportBtn = document.getElementById('uBlockUrlImportBtn') as HTMLButtonElement;
      urlImportBtn.textContent = 'Import';

      const { init } = await import('../index.js');
      await init();

      urlImportBtn.dispatchEvent(new Event('click'));

      // Should be disabled immediately
      expect(urlImportBtn.disabled).toBe(true);
      expect(urlImportBtn.textContent).toBe('Loading...');

      await new Promise(r => setTimeout(r, 50));

      // Re-enabled after completion
      expect(urlImportBtn.disabled).toBe(false);
      expect(urlImportBtn.textContent).toBe('Import from URL');
    });

    test('should handle URL import error', async () => {
      const { fetchFromUrl } = await import('../urlFetcher.js');
      (fetchFromUrl as vi.Mock).mockRejectedValueOnce(new Error('Network error'));

      setupUblockDOM();
      const urlInput = document.getElementById('uBlockUrlInput') as HTMLInputElement;
      urlInput.value = 'https://example.com/bad.txt';

      const { init } = await import('../index.js');
      await init();

      const urlImportBtn = document.getElementById('uBlockUrlImportBtn')!;
      urlImportBtn.dispatchEvent(new Event('click'));

      await new Promise(r => setTimeout(r, 50));

      const { showStatus } = await import('../../settingsUiHelper.js');
      expect(showStatus).toHaveBeenCalledWith('domainStatus', 'Network error', 'error');
    });

    test('should import URL successfully and populate textarea', async () => {
      setupUblockDOM();
      const urlInput = document.getElementById('uBlockUrlInput') as HTMLInputElement;
      urlInput.value = 'https://example.com/filters.txt';
      const textarea = document.getElementById('uBlockFilterInput') as HTMLTextAreaElement;

      const { init } = await import('../index.js');
      await init();

      const urlImportBtn = document.getElementById('uBlockUrlImportBtn')!;
      urlImportBtn.dispatchEvent(new Event('click'));

      await new Promise(r => setTimeout(r, 50));

      expect(textarea.value).toBe('||example.com^');
    });
  });

  // =========================================================================
  // Export / Copy
  // =========================================================================
  describe('export and copy', () => {
    test('should show error when exporting with no sources', async () => {
      setupUblockDOM();
      const { init } = await import('../index.js');
      await init();

      const exportBtn = document.getElementById('uBlockExportBtn')!;
      exportBtn.dispatchEvent(new Event('click'));

      await new Promise(r => setTimeout(r, 0));

      const { showStatus } = await import('../../settingsUiHelper.js');
      expect(showStatus).toHaveBeenCalledWith('domainStatus', expect.stringContaining('Nothing'), 'error');
    });

    test('should show error when copying empty text', async () => {
      setupUblockDOM();
      const textarea = document.getElementById('uBlockFilterInput') as HTMLTextAreaElement;
      textarea.value = '';

      const { init } = await import('../index.js');
      await init();

      const copyBtn = document.getElementById('uBlockCopyBtn')!;
      copyBtn.dispatchEvent(new Event('click'));

      await new Promise(r => setTimeout(r, 0));

      const { showStatus } = await import('../../settingsUiHelper.js');
      expect(showStatus).toHaveBeenCalledWith('domainStatus', expect.stringContaining('No text'), 'error');
    });

    test('should copy text to clipboard', async () => {
      setupUblockDOM();
      const textarea = document.getElementById('uBlockFilterInput') as HTMLTextAreaElement;
      textarea.value = '||example.com^';

      const { init } = await import('../index.js');
      await init();

      const copyBtn = document.getElementById('uBlockCopyBtn')!;
      copyBtn.dispatchEvent(new Event('click'));

      await new Promise(r => setTimeout(r, 0));

      const { copyToClipboard } = await import('../uiRenderer.js');
      expect(copyToClipboard).toHaveBeenCalledWith('||example.com^');

      const { showStatus } = await import('../../settingsUiHelper.js');
      expect(showStatus).toHaveBeenCalledWith('domainStatus', expect.stringContaining('Copied'), 'success');
    });

    test('should export sources when available', async () => {
      setupUblockDOM();
      // Mock URL methods for blob handling
      global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
      global.URL.revokeObjectURL = vi.fn();

      const { getSettings } = await import('../../../utils/storage.js');
      (getSettings as vi.Mock).mockImplementation(() => Promise.resolve({
        ublock_sources: [{ url: 'manual', blockDomains: ['example.com'], exceptionDomains: [] }],
        ublock_format_enabled: false,
      }));

      const { init } = await import('../index.js');
      await init();

      const exportBtn = document.getElementById('uBlockExportBtn')!;
      exportBtn.dispatchEvent(new Event('click'));

      await new Promise(r => setTimeout(r, 10));

      const { exportSimpleFormat } = await import('../uiRenderer.js');
      expect(exportSimpleFormat).toHaveBeenCalled();

      const { showStatus } = await import('../../settingsUiHelper.js');
      expect(showStatus).toHaveBeenCalledWith('domainStatus', expect.stringContaining('exported'), 'success');
    });

    test('should handle export error', async () => {
      setupUblockDOM();
      const { getSettings } = await import('../../../utils/storage.js');
      (getSettings as vi.Mock).mockImplementation(() => Promise.reject(new Error('Storage error')));

      const { init } = await import('../index.js');
      await init();

      const exportBtn = document.getElementById('uBlockExportBtn')!;
      exportBtn.dispatchEvent(new Event('click'));

      await new Promise(r => setTimeout(r, 10));

      const { showStatus } = await import('../../settingsUiHelper.js');
      expect(showStatus).toHaveBeenCalledWith('domainStatus', expect.stringContaining('Storage error'), 'error');
    });

    test('should handle copy error', async () => {
      const { copyToClipboard } = await import('../uiRenderer.js');
      (copyToClipboard as vi.Mock).mockRejectedValueOnce(new Error('Clipboard error'));

      setupUblockDOM();
      const textarea = document.getElementById('uBlockFilterInput') as HTMLTextAreaElement;
      textarea.value = 'some text';

      const { init } = await import('../index.js');
      await init();

      const copyBtn = document.getElementById('uBlockCopyBtn')!;
      copyBtn.dispatchEvent(new Event('click'));

      await new Promise(r => setTimeout(r, 10));

      const { showStatus } = await import('../../settingsUiHelper.js');
      expect(showStatus).toHaveBeenCalledWith('domainStatus', expect.stringContaining('Clipboard error'), 'error');
    });
  });

  // =========================================================================
  // handleSaveUblockSettings (exported)
  // =========================================================================
  describe('handleSaveUblockSettings()', () => {
    test('should save disabled state when checkbox unchecked', async () => {
      document.body.innerHTML = '<input type="checkbox" id="ublockFormatEnabled" />';

      const { handleSaveUblockSettings } = await import('../index.js');
      await handleSaveUblockSettings();

      const { saveSettings } = await import('../../../utils/storage.js');
      expect(saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ ublock_format_enabled: false })
      );
    });

    test('should save enabled flag when checkbox checked but textarea empty', async () => {
      document.body.innerHTML = `
        <input type="checkbox" id="ublockFormatEnabled" checked />
        <textarea id="uBlockFilterInput"></textarea>
      `;

      const { handleSaveUblockSettings } = await import('../index.js');
      await handleSaveUblockSettings();

      const { saveSettings } = await import('../../../utils/storage.js');
      expect(saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ ublock_format_enabled: true })
      );
    });

    test('should call saveUblockSettings when text is present', async () => {
      document.body.innerHTML = `
        <input type="checkbox" id="ublockFormatEnabled" checked />
        <textarea id="uBlockFilterInput">||example.com^</textarea>
      `;

      const { handleSaveUblockSettings } = await import('../index.js');
      await handleSaveUblockSettings();

      const { saveUblockSettings } = await import('../sourceManager.js');
      expect(saveUblockSettings).toHaveBeenCalledWith('||example.com^', null);
    });

    test('should handle saveUblockSettings error', async () => {
      const { saveUblockSettings } = await import('../sourceManager.js');
      (saveUblockSettings as vi.Mock).mockRejectedValueOnce(new Error('Save error'));

      document.body.innerHTML = `
        <input type="checkbox" id="ublockFormatEnabled" checked />
        <textarea id="uBlockFilterInput">||example.com^</textarea>
      `;

      const { handleSaveUblockSettings } = await import('../index.js');
      await expect(handleSaveUblockSettings()).rejects.toThrow('Save error');
    });
  });

  // =========================================================================
  // dragleave behavior
  // =========================================================================
  describe('dragleave behavior', () => {
    test('should hide drop zone when drag leaves formatUI', async () => {
      setupUblockDOM();
      const { setupDragAndDrop } = await import('../index.js');
      setupDragAndDrop();

      const textarea = document.getElementById('uBlockFilterInput')!;
      const dropZone = document.getElementById('uBlockDropZone')!;
      const uBlockFormatUI = document.getElementById('uBlockFormatUI')!;

      // Activate
      textarea.dispatchEvent(new Event('dragover', { bubbles: true }));
      expect(dropZone.classList.contains('active')).toBe(true);

      // Leave from uBlockFormatUI to body (not inside dropZone)
      const leaveEvent = new Event('dragleave', { bubbles: true });
      Object.defineProperty(leaveEvent, 'relatedTarget', { value: document.body });
      uBlockFormatUI.dispatchEvent(leaveEvent);

      expect(dropZone.classList.contains('active')).toBe(false);
      expect(dropZone.style.display).toBe('none');
    });

    test('should not hide drop zone if relatedTarget is inside dropZone', async () => {
      setupUblockDOM();
      const childEl = document.createElement('span');
      childEl.id = 'child';
      document.getElementById('uBlockDropZone')!.appendChild(childEl);

      const { setupDragAndDrop } = await import('../index.js');
      setupDragAndDrop();

      const textarea = document.getElementById('uBlockFilterInput')!;
      const dropZone = document.getElementById('uBlockDropZone')!;
      const uBlockFormatUI = document.getElementById('uBlockFormatUI')!;

      // Activate
      textarea.dispatchEvent(new Event('dragover', { bubbles: true }));
      expect(dropZone.classList.contains('active')).toBe(true);

      // Leave to element inside dropZone
      const leaveEvent = new Event('dragleave', { bubbles: true });
      Object.defineProperty(leaveEvent, 'relatedTarget', { value: childEl });
      uBlockFormatUI.dispatchEvent(leaveEvent);

      // Should still be active
      expect(dropZone.classList.contains('active')).toBe(true);
    });
  });
});
