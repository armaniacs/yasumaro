/**
 * markdownTemplateEndToEnd.test.ts
 *
 * 最終レビュー Fix 2 (Important):
 * これまでのテストはすべて「単一の継ぎ目」だけを検証していた
 * (markdownTemplateUtils.test.ts は純粋関数として、saveLocalMarkdownStep.test.ts /
 * localMarkdownExportCore.test.ts は getActiveTemplate 等をモックして)。
 *
 * このテストは実際の解決チェーンを、モックなしの本物の関数だけで
 * 最初から最後まで通す:
 *   createTemplate() → setActiveTemplate() で settings 形状に反映
 *     → chrome.storage.local (モック) に保存された設定を getSettings() が読む
 *     → getActiveTemplate() がアクティブなテンプレートを解決
 *     → buildDailyMarkdown() / renderFileTemplate() が実際にレンダリング
 *     → flushBufferedExports() が chrome.downloads.download (モック) に渡す
 *
 * モックするのはブラウザ API 境界 (chrome.storage.local / chrome.downloads.download)
 * のみ。createTemplate, setActiveTemplate, getActiveTemplate, renderFileTemplate,
 * buildDailyMarkdown, flushBufferedExports, getSettings はすべて本物の実装。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushBufferedExports } from '../localMarkdownExportCore.js';
import { createTemplate, setActiveTemplate, DEFAULT_MARKDOWN_TEMPLATE } from '../../utils/markdownTemplateUtils.js';
import { StorageKeys, clearSettingsCache } from '../../utils/storage.js';
import type { MarkdownExportTemplate } from '../../utils/types.js';
import type { MarkdownEntry } from '../pipeline/buffers/MarkdownBufferManager.js';

/** In-memory backing store for the mocked chrome.storage.local. */
let storageData: Record<string, unknown>;

function installChromeMock(download: ReturnType<typeof vi.fn>): void {
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn((keys: unknown) => {
          if (keys === null || keys === undefined) return Promise.resolve({ ...storageData });
          if (typeof keys === 'string') return Promise.resolve({ [keys]: storageData[keys] });
          if (Array.isArray(keys)) {
            const out: Record<string, unknown> = {};
            for (const k of keys) out[k] = storageData[k];
            return Promise.resolve(out);
          }
          return Promise.resolve({});
        }),
        set: vi.fn((obj: Record<string, unknown>) => {
          Object.assign(storageData, obj);
          return Promise.resolve();
        }),
      },
    },
    downloads: {
      download,
    },
  } as unknown as typeof chrome;
}

/** Decode the base64 data: URL passed to chrome.downloads.download back to plain text. */
function decodeDownloadedContent(dataUrl: string): string {
  const base64 = dataUrl.replace(/^data:text\/markdown;base64,/, '');
  return decodeURIComponent(escape(atob(base64)));
}

const BUFFERED_DATE = '2026-08-07';
const BUFFERED_ENTRIES: MarkdownEntry[] = [
  {
    url: 'https://example.com/article',
    title: 'Sample Article',
    visitedAt: Date.now(),
    entryData: {
      timestamp: '09:15',
      title: 'Sample Article',
      url: 'https://example.com/article',
      summary: 'A short summary.',
      tags: '#sample',
      domain: 'example.com',
    },
  },
];

describe('Markdown template full pipeline (create -> activate -> automatic export)', () => {
  let mockDownload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storageData = {};
    mockDownload = vi.fn().mockResolvedValue(1);
    installChromeMock(mockDownload);
    // getSettings() memoizes its result in a module-level cache with a TTL;
    // without clearing it here, the second test in this file would silently
    // read back the first test's settings instead of exercising its own
    // fresh chrome.storage.local mock.
    clearSettingsCache();
  });

  it('renders the CUSTOM template end-to-end when it is created and activated via the real UI functions', async () => {
    // 1. Create a custom template via the real createTemplate() — distinctive
    //    heading format that DEFAULT_MARKDOWN_TEMPLATE would never produce.
    const customTemplate: MarkdownExportTemplate = createTemplate({
      name: 'Custom E2E Template',
      fileTemplate: '## CUSTOM-EXPORT {{date}} ({{entryCount}} items)\n\n{{entries}}',
      entryTemplate: '* [{{timestamp}}] {{title}} — {{url}}',
    });

    // 2. Persist it the way the dashboard UI does: settings object with the
    //    template list plus the active id resolved via the real setActiveTemplate().
    const activeId = setActiveTemplate([customTemplate], customTemplate.id);
    storageData.settings = {
      [StorageKeys.MARKDOWN_EXPORT_TEMPLATES]: [customTemplate],
      [StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID]: activeId,
      [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: 'Yasumaro',
    };
    storageData.settings_migrated = true;

    // 3. Buffer a day's worth of entries under the real DAILY_BUFFER_PREFIX key.
    storageData[`local_export_${BUFFERED_DATE}`] = BUFFERED_ENTRIES;

    // 4. Run the real flushBufferedExports() end-to-end.
    await flushBufferedExports();

    expect(mockDownload).toHaveBeenCalledTimes(1);
    const [callArg] = mockDownload.mock.calls[0];
    expect(callArg.filename).toBe(`Yasumaro/${BUFFERED_DATE}.md`);

    const content = decodeDownloadedContent(callArg.url);

    // Proves the CUSTOM template's format was used, not just "some" output.
    expect(content).toContain(`## CUSTOM-EXPORT ${BUFFERED_DATE} (1 items)`);
    expect(content).toContain('* [09:15] Sample Article — https://example.com/article');

    // Proves it is NOT what DEFAULT_MARKDOWN_TEMPLATE would have produced.
    expect(content).not.toContain(`# ${BUFFERED_DATE}`);
    expect(content).not.toMatch(/^- 09:15 \[Sample Article\]/m);
  });

  it('falls back to the DEFAULT template end-to-end when no custom template is configured', async () => {
    // No MARKDOWN_EXPORT_TEMPLATES, no ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID — the
    // real getActiveTemplate() fallback must engage through the whole chain.
    storageData.settings = {
      [StorageKeys.MARKDOWN_EXPORT_TEMPLATES]: [],
      [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: 'Yasumaro',
    };
    storageData.settings_migrated = true;
    storageData[`local_export_${BUFFERED_DATE}`] = BUFFERED_ENTRIES;

    await flushBufferedExports();

    expect(mockDownload).toHaveBeenCalledTimes(1);
    const [callArg] = mockDownload.mock.calls[0];
    const content = decodeDownloadedContent(callArg.url);

    // DEFAULT_MARKDOWN_TEMPLATE's exact format: "# {{date}}" heading and
    // "- {{timestamp}} [{{title}}]({{url}})" entry line.
    expect(content).toContain(`# ${BUFFERED_DATE}`);
    expect(content).toContain('- 09:15 [Sample Article](https://example.com/article)');
    expect(content).not.toContain('CUSTOM-EXPORT');

    // Sanity: matches what DEFAULT_MARKDOWN_TEMPLATE would literally render.
    expect(DEFAULT_MARKDOWN_TEMPLATE.fileTemplate).toBe('# {{date}}\n\n{{entries}}');
  });
});
