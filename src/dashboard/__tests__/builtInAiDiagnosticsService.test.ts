/**
 * builtInAiDiagnosticsService.test.ts
 * Dashboard-side built-in AI availability diagnostics + download trigger.
 * Calls self.LanguageModel directly from the Options page context (no Service Worker relay).
 */

import { webcrypto as crypto } from '@peculiar/webcrypto';
import { vi } from 'vitest';
Object.defineProperty(global, 'crypto', { value: crypto });

vi.mock('../../utils/browserSupport.js', () => ({
  getBrowserName: vi.fn(() => 'chrome'),
  getBuiltInAIFlagGuidance: vi.fn((browserName: string) => {
    if (browserName === 'chrome') {
      return { url: 'chrome://flags/#prompt-api-for-gemini-nano', flagName: 'Prompt API for Gemini Nano' };
    }
    return null;
  }),
}));

import {
  checkBuiltInAiAvailability,
  startBuiltInAiDownload,
} from '../builtInAiDiagnosticsService.js';
import * as browserSupportModule from '../../utils/browserSupport.js';

const { getBrowserName } = vi.mocked(browserSupportModule);

interface MockSession {
  destroy: ReturnType<typeof vi.fn>;
}

function createMockSession(): MockSession {
  return { destroy: vi.fn() };
}

describe('builtInAiDiagnosticsService', () => {
  let mockLanguageModel: {
    availability: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getBrowserName.mockReturnValue('chrome');
    mockLanguageModel = {
      availability: vi.fn(async () => 'available'),
      create: vi.fn(async () => createMockSession()),
    };
    (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = mockLanguageModel;
  });

  afterEach(() => {
    delete (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel;
  });

  describe('checkBuiltInAiAvailability', () => {
    test('LanguageModel が存在しない場合 unavailable を返す', async () => {
      delete (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel;
      const result = await checkBuiltInAiAvailability();
      expect(result.status).toBe('unavailable');
    });

    test('available を返す', async () => {
      mockLanguageModel.availability.mockResolvedValueOnce('available');
      const result = await checkBuiltInAiAvailability();
      expect(result.status).toBe('available');
      expect(result.guidance).toBeNull();
    });

    test('downloadable を返す', async () => {
      mockLanguageModel.availability.mockResolvedValueOnce('downloadable');
      const result = await checkBuiltInAiAvailability();
      expect(result.status).toBe('downloadable');
    });

    test('downloading を返す', async () => {
      mockLanguageModel.availability.mockResolvedValueOnce('downloading');
      const result = await checkBuiltInAiAvailability();
      expect(result.status).toBe('downloading');
    });

    test('unavailable の場合 Chrome 向けフラグ案内を含む', async () => {
      mockLanguageModel.availability.mockResolvedValueOnce('unavailable');
      getBrowserName.mockReturnValue('chrome');
      const result = await checkBuiltInAiAvailability();
      expect(result.status).toBe('unavailable');
      expect(result.guidance).toEqual({
        url: 'chrome://flags/#prompt-api-for-gemini-nano',
        flagName: 'Prompt API for Gemini Nano',
      });
    });

    test('unavailable かつ未知ブラウザの場合 guidance は null', async () => {
      mockLanguageModel.availability.mockResolvedValueOnce('unavailable');
      getBrowserName.mockReturnValue('unknown');
      const result = await checkBuiltInAiAvailability();
      expect(result.guidance).toBeNull();
    });

    test('availability() が例外を投げた場合 unavailable を返す', async () => {
      mockLanguageModel.availability.mockRejectedValueOnce(new Error('boom'));
      const result = await checkBuiltInAiAvailability();
      expect(result.status).toBe('unavailable');
    });
  });

  describe('startBuiltInAiDownload', () => {
    test('LanguageModel が存在しない場合 unavailable を返しダウンロードを試みない', async () => {
      delete (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel;
      const onProgress = vi.fn();
      const result = await startBuiltInAiDownload(onProgress);
      expect(result.status).toBe('unavailable');
      expect(onProgress).not.toHaveBeenCalled();
    });

    test('monitor 経由の downloadprogress イベントで進捗を通知する', async () => {
      let capturedListener: ((event: { loaded: number }) => void) | undefined;
      const mockMonitorTarget = {
        addEventListener: vi.fn((eventName: string, listener: (event: { loaded: number }) => void) => {
          if (eventName === 'downloadprogress') {
            capturedListener = listener;
          }
        }),
      };
      mockLanguageModel.create.mockImplementationOnce(async (options?: { monitor?: (m: typeof mockMonitorTarget) => void }) => {
        options?.monitor?.(mockMonitorTarget);
        // Simulate progress events fired by the platform during download.
        capturedListener?.({ loaded: 0.5 });
        capturedListener?.({ loaded: 1 });
        return createMockSession();
      });
      mockLanguageModel.availability.mockResolvedValue('available');

      const onProgress = vi.fn();
      const result = await startBuiltInAiDownload(onProgress);

      expect(onProgress).toHaveBeenNthCalledWith(1, 50);
      expect(onProgress).toHaveBeenNthCalledWith(2, 100);
      expect(result.status).toBe('available');
    });

    test('create() が失敗した場合 unavailable を返す', async () => {
      mockLanguageModel.create.mockRejectedValueOnce(new Error('download failed'));
      const onProgress = vi.fn();
      const result = await startBuiltInAiDownload(onProgress);
      expect(result.status).toBe('unavailable');
    });

    test('ダウンロード後に破棄したセッションを再利用しない（session.destroy が呼ばれる）', async () => {
      const session = createMockSession();
      mockLanguageModel.create.mockResolvedValueOnce(session);
      mockLanguageModel.availability.mockResolvedValue('available');

      await startBuiltInAiDownload(vi.fn());

      expect(session.destroy).toHaveBeenCalled();
    });
  });
});
