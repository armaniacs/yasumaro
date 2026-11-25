// @vitest-environment wasm-quickjs-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chromeDownloadPort } from '../markdownExport.js';
import { waitForMock } from '../../../testDir/waitPolicy.js';

describe('markdownExport', () => {
  describe('chromeDownloadPort', () => {
    const BLOB_URL = 'blob:markdown-export';

    beforeEach(() => {
      vi.clearAllMocks();
      (globalThis.URL as any).createObjectURL = vi.fn(() => BLOB_URL);
      (globalThis.URL as any).revokeObjectURL = vi.fn();
      (globalThis as any).chrome = {
        downloads: { download: vi.fn().mockResolvedValue('dl-id') },
      };
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('revokes the object url once the download promise settles, without a timer', async () => {
      let releaseDownload!: (id: string) => void;
      const downloadMock = vi
        .fn()
        .mockImplementation(
          () => new Promise<string>((resolve) => { releaseDownload = resolve; }),
        );
      (globalThis as any).chrome.downloads.download = downloadMock;

      const pending = chromeDownloadPort('Yasumaro/2026-10-02.md', '# 2026-10-02\n');
      await waitForMock(() => expect(downloadMock).toHaveBeenCalled());
      // Still in flight: the url must stay usable, so no revoke yet.
      expect((globalThis.URL as any).revokeObjectURL).not.toHaveBeenCalled();

      releaseDownload('dl-id');
      await pending;

      expect(downloadMock).toHaveBeenCalledTimes(1);
      expect(downloadMock).toHaveBeenCalledWith(
        expect.objectContaining({ url: BLOB_URL, filename: 'Yasumaro/2026-10-02.md' }),
      );
      expect((globalThis.URL as any).revokeObjectURL).toHaveBeenCalledTimes(1);
      expect((globalThis.URL as any).revokeObjectURL).toHaveBeenCalledWith(BLOB_URL);
    });

    it('revokes the object url when the download rejects and propagates the error', async () => {
      const downloadMock = vi.fn().mockRejectedValue(new Error('dl fail'));
      (globalThis as any).chrome.downloads.download = downloadMock;

      await expect(chromeDownloadPort('Yasumaro/2026-10-02.md', 'content')).rejects.toThrow(
        'dl fail',
      );
      expect((globalThis.URL as any).revokeObjectURL).toHaveBeenCalledTimes(1);
      expect((globalThis.URL as any).revokeObjectURL).toHaveBeenCalledWith(BLOB_URL);
    });

    it('waits for downloads.onChanged terminal state before revoking when downloadId is numeric (Firefox blob race fix)', async () => {
      let registeredListener: ((delta: chrome.downloads.DownloadDelta) => void) | null = null;
      const addListener = vi.fn((fn: (delta: chrome.downloads.DownloadDelta) => void) => {
        registeredListener = fn;
      });
      const removeListener = vi.fn();
      (globalThis as any).chrome = {
        downloads: {
          download: vi.fn().mockResolvedValue(42),
          onChanged: {
            addListener,
            removeListener,
          },
        },
      };

      const pending = chromeDownloadPort('Yasumaro/2026-11-25.md', '# Export\n');
      await waitForMock(() => expect(addListener).toHaveBeenCalledTimes(1));
      // Download started but not yet complete: blob URL must remain live for Firefox's async fetch.
      expect((globalThis.URL as any).revokeObjectURL).not.toHaveBeenCalled();

      registeredListener!({ id: 42, state: { current: 'complete' } } as chrome.downloads.DownloadDelta);
      await pending;

      expect(removeListener).toHaveBeenCalledTimes(1);
      expect((globalThis.URL as any).revokeObjectURL).toHaveBeenCalledTimes(1);
      expect((globalThis.URL as any).revokeObjectURL).toHaveBeenCalledWith(BLOB_URL);
    });
  });
});
