import { describe, it, expect } from 'vitest';
import { buildIssueReportBody } from '../issueReportLink.js';
import type { DiagnosticsSnapshot } from '../DiagnosticsCollector.js';
import { ErrorCode } from '../../../../utils/logger.js';
import { LogType, type LogEntry } from '../../../../utils/logger/types.js';

function baseSnapshot(overrides: Partial<DiagnosticsSnapshot> = {}): DiagnosticsSnapshot {
  return {
    storage: { bytesUsedKb: '100', savedUrls: '5' },
    sqlite: {
      initialized: true,
      path: 'OPFS:/test.db',
      fallback: false,
      fts5: true,
    },
    deficiencies: [],
    builtInAi: null,
    obsidian: { protocol: 'https', port: '27124', apiKey: 'super-secret-api-key', dailyPath: '/Users/private/vault/daily' },
    aiProviders: [{ provider: 'gemini', model: 'gemini-2.0-flash', label: 'Gemini' }],
    aiProviderDetails: [
      { provider: 'gemini', model: 'gemini-2.0-flash', label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'gemini-secret-key' },
    ],
    extInfo: { version: '6.8.20', name: 'Yasumaro' },
    divergence: { dashboardDetectsOpfs: true, offscreenUsesFallback: false },
    settingsLoadFailed: false,
    debugMode: false,
    ...overrides,
  };
}

function logEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 'log-1',
    timestamp: Date.now(),
    type: LogType.ERROR,
    message: 'something went wrong with secret-token-xyz',
    ...overrides,
  };
}

describe('buildIssueReportBody', () => {
  it('includes non-sensitive diagnostic fields', () => {
    const body = buildIssueReportBody(baseSnapshot(), []);

    expect(body).toContain('6.8.20');
    expect(body).toContain('SQLite');
    expect(body).toContain('gemini');
  });

  it('never includes AI provider API keys', () => {
    const body = buildIssueReportBody(baseSnapshot(), []);
    expect(body).not.toContain('gemini-secret-key');
  });

  it('never includes the Obsidian API key', () => {
    const body = buildIssueReportBody(baseSnapshot(), []);
    expect(body).not.toContain('super-secret-api-key');
  });

  it('never includes the Obsidian daily note path', () => {
    const body = buildIssueReportBody(baseSnapshot(), []);
    expect(body).not.toContain('/Users/private/vault/daily');
  });

  it('never includes AI provider base URLs', () => {
    const body = buildIssueReportBody(baseSnapshot(), []);
    expect(body).not.toContain('https://generativelanguage.googleapis.com');
  });

  it('includes the Obsidian protocol and port but not the api key field value', () => {
    const body = buildIssueReportBody(baseSnapshot(), []);
    expect(body).toContain('https');
    expect(body).toContain('27124');
  });

  it('summarizes recent error codes by name and count, never log message contents', () => {
    const logs: LogEntry[] = [
      logEntry({ errorCode: ErrorCode.INTERNAL_ERROR, message: 'contains secret-token-xyz' }),
      logEntry({ errorCode: ErrorCode.INTERNAL_ERROR, message: 'contains secret-token-xyz again' }),
      logEntry({ errorCode: ErrorCode.API_TIMEOUT, message: 'unrelated' }),
    ];

    const body = buildIssueReportBody(baseSnapshot(), logs);

    expect(body).toContain(ErrorCode.INTERNAL_ERROR);
    expect(body).toContain('2');
    expect(body).toContain(ErrorCode.API_TIMEOUT);
    expect(body).not.toContain('secret-token-xyz');
  });

  it('handles an empty log list without throwing', () => {
    expect(() => buildIssueReportBody(baseSnapshot(), [])).not.toThrow();
  });

  it('handles missing/undefined optional snapshot fields gracefully', () => {
    const snapshot = baseSnapshot({
      sqlite: null,
      builtInAi: null,
      aiProviderDetails: [],
      aiProviders: [],
    });

    expect(() => buildIssueReportBody(snapshot, [])).not.toThrow();
    const body = buildIssueReportBody(snapshot, []);
    expect(body).not.toContain('undefined');
  });

  it('handles a provider detail with no apiKey/baseUrl set', () => {
    const snapshot = baseSnapshot({
      aiProviderDetails: [{ provider: 'ollama', model: 'llama3', label: 'Ollama' }],
    });

    const body = buildIssueReportBody(snapshot, []);
    expect(body).toContain('ollama');
  });

  it('stays within a reasonable length for a GitHub issue URL query parameter', () => {
    const manyLogs: LogEntry[] = Array.from({ length: 50 }, (_, i) =>
      logEntry({ errorCode: ErrorCode.INTERNAL_ERROR, message: `error number ${i}` })
    );
    const body = buildIssueReportBody(baseSnapshot(), manyLogs);
    expect(body.length).toBeLessThan(4000);
  });
});
