/**
 * promptSafety.test.ts
 * The prompt-safety policy matrix: one evaluation per call, level dispatch
 * per context, MEDIUM explicitly passing everywhere.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sanitizePromptContentMock, addLogMock } = vi.hoisted(() => ({
  sanitizePromptContentMock: vi.fn(),
  addLogMock: vi.fn(),
}));

vi.mock('../promptSanitizer.js', () => ({
  sanitizePromptContent: sanitizePromptContentMock,
  DangerLevel: { SAFE: 'safe', LOW: 'low', MEDIUM: 'medium', HIGH: 'high' },
}));
vi.mock('../logger.js', () => ({
  addLog: addLogMock,
  LogType: { ERROR: 'ERROR', WARN: 'WARN', INFO: 'INFO', DEBUG: 'DEBUG' },
}));

import { checkPromptSafety } from '../promptSafety.js';

function evaluateAs(level: string, warnings: string[] = ['w1']) {
  sanitizePromptContentMock.mockReturnValue({ sanitized: 'clean', warnings, dangerLevel: level });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkPromptSafety', () => {
  it('evaluates once and returns the verdict shape', () => {
    evaluateAs('safe', []);
    const verdict = checkPromptSafety('hello', 'cloud-summary');

    expect(sanitizePromptContentMock).toHaveBeenCalledTimes(1);
    expect(sanitizePromptContentMock).toHaveBeenCalledWith('hello');
    expect(verdict).toEqual({ blocked: false, sanitized: 'clean', warnings: [], level: 'safe' });
    expect(addLogMock).not.toHaveBeenCalled();
  });

  it('local-input blocks HIGH with ERROR and warns LOW', () => {
    evaluateAs('high');
    expect(checkPromptSafety('x', 'local-input', { traceId: 't' }).blocked).toBe(true);
    expect(addLogMock).toHaveBeenCalledWith(
      'ERROR',
      'Local AI blocked - high danger content detected',
      { warnings: ['w1'], traceId: 't' },
    );

    vi.clearAllMocks();
    evaluateAs('low');
    expect(checkPromptSafety('x', 'local-input', { traceId: 't' }).blocked).toBe(false);
    expect(addLogMock).toHaveBeenCalledWith(
      'WARN',
      'Local AI low-risk prompt injection detected',
      { warnings: ['w1'], traceId: 't', dangerLevel: 'low', category: 'generic_term' },
    );
  });

  it('local-summary warns HIGH without blocking', () => {
    evaluateAs('high');
    const verdict = checkPromptSafety('x', 'local-summary');

    expect(verdict.blocked).toBe(false);
    expect(verdict.sanitized).toBe('clean');
    expect(addLogMock).toHaveBeenCalledWith(
      'WARN',
      'Local AI summary sanitized - high danger content detected',
      { warnings: ['w1'] },
    );
  });

  it('cloud-summary warns HIGH and LOW', () => {
    evaluateAs('high');
    checkPromptSafety('x', 'cloud-summary');
    expect(addLogMock).toHaveBeenCalledWith(
      'WARN',
      'AI summary sanitized - high danger content detected',
      { warnings: ['w1'] },
    );

    vi.clearAllMocks();
    evaluateAs('low');
    checkPromptSafety('x', 'cloud-summary');
    expect(addLogMock).toHaveBeenCalledWith(
      'WARN',
      'AI summary low-risk prompt injection detected',
      { warnings: ['w1'], dangerLevel: 'low', category: 'generic_term' },
    );
  });

  it('provider-input warns on any warnings and blocks HIGH', () => {
    evaluateAs('low');
    expect(checkPromptSafety('x', 'provider-input', { providerName: 'p', traceId: 't' }).blocked).toBe(false);
    expect(addLogMock).toHaveBeenCalledWith(
      'WARN',
      '[p] Prompt injection detected: w1',
      { traceId: 't', dangerLevel: 'low', category: 'generic_term' },
    );

    vi.clearAllMocks();
    evaluateAs('high');
    expect(checkPromptSafety('x', 'provider-input', { providerName: 'p', traceId: 't' }).blocked).toBe(true);
    expect(addLogMock).toHaveBeenCalledWith(
      'ERROR',
      '[p] High risk prompt injection blocked: w1',
      { traceId: 't' },
    );
  });

  it('builtin-input blocks HIGH with WARN and warns LOW', () => {
    evaluateAs('high');
    expect(checkPromptSafety('x', 'builtin-input').blocked).toBe(true);
    expect(addLogMock).toHaveBeenCalledWith(
      'WARN',
      'Content blocked due to high danger level',
      { warnings: ['w1'], source: 'BuiltInAI' },
    );

    vi.clearAllMocks();
    evaluateAs('low');
    expect(checkPromptSafety('x', 'builtin-input').blocked).toBe(false);
    expect(addLogMock).toHaveBeenCalledWith(
      'WARN',
      'Low-risk prompt injection detected in built-in AI input',
      { warnings: ['w1'], source: 'BuiltInAI', dangerLevel: 'low', category: 'generic_term' },
    );
  });

  it('MEDIUM passes explicitly in every context', () => {
    for (const context of ['local-input', 'local-summary', 'cloud-summary', 'provider-input', 'builtin-input'] as const) {
      vi.clearAllMocks();
      evaluateAs('medium');
      // provider-input warns on any warnings — pass empty warnings to isolate MEDIUM.
      if (context === 'provider-input') evaluateAs('medium', []);
      const verdict = checkPromptSafety('x', context, { providerName: 'p', traceId: 't' });
      expect(verdict.blocked).toBe(false);
      expect(addLogMock).not.toHaveBeenCalled();
    }
  });
});
