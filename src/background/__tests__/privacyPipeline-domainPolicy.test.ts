/**
 * privacyPipeline-domainPolicy.test.ts
 *
 * PBI 2026-10-23-01: verify the per-domain egress policy seam.
 *
 * What is pinned:
 *   - a no-summary domain records the visit without any AI at all — neither
 *     local nor cloud summarization runs, and the result carries the applied
 *     policy;
 *   - a mask-required domain forces PII masking even in cloud_only mode (the
 *     one mode where masking is otherwise off), and the send rides the policy;
 *   - an allowed domain (and a domain without a row) behaves exactly like
 *     before — the policy rides the send as 'allowed'.
 */

import { PrivacyPipeline } from '../privacyPipeline.js';
import { vi } from 'vitest';
import type { AIService } from '../ai/AIService.js';
import type { Settings, AiDomainPolicy } from '../../utils/storage/types.js';

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

// Pass-through prompt sanitization so it does not affect the policy seam.
vi.mock('../../utils/promptSanitizer.js', () => ({
  sanitizePromptContent: vi.fn((text: string) => ({
    sanitized: typeof text === 'string' ? text : '',
    warnings: [],
    dangerLevel: 'low',
  })),
  DangerLevel: { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', SAFE: 'safe' },
}));

describe('PrivacyPipeline — per-domain egress policy (PBI 2026-10-23-01)', () => {
  const RAW_PII = 'user@example.com';
  const MASKED_PII = '[MASKED:email]';
  const PII_CONTENT = `Contact ${RAW_PII} for details.`;
  const URL = 'https://example.com/page';

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

  const withPolicy = (map: unknown): Settings =>
    ({ privacy_mode: 'cloud_only', ai_domain_policy: map }) as unknown as Settings;

  it('records a no-summary domain without any AI at all', async () => {
    const sanitizers = makeSanitizers();
    const cloud = makeCloudService();
    const pipeline = new PrivacyPipeline(
      withPolicy({ 'example.com': 'no-summary' }),
      asAIService(cloud),
      asSanitizers(sanitizers),
    );

    const result = await pipeline.process(PII_CONTENT, { url: URL });

    expect(cloud.generateSummary).not.toHaveBeenCalled();
    expect(result.aiSucceeded).toBe(false);
    expect(result.domainPolicy).toBe('no-summary');
  });

  it('forces masking on a mask-required domain even in cloud_only mode', async () => {
    const sanitizers = makeSanitizers();
    const cloud = makeCloudService();
    const pipeline = new PrivacyPipeline(
      withPolicy({ 'example.com': 'mask-required' }),
      asAIService(cloud),
      asSanitizers(sanitizers),
    );

    const result = await pipeline.process(PII_CONTENT, { url: URL });

    expect(sanitizers.sanitizeRegex).toHaveBeenCalledWith(PII_CONTENT);
    const sent = cloud.generateSummary.mock.calls.map((c) => String(c[0]));
    expect(sent.length).toBeGreaterThan(0);
    for (const arg of sent) {
      expect(arg).not.toContain(RAW_PII);
    }
    expect(result.domainPolicy).toBe('mask-required');
  });

  it('rides the applied policy on the send so the ledger records the verdict', async () => {
    const sanitizers = makeSanitizers();
    const cloud = makeCloudService();
    const pipeline = new PrivacyPipeline(
      withPolicy({ 'example.com': 'mask-required' }),
      asAIService(cloud),
      asSanitizers(sanitizers),
    );

    await pipeline.process(PII_CONTENT, { url: URL });

    const options = cloud.generateSummary.mock.calls.map((c) => c[1] as { policy?: string });
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.policy).toBe('mask-required');
    }
  });

  it.each([
    ['an allowed row', { 'example.com': 'allowed' }],
    ['a domain without a row', { 'other.com': 'mask-required' }],
  ])('sends as configured on %s (policy rides as allowed)', async (_label, map) => {
    const sanitizers = makeSanitizers();
    const cloud = makeCloudService();
    const pipeline = new PrivacyPipeline(
      withPolicy(map),
      asAIService(cloud),
      asSanitizers(sanitizers),
    );

    const result = await pipeline.process(PII_CONTENT, { url: URL });

    expect(cloud.generateSummary).toHaveBeenCalled();
    const options = cloud.generateSummary.mock.calls.map((c) => c[1] as { policy?: string });
    for (const option of options) {
      expect(option.policy).toBe('allowed');
    }
    expect(result.domainPolicy).toBe('allowed');
  });
});
