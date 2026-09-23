/**
 * RemoteAIServiceSlotLog.test.ts — PBI 2026-09-22-04 follow-up.
 *
 * The cross-provider fallback chain is only debuggable if each failed slot
 * says who failed. Isolated file so the logger mock cannot disturb the
 * behavior tests in RemoteAIService.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../utils/logger/core.js', () => ({ addLog: vi.fn() }));
vi.mock('../../../utils/auditLog.js', () => ({ recordAuditLog: vi.fn() }));

import { RemoteAIService } from '../RemoteAIService.js';
import { addLog } from '../../../utils/logger/core.js';
import { LogType } from '../../../utils/logger/types.js';
import type { AIProviderStrategy } from '../providers/index.js';
import type { SettingsReader } from '../../../utils/storage/SettingsRepository.js';

function makeProvider(summary: string, success = true): AIProviderStrategy {
  return {
    generateSummary: vi.fn().mockResolvedValue({ success, summary }),
    testConnection: vi.fn().mockResolvedValue({ success, message: summary }),
  } as unknown as AIProviderStrategy;
}

function createService(slots: Array<{ provider: string; model?: string }>): RemoteAIService {
  const repo: SettingsReader = {
    getAll: vi.fn().mockResolvedValue({
      ai_provider_priority_list: slots,
      ai_provider: 'gemini',
      summary_min_length: 0,
    }),
    getMany: vi.fn(),
  };
  return new RemoteAIService({ repo });
}

describe('RemoteAIService slot-failure logging (PBI 2026-09-22-04 follow-up)', () => {
  it('logs provider+model for a failed middle slot, then returns the next success', async () => {
    const service = createService([{ provider: 'p1', model: 'm1' }, { provider: 'p2' }]);
    service.registerProvider('p1', () => makeProvider('nope', false));
    service.registerProvider('p2', () => makeProvider('yep'));

    const result = await service.generateSummary('content');

    expect(result.summary).toBe('yep');
    expect(addLog).toHaveBeenCalledWith(
      LogType.WARN,
      'AI provider slot failed, trying next provider',
      expect.objectContaining({ provider: 'p1', model: 'm1', index: 0, total: 2 }),
    );
  });

  it('logs nothing when the first slot succeeds', async () => {
    const service = createService([{ provider: 'p1' }]);
    service.registerProvider('p1', () => makeProvider('yep'));

    await service.generateSummary('content');

    expect(addLog).not.toHaveBeenCalledWith(
      LogType.WARN,
      'AI provider slot failed, trying next provider',
      expect.anything(),
    );
  });
});

describe('RemoteAIService — attemptedProviders trail (PBI 2026-09-22-04 follow-up)', () => {
  it('total failure carries the tried provider ids in attempt order', async () => {
    const service = createService([{ provider: 'fail1' }, { provider: 'fail2' }]);
    service.registerProvider('fail1', () => makeProvider('nope1', false));
    service.registerProvider('fail2', () => makeProvider('nope2', false));

    const result = await service.generateSummary('content');

    expect(result.success).toBe(false);
    expect(result.attemptedProviders).toEqual(['fail1', 'fail2']);
  });

  it('success path carries no trail (a provider produced the summary)', async () => {
    const service = createService([{ provider: 'ok' }]);
    service.registerProvider('ok', () => makeProvider('yep'));

    const result = await service.generateSummary('content');

    expect(result.attemptedProviders).toBeUndefined();
  });
});

describe('RemoteAIService — per-slot failure capture (PBI 2026-09-22-04 follow-up)', () => {
  it('captures each failed slot with its own error, even when a later slot succeeds', async () => {
    const service = createService([{ provider: 'p1', model: 'm1' }, { provider: 'p2' }]);
    service.registerProvider('p1', () => ({
      generateSummary: vi.fn().mockResolvedValue({
        success: false,
        summary: 'Error: Content blocked due to potential security risk. (原因: x)',
      }),
    } as never));
    service.registerProvider('p2', () => makeProvider('yep'));

    const result = await service.generateSummary('content');

    expect(result.success).toBe(true);
    expect(result.summary).toBe('yep');
    expect(result.slotFailures).toEqual([
      {
        provider: 'p1',
        model: 'm1',
        error: 'Error: Content blocked due to potential security risk. (原因: x)',
      },
    ]);
    expect(result.attemptedProviders).toBeUndefined(); // trail is total-failure only
  });

  it('total failure carries attemptedProviders AND per-slot errors (no masking)', async () => {
    const service = createService([{ provider: 'openai' }, { provider: 'built-in-ai' }]);
    service.registerProvider('openai', () => ({
      generateSummary: vi.fn().mockResolvedValue({
        success: false,
        summary: 'Error: Failed to generate summary. Please check your API settings.',
      }),
    } as never));
    service.registerProvider('built-in-ai', () => ({
      generateSummary: vi.fn().mockResolvedValue({
        success: false,
        summary: 'Prompt failed: An unknown error occurred: kErrorUnknown',
      }),
    } as never));

    const result = await service.generateSummary('content');

    expect(result.success).toBe(false);
    expect(result.attemptedProviders).toEqual(['openai', 'built-in-ai']);
    expect(result.slotFailures).toHaveLength(2);
    // The FIRST provider's error is no longer masked by the last slot's text.
    expect(result.slotFailures![0]!.error).toContain('check your API settings');
    expect(result.slotFailures![1]!.error).toContain('kErrorUnknown');
    expect(result.summary).toContain('kErrorUnknown'); // lastResult summary unchanged
  });

  it('a success-but-short summary is reported explicitly, not as the summary text', async () => {
    const service = createService([{ provider: 'short' }, { provider: 'ok' }]);
    // summary_min_length: 0 in createService — override to force the gate.
    const repo = (service as unknown as { repo: { getAll: ReturnType<typeof vi.fn> } }).repo;
    repo.getAll.mockResolvedValue({
      ai_provider_priority_list: [{ provider: 'short' }, { provider: 'ok' }],
      ai_provider: 'gemini',
      summary_min_length: 10,
    });
    service.registerProvider('short', () => ({
      generateSummary: vi.fn().mockResolvedValue({ success: true, summary: 'tiny' }),
    } as never));
    service.registerProvider('ok', () => makeProvider('long enough summary'));

    const result = await service.generateSummary('content');

    expect(result.summary).toBe('long enough summary');
    expect(result.slotFailures).toHaveLength(1);
    expect(result.slotFailures![0]!.error).toContain('summary too short');
    // The marker reports WHY it was skipped — not the summary text itself.
    expect(result.slotFailures![0]!.error).not.toContain('tiny');
  });
});
