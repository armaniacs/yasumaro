/**
 * privacyPipeline-parity.test.ts
 *
 * Parity anchor for PBI 2026-11-20-03 (PrivacyPipeline pure-function split).
 * Written BEFORE the extraction: pins the CURRENT branching, masking, and
 * output decisions of `PrivacyPipeline.process()` through its public
 * contract, so the refactor can prove byte-identical observable behavior.
 *
 * Uses the same AI/sanitizer mock style as the existing pipeline suites.
 * These tests must pass unchanged before AND after the split.
 */

import { PrivacyPipeline, DEGENERATE_SUMMARY_FALLBACK } from '../privacyPipeline.js';
import { vi } from 'vitest';
import type { AIService } from '../ai/AIService.js';
import { StorageKeys } from '../../utils/storage/types.js';
import type { Settings } from '../../utils/storage/types.js';
import { addPendingPage } from '../../utils/pendingStorage.js';

const asAIService = (mock: Pick<AIService, 'getSupportedModes' | 'generateSummary'>): AIService =>
  mock as AIService;

type SanitizersArg = ConstructorParameters<typeof PrivacyPipeline>[2];
const asSanitizers = (mock: { sanitizeRegex: (text: string) => unknown }): SanitizersArg =>
  mock as unknown as SanitizersArg;

vi.mock('../../utils/logger/types.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    LogType: { WARN: 'warn', ERROR: 'error', INFO: 'info', DEBUG: 'debug', SANITIZE: 'sanitize' },
    logError: 'fn',
    logWarn: 'fn',
    logInfo: 'fn',
    logDebug: 'fn',
  }),
);
vi.mock('../../utils/logger/core.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    LogType: { WARN: 'warn', ERROR: 'error', INFO: 'info', DEBUG: 'debug', SANITIZE: 'sanitize' },
    logError: 'fn',
    logWarn: 'fn',
    logInfo: 'fn',
    logDebug: 'fn',
  }),
);
vi.mock('../../utils/logger/api.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    LogType: { WARN: 'warn', ERROR: 'error', INFO: 'info', DEBUG: 'debug', SANITIZE: 'sanitize' },
    logError: 'fn',
    logWarn: 'fn',
    logInfo: 'fn',
    logDebug: 'fn',
  }),
);

