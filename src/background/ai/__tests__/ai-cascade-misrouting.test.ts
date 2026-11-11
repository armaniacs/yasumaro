import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemoteAIService } from '../RemoteAIService.js';
import { FallbackAIService } from '../FallbackAIService.js';
import type { AIProviderStrategy } from '../providers/index.js';
import type { AIService } from '../AIService.js';
import type { Settings } from '../../../utils/storage/types.js';
import type { SettingsReader } from '../../../utils/storage/SettingsRepository.js';
import { createProviderStrategy } from '../providerCatalog.js';
import { addLog } from '../../../utils/logger/core.js';
import { recordAuditLog } from '../../../utils/auditLog.js';
import { LogType } from '../../../utils/logger/types.js';

vi.mock('../../../utils/auditLog.js', () => ({ recordAuditLog: vi.fn() }));
vi.mock('../../../utils/logger/core.js', () => ({ addLog: vi.fn() }));

function makeRepo(settings: Record<string, unknown>): SettingsReader {
  return {
    getAll: vi.fn().mockResolvedValue(settings),
    getMany: vi.fn(),
  };
}

type FakeMap = Record<string, (settings: Settings) => AIProviderStrategy>;

function dispatch(fakes: FakeMap): (providerId: string, settings: Settings) => AIProviderStrategy {
  return (providerId: string, settings: Settings) => {
    const fake = fakes[providerId];
    if (fake) return fake(settings);
    return createProviderStrategy(providerId, settings);
  };
}

function createService(fakes: FakeMap) {
  return new RemoteAIService({
    repo: makeRepo({
      ai_provider_priority_list: [{ provider: 'test' }],
      ai_provider: 'test',
      summary_min_length: 0,
    }),
    createStrategy: dispatch(fakes),
  });
}

/** Open gate so concurrent generateSummary calls overlap in flight. */
function gatedEcho() {
  let callCount = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const strategy = {
    generateSummary: vi.fn().mockImplementation(async (content: string) => {
      callCount++;
      await gate;
      return { success: true, summary: `echo:${content}` };
    }),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
  } as unknown as AIProviderStrategy;
  return { strategy, release, calls: () => callCount };
}

function mockRemote(summary: string): AIService {
  return {
    generateSummary: vi.fn().mockResolvedValue({ success: true, summary }),
    getSupportedModes: vi.fn().mockReturnValue(['full_pipeline']),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok', providers: [] }),
  };
}

describe('AI cascade misrouting (pbi/2026-11-11-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shares in-flight requests with identical content for the same URL', async () => {
    const echo = gatedEcho();
    const service = createService({ test: () => echo.strategy });
    const url = 'https://example.com/shared';

    const p1 = service.generateSummary('same-content', { url });
    const p2 = service.generateSummary('same-content', { url });
    echo.release();
    const [r1, r2] = await Promise.all([p1, p2]);

    // Golden: same content keeps the API-cost optimization (single send).
    expect(echo.calls()).toBe(1);
    expect(r1).toBe(r2);
  });

  it('does not share in-flight requests when content differs for the same URL', async () => {
    const echo = gatedEcho();
    const service = createService({ test: () => echo.strategy });
    const url = 'https://example.com/shared';

    const pA = service.generateSummary('content-A', { url });
    const pB = service.generateSummary('content-B', { url });
    echo.release();
    const [rA, rB] = await Promise.all([pA, pB]);

    expect(echo.calls()).toBe(2);
    expect(rA.summary).toContain('content-A');
    expect(rB.summary).toContain('content-B');
  });

  it('logs WARN and returns the remote result when local throws in auto mode', async () => {
    const local: AIService = {
      generateSummary: vi.fn().mockRejectedValue(new Error('local down')),
      getSupportedModes: vi.fn().mockReturnValue(['local_only']),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok', providers: [] }),
    };
    const remote = mockRemote('remote fallback');
    const fallback = new FallbackAIService({ local, remote });

    const result = await fallback.generateSummary('test content', { mode: 'auto' });

    expect(result.summary).toBe('remote fallback');
    expect(addLog).toHaveBeenCalledWith(
      LogType.WARN,
      expect.stringMatching(/falling back to remote/i),
      expect.objectContaining({ error: expect.stringContaining('local down') }),
    );
  });

  it('logs WARN and returns the remote result when local returns success:false in auto mode', async () => {
    const local: AIService = {
      generateSummary: vi.fn().mockResolvedValue({ success: false, summary: 'local failed' }),
      getSupportedModes: vi.fn().mockReturnValue(['local_only']),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok', providers: [] }),
    };
    const remote = mockRemote('remote fallback');
    const fallback = new FallbackAIService({ local, remote });

    const result = await fallback.generateSummary('test content', { mode: 'auto' });

    expect(result.summary).toBe('remote fallback');
    expect(addLog).toHaveBeenCalledWith(
      LogType.WARN,
      expect.stringMatching(/falling back to remote/i),
      expect.anything(),
    );
  });

  it('surfaces an audit-log send failure instead of dropping it silently', async () => {
    vi.mocked(recordAuditLog).mockRejectedValueOnce(new Error('sqlite down'));
    const echo = gatedEcho();
    const service = createService({ test: () => echo.strategy });

    const pending = service.generateSummary('content', { url: 'https://example.com/audit' });
    echo.release();
    const result = await pending;

    // Summary still succeeds; the failure must be detectable, not silent.
    expect(result.success).toBe(true);
    expect(addLog).toHaveBeenCalledWith(
      LogType.WARN,
      expect.stringMatching(/audit/i),
      expect.anything(),
    );
  });
});
