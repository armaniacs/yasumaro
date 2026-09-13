/**
 * builtInAiDiagnosticsService.test.ts
 * Dashboard-side built-in AI availability diagnostics + download trigger.
 * Calls self.LanguageModel directly from the Options page context (no Service Worker relay).
 */

import { Crypto } from '@peculiar/webcrypto';
import { vi } from 'vitest';
Object.defineProperty(global, 'crypto', { value: new Crypto() });

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
    test('returns unavailable when LanguageModel is absent', async () => {
      delete (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel;
      const result = await checkBuiltInAiAvailability();
      expect(result.status).toBe('unavailable');
    });

    test('returns available', async () => {
      mockLanguageModel.availability.mockResolvedValueOnce('available');
      const result = await checkBuiltInAiAvailability();
      expect(result.status).toBe('available');
      expect(result.guidance).toBeNull();
    });

    test('calls availability() with the same expectedOutputs as create()', async () => {
      await checkBuiltInAiAvailability();
      expect(mockLanguageModel.availability).toHaveBeenCalledWith({
        expectedOutputs: [{ type: 'text', languages: ['ja'] }],
      });
    });

    test('returns downloadable', async () => {
      mockLanguageModel.availability.mockResolvedValueOnce('downloadable');
      const result = await checkBuiltInAiAvailability();
      expect(result.status).toBe('downloadable');
    });

    test('returns downloading', async () => {
      mockLanguageModel.availability.mockResolvedValueOnce('downloading');
      const result = await checkBuiltInAiAvailability();
      expect(result.status).toBe('downloading');
    });

    test('includes Chrome flag guidance when unavailable', async () => {
      mockLanguageModel.availability.mockResolvedValueOnce('unavailable');
      getBrowserName.mockReturnValue('chrome');
      const result = await checkBuiltInAiAvailability();
      expect(result.status).toBe('unavailable');
      expect(result.guidance).toEqual({
        url: 'chrome://flags/#prompt-api-for-gemini-nano',
        flagName: 'Prompt API for Gemini Nano',
      });
    });

    test('returns null guidance when unavailable on an unknown browser', async () => {
      mockLanguageModel.availability.mockResolvedValueOnce('unavailable');
      getBrowserName.mockReturnValue('unknown');
      const result = await checkBuiltInAiAvailability();
      expect(result.guidance).toBeNull();
    });

    test('returns unavailable when availability() throws', async () => {
      mockLanguageModel.availability.mockRejectedValueOnce(new Error('boom'));
      const result = await checkBuiltInAiAvailability();
      expect(result.status).toBe('unavailable');
    });
  });

  describe('startBuiltInAiDownload', () => {
    test('returns unavailable without attempting download when LanguageModel is absent', async () => {
      delete (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel;
      const onProgress = vi.fn();
      const result = await startBuiltInAiDownload(onProgress);
      expect(result.status).toBe('unavailable');
      expect(onProgress).not.toHaveBeenCalled();
    });

    test('reports progress via downloadprogress events from monitor', async () => {
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

    test('returns unavailable when create() fails', async () => {
      mockLanguageModel.create.mockRejectedValueOnce(new Error('download failed'));
      const onProgress = vi.fn();
      const result = await startBuiltInAiDownload(onProgress);
      expect(result.status).toBe('unavailable');
    });

    test('does not reuse the destroyed session after download (calls session.destroy)', async () => {
      const session = createMockSession();
      mockLanguageModel.create.mockResolvedValueOnce(session);
      mockLanguageModel.availability.mockResolvedValue('available');

      await startBuiltInAiDownload(vi.fn());

      expect(session.destroy).toHaveBeenCalled();
    });
  });
});
