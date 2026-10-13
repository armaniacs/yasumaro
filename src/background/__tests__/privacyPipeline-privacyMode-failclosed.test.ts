/**
 * privacyPipeline-privacyMode-failclosed.test.ts
 *
 * PBI 2026-10-11-02: verify the mode → (masking, cloud) mapping is fail-closed.
 *
 * Invariant under test: whenever the pipeline talks to cloud AI, PII masking must
 * be enabled unless the user explicitly selected `cloud_only`. An unknown or
 * corrupted `privacy_mode` must behave like the default (`masked_cloud`), not
 * like `cloud_only`.
 */

import { PrivacyPipeline } from '../privacyPipeline.js';
import { vi } from 'vitest';
import type { AIService } from '../ai/AIService.js';
import type { Settings } from '../../utils/storage/types.js';

// Stubs implement only the two AIService methods the pipeline invokes.
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

// Pass-through prompt sanitization so it does not affect the masking invariant.
vi.mock('../../utils/promptSanitizer.js', () => ({
  sanitizePromptContent: vi.fn((text: string) => ({
    sanitized: typeof text === 'string' ? text : '',
    warnings: [],
    dangerLevel: 'low',
  })),
  DangerLevel: { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', SAFE: 'safe' },
}));

describe('PrivacyPipeline — privacy_mode fail-closed (PBI 2026-10-11-02)', () => {
  const RAW_PII = 'user@example.com';
  const MASKED_PII = '[MASKED:email]';
  const PII_CONTENT = `Contact ${RAW_PII} for details.`;

  function makeSanitizers() {
    return {
      sanitizeRegex: vi.fn((text: string) => ({
        text: text.replace(RAW_PII, MASKED_PII),
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

  const withMode = (mode: unknown): Settings =>
    ({ privacy_mode: mode }) as unknown as Settings;

  it('masks before cloud AI when privacy_mode is an unknown value', async () => {
    const sanitizers = makeSanitizers();
    const cloud = makeCloudService();
    const pipeline = new PrivacyPipeline(
      withMode('corrupt_mode_from_backup'),
      asAIService(cloud),
      asSanitizers(sanitizers),
    );

    await pipeline.process(PII_CONTENT);

    expect(sanitizers.sanitizeRegex).toHaveBeenCalledWith(PII_CONTENT);
    const cloudArgs = cloud.generateSummary.mock.calls.map((c) => String(c[0]));
    expect(cloudArgs.length).toBeGreaterThan(0);
    for (const arg of cloudArgs) {
      expect(arg).not.toContain(RAW_PII);
    }
  });

  it('masks before cloud AI when privacy_mode is missing', async () => {
    const sanitizers = makeSanitizers();
    const cloud = makeCloudService();
    const pipeline = new PrivacyPipeline(
      withMode(undefined),
      asAIService(cloud),
      asSanitizers(sanitizers),
    );

    await pipeline.process(PII_CONTENT);

    expect(sanitizers.sanitizeRegex).toHaveBeenCalledWith(PII_CONTENT);
    for (const arg of cloud.generateSummary.mock.calls.map((c) => String(c[0]))) {
      expect(arg).not.toContain(RAW_PII);
    }
  });

  it('still sends raw text when the user explicitly chose cloud_only', async () => {
    const sanitizers = makeSanitizers();
    const cloud = makeCloudService();
    const pipeline = new PrivacyPipeline(
      withMode('cloud_only'),
      asAIService(cloud),
      asSanitizers(sanitizers),
    );

    await pipeline.process(PII_CONTENT);

    expect(sanitizers.sanitizeRegex).not.toHaveBeenCalled();
    expect(cloud.generateSummary.mock.calls.map((c) => String(c[0]))).toContain(PII_CONTENT);
  });

  it('routes local_only to the local provider and still masks', async () => {
    const sanitizers = makeSanitizers();
    const cloud = makeCloudService();
    const pipeline = new PrivacyPipeline(
      withMode('local_only'),
      asAIService(cloud),
      asSanitizers(sanitizers),
    );

    await pipeline.process(PII_CONTENT);

    // The pipeline does not skip the AI call; it selects the local route via the
    // mode option. The masking invariant still holds.
    expect(sanitizers.sanitizeRegex).toHaveBeenCalledWith(PII_CONTENT);
    const options = cloud.generateSummary.mock.calls.map((c) => c[1] as { mode?: string });
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.mode).toBe('local_only');
    }
  });
});