vi.mock('../../utils/pendingStorage.js', () => ({
  addPendingPage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

// Pass-through prompt sanitization so safety policy does not alter text.
vi.mock('../../utils/promptSanitizer.js', () => ({
  sanitizePromptContent: vi.fn((text: string) => ({
    sanitized: typeof text === 'string' ? text : '',
    warnings: [],
    dangerLevel: 'low',
  })),
  DangerLevel: { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', SAFE: 'safe' },
}));

const RAW_PII = 'user@example.com';
const MASKED_PII = '[MASKED:email]';
const PII_CONTENT = `Contact ${RAW_PII} for details.`;
const URL = 'https://example.com/page';

function makeSanitizers() {
  return {
    sanitizeRegex: vi.fn((text: string) => ({
      text: String(text).replace(RAW_PII, MASKED_PII),
      maskedItems: [{ type: 'email', value: RAW_PII }],
    })),
  };
}

function makeCloudService(summary = 'Cloud summary') {
  return {
    getSupportedModes: vi.fn().mockReturnValue(['full_pipeline']),
    generateSummary: vi.fn().mockResolvedValue({ summary }),
  };
}

function makeLocalService(summary: string | undefined) {
  return {
    getSupportedModes: vi.fn().mockReturnValue(['local_only']),
    generateSummary: vi.fn().mockResolvedValue({ summary }),
  };
}

const settingsFor = (mode: string, extra: Record<string, unknown> = {}): Settings =>
  ({ [StorageKeys.PRIVACY_MODE]: mode, ...extra }) as unknown as Settings;

describe('PrivacyPipeline parity anchor (pre-split behavior)', () => {
  beforeEach(() => {
    vi.mocked(addPendingPage).mockClear();
  });

  describe('branching decisions per privacy mode', () => {
    it.each([
      ['full_pipeline', true, true],
      ['masked_cloud', true, true],
      ['local_only', true, false],
      ['cloud_only', false, true],
    ])('mode %s: masking=%s cloud=%s', async (mode, wantMask, wantCloud) => {
      const sanitizers = makeSanitizers();
      const cloud = makeCloudService();
      const local = makeLocalService('Local summary');
      const ai = {
        getSupportedModes: vi.fn().mockReturnValue(['local_only', 'full_pipeline']),
        generateSummary: vi.fn().mockImplementation((_c: string, o?: { mode?: string }) =>
          o?.mode === 'local_only' ? local.generateSummary(_c, o) : cloud.generateSummary(_c, o),
        ),
      };
      const pipeline = new PrivacyPipeline(settingsFor(mode), asAIService(ai), asSanitizers(sanitizers));

      const result = await pipeline.process(PII_CONTENT, { url: URL });

      if (wantMask) {
        expect(sanitizers.sanitizeRegex).toHaveBeenCalledWith(PII_CONTENT);
        // local_only returns early from local summarization without maskedCount.
        if (mode === 'local_only') {
          expect(result.maskedCount).toBeUndefined();
        } else {
          expect(result.maskedCount).toBe(1);
        }
      } else {
        expect(sanitizers.sanitizeRegex).not.toHaveBeenCalled();
        expect(result.maskedCount ?? 0).toBe(0);
      }
      if (wantCloud) {
        expect(cloud.generateSummary).toHaveBeenCalled();
      } else {
        expect(cloud.generateSummary).not.toHaveBeenCalled();
      }
      expect(result.mode).toBe(mode);
      // local_only returns early from local summarization without domainPolicy.
      if (mode === 'local_only') {
        expect(result.domainPolicy).toBeUndefined();
      } else {
        expect(result.domainPolicy).toBe('allowed');
      }
    });

    it('alreadyProcessed disables masking and local AI but keeps cloud', async () => {
      const sanitizers = makeSanitizers();
      const cloud = makeCloudService();
      const pipeline = new PrivacyPipeline(
        settingsFor('full_pipeline'),
        asAIService(cloud),
        asSanitizers(sanitizers),
      );

      const result = await pipeline.process(PII_CONTENT, { url: URL, alreadyProcessed: true });

      expect(sanitizers.sanitizeRegex).not.toHaveBeenCalled();
      expect(cloud.generateSummary).toHaveBeenCalledWith(PII_CONTENT, expect.anything());
      expect(result.maskedCount ?? 0).toBe(0);
    });

    it('mask-required domain forces masking even in cloud_only mode', async () => {
      const sanitizers = makeSanitizers();
      const cloud = makeCloudService();
      const pipeline = new PrivacyPipeline(
        settingsFor('cloud_only', { ai_domain_policy: { 'example.com': 'mask-required' } }),
        asAIService(cloud),
        asSanitizers(sanitizers),
      );

      const result = await pipeline.process(PII_CONTENT, { url: URL });

      expect(sanitizers.sanitizeRegex).toHaveBeenCalledWith(PII_CONTENT);
      const sent = cloud.generateSummary.mock.calls.map((c) => String(c[0]));
      expect(sent.length).toBeGreaterThan(0);
      for (const arg of sent) expect(arg).not.toContain(RAW_PII);
      expect(result.domainPolicy).toBe('mask-required');
    });

    it('no-summary domain runs no AI at all', async () => {
      const sanitizers = makeSanitizers();
      const cloud = makeCloudService();
      const pipeline = new PrivacyPipeline(
        settingsFor('full_pipeline', { ai_domain_policy: { 'example.com': 'no-summary' } }),
        asAIService(cloud),
        asSanitizers(sanitizers),
      );

      const result = await pipeline.process(PII_CONTENT, { url: URL });

      expect(cloud.generateSummary).not.toHaveBeenCalled();
      expect(result.aiSucceeded).toBe(false);
      expect(result.domainPolicy).toBe('no-summary');
    });
  });

  describe('local-ai-unavailable throw+save contract', () => {
    it('local_only with empty local summary saves pending and throws', async () => {
      const sanitizers = makeSanitizers();
      const local = makeLocalService('');
      const pipeline = new PrivacyPipeline(
        settingsFor('local_only'),
        asAIService(local),
        asSanitizers(sanitizers),
      );

      await expect(
        pipeline.process('content', { url: URL, title: 'T' }),
      ).rejects.toThrow('Local AI unavailable');

      expect(addPendingPage).toHaveBeenCalledTimes(1);
      expect(addPendingPage).toHaveBeenCalledWith(
        expect.objectContaining({
          url: URL,
          title: 'T',
          reason: 'local-ai-unavailable',
          errorMessage: 'Local AI summarization failed',
        }),
      );
    });

    it('full_pipeline with empty local summary does NOT throw and falls through to cloud', async () => {
      const sanitizers = makeSanitizers();
      const local = makeLocalService('');
      const cloud = makeCloudService();
      const ai = {
        getSupportedModes: vi.fn().mockReturnValue(['local_only', 'full_pipeline']),
        generateSummary: vi.fn().mockImplementation((_c: string, o?: { mode?: string }) =>
          o?.mode === 'local_only' ? local.generateSummary(_c, o) : cloud.generateSummary(_c, o),
        ),
      };
      const pipeline = new PrivacyPipeline(settingsFor('full_pipeline'), asAIService(ai), asSanitizers(sanitizers));

      const result = await pipeline.process('content', { url: URL });

      expect(cloud.generateSummary).toHaveBeenCalled();
      expect(addPendingPage).not.toHaveBeenCalled();
      expect(result.summary).toBe('Cloud summary');
    });
  });

  describe('cloud output decisions', () => {
    it('extracts tags and normalizes newlines', async () => {
      const cloud = makeCloudService('1行目\n\n2行目\n3行目');
      const pipeline = new PrivacyPipeline(
        settingsFor('masked_cloud'),
        asAIService(cloud),
        asSanitizers(makeSanitizers()),
      );

      const result = await pipeline.process('content', { url: URL });

      expect(result.summary).not.toContain('\n');
      expect(result.summary).toBe('1行目');
    });

    it('substitutes the degenerate fallback when the guard fires', async () => {
      const spam = Array(40).fill('crypto crypto crypto deal').join(' ');
      const cloud = makeCloudService(spam);
      const pipeline = new PrivacyPipeline(
        settingsFor('masked_cloud'),
        asAIService(cloud),
        asSanitizers(makeSanitizers()),
      );

      const result = await pipeline.process('content', { url: URL });

      expect(result.summary).toBe(DEGENERATE_SUMMARY_FALLBACK);
    });

    it('aiSucceeded is true only on real success; failure metadata passes through, never throws', async () => {
      const failure = { kind: 'all-failed', retryable: true };
      const cloud = {
        getSupportedModes: vi.fn().mockReturnValue(['full_pipeline']),
        generateSummary: vi.fn().mockResolvedValue({
          summary: 'provider exploded',
          success: false,
          failure,
        }),
      };
      const pipeline = new PrivacyPipeline(
        settingsFor('masked_cloud'),
        asAIService(cloud),
        asSanitizers(makeSanitizers()),
      );

      const result = await pipeline.process('content', { url: URL });

      expect(result.aiSucceeded).toBe(false);
      expect(result.failure).toEqual(failure);
      // The AI failure text is not rewritten into a note-friendly error here;
      // the caller contract reports it as a normal result with aiSucceeded=false.
      expect(result.summary).toBe('provider exploded');
    });

    it('empty content short-circuits without any AI or masking', async () => {
      const sanitizers = makeSanitizers();
      const cloud = makeCloudService();
      const pipeline = new PrivacyPipeline(
        settingsFor('full_pipeline'),
        asAIService(cloud),
        asSanitizers(sanitizers),
      );

      const result = await pipeline.process('');

      expect(result.summary).toBe('Summary not available.');
      expect(result.aiSucceeded).toBe(false);
      expect(sanitizers.sanitizeRegex).not.toHaveBeenCalled();
      expect(cloud.generateSummary).not.toHaveBeenCalled();
    });

    it('previewOnly returns masked content without AI', async () => {
      const sanitizers = makeSanitizers();
      const cloud = makeCloudService();
      const pipeline = new PrivacyPipeline(
        settingsFor('full_pipeline'),
        asAIService(cloud),
        asSanitizers(sanitizers),
      );

      const result = await pipeline.process(PII_CONTENT, { previewOnly: true });

      expect(result.preview).toBe(true);
      expect(result.processedContent).toBe(MASKED_PII_CONTENT);
      expect(result.maskedCount).toBe(1);
      expect(cloud.generateSummary).not.toHaveBeenCalled();
      expect(result.aiCallDurationMs).toBeUndefined();
    });
  });
});

const MASKED_PII_CONTENT = PII_CONTENT.replace(RAW_PII, MASKED_PII);
