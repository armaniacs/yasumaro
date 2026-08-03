/**
 * privacyPipeline-pii-leak.test.ts
 *
 * PBI 2026-08-02-03: Verify the privacy pipeline never forwards raw PII to
 * a cloud AI provider.
 *
 * Invariant under test: in every mode where cloud AI is used, the content
 * passed to the cloud `generateSummary` call must be free of the raw PII
 * that entered the pipeline — both on the happy path and when local AI fails.
 */

import { PrivacyPipeline } from '../privacyPipeline.js';
import { vi } from 'vitest';

// Mock side-effectful / external modules used by privacyPipeline.
vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { WARN: 'warn', ERROR: 'error', INFO: 'info', DEBUG: 'debug', SANITIZE: 'sanitize' },
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock('../../utils/pendingStorage.js', () => ({
  addPendingPage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

// Pass-through prompt sanitization so it does not affect the PII invariant.
vi.mock('../../utils/promptSanitizer.js', () => ({
  sanitizePromptContent: vi.fn((text: string) => ({
    sanitized: typeof text === 'string' ? text : '',
    warnings: [],
    dangerLevel: 'low',
  })),
  DangerLevel: { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', SAFE: 'safe' },
}));

describe('PrivacyPipeline — PII must never reach cloud AI (PBI 2026-08-02-03)', () => {
  const RAW_PII = 'user@example.com';
  const MASKED_PII = '[EMAIL]';
  const PII_CONTENT = `Contact ${RAW_PII} for details.`;

  function makeMaskingSanitizers() {
    return {
      sanitizeRegex: vi.fn((text: string) => ({
        text: text.replace(RAW_PII, MASKED_PII),
        maskedItems: [{ type: 'email', value: RAW_PII }],
      })),
    };
  }

  function makeCloudService(summary = 'Cloud summary') {
    return {
      // @ts-expect-error - vi.fn() type narrowing issue
      getSupportedModes: vi.fn().mockReturnValue(['full_pipeline']),
      // @ts-expect-error - vi.fn() type narrowing issue
      generateSummary: vi.fn().mockResolvedValue({ summary }),
    };
  }

  it('never passes raw PII to cloud AI on the happy path', async () => {
    const sanitizers = makeMaskingSanitizers();
    const cloud = makeCloudService();
    const settings = { PRIVACY_MODE: 'full_pipeline' };
    const pipeline = new PrivacyPipeline(settings, cloud, sanitizers);

    await pipeline.process(PII_CONTENT);

    // Cloud receives the masked content only.
    const cloudArgs = cloud.generateSummary.mock.calls.map((c) => c[0]);
    for (const arg of cloudArgs) {
      expect(String(arg)).not.toContain(RAW_PII);
    }
    expect(cloud.generateSummary).toHaveBeenCalled();
    expect(sanitizers.sanitizeRegex).toHaveBeenCalledWith(PII_CONTENT);
  });

  it('still masks before cloud AI when local AI is unavailable (full_pipeline)', async () => {
    const sanitizers = makeMaskingSanitizers();
    // Local AI returns an empty summary → pipeline falls through to cloud.
    const cloud = makeCloudService();
    const local = {
      // @ts-expect-error - vi.fn() type narrowing issue
      getSupportedModes: vi.fn().mockReturnValue(['local_only', 'full_pipeline']),
      generateSummary: vi.fn().mockImplementation((_c: string, options?: { mode?: string }) => {
        if (options?.mode === 'local_only') {
          return Promise.resolve({ summary: '' }); // local unavailable
        }
        return Promise.resolve({ summary: 'Cloud summary' });
      }),
    };
    const settings = { PRIVACY_MODE: 'full_pipeline' };
    const pipeline = new PrivacyPipeline(settings, local, sanitizers);

    await pipeline.process(PII_CONTENT);

    const cloudArgs = local.generateSummary.mock.calls
      .filter((c) => (c[1] as { mode?: string })?.mode !== 'local_only')
      .map((c) => c[0]);
    expect(cloudArgs.length).toBeGreaterThan(0);
    for (const arg of cloudArgs) {
      expect(String(arg)).not.toContain(RAW_PII);
    }
  });

  it('in masked_cloud mode the local step is skipped but masking still applies before cloud', async () => {
    const sanitizers = makeMaskingSanitizers();
    const cloud = makeCloudService();
    const settings = { PRIVACY_MODE: 'masked_cloud' };
    const pipeline = new PrivacyPipeline(settings, cloud, sanitizers);

    await pipeline.process(PII_CONTENT);

    const cloudArgs = cloud.generateSummary.mock.calls.map((c) => c[0]);
    expect(cloudArgs.length).toBeGreaterThan(0);
    for (const arg of cloudArgs) {
      expect(String(arg)).not.toContain(RAW_PII);
    }
    // Masking ran even though no local AI step is present.
    expect(sanitizers.sanitizeRegex).toHaveBeenCalled();
  });
});
