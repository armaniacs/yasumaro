// @vitest-environment jsdom
/**
 * exportDateSsot.golden.test.ts (PBI 2026-09-21-12)
 * Golden pins of CURRENT behavior, written BEFORE the SSOT refactor.
 *
 * Timezone limitation: the literal 'YYYY-MM-DD' pins below assume the test
 * runner's local timezone is Asia/Tokyo (JST). The timestamps themselves carry
 * an explicit +09:00 offset, so the equivalence assertions
 * (exportMarkdown date === getLocalDateString(ts) === en-CA local string)
 * hold in ANY timezone; only the hardcoded '2026-09-21' literals are JST-bound.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryLogs = vi.fn();
vi.mock('../dashboardSqliteService.js', () => ({
  queryLogs: (...args: unknown[]) => mockQueryLogs(...args),
}));

vi.mock('../../utils/storage/encryptionSession.js', () => ({
  exportHmacSigner: {
    sign: vi.fn(async (payload: string) => `hmac(test-secret):${payload.length}`),
    verify: vi.fn(async () => true),
  },
}));

vi.mock('../settingsPipeline.js', () => ({
  saveDashboardSettings: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../utils/i18n.js', () => ({
  getMessage: vi.fn((key: string) => key),
}));

vi.mock('../statusView.js', () => ({
  syncStatusToTop: vi.fn(),
}));

vi.mock('../aiTestResultView.js', () => ({
  formatProviderHeadline: vi.fn(),
  formatProviderDetailLines: vi.fn(() => []),
}));

vi.mock('../aiTestProgressClient.js', () => ({
  subscribeAiTestProgress: vi.fn(() => vi.fn()),
  generateAiTestRunId: vi.fn(() => 'test-run-id'),
}));

vi.mock('../aiTestProgressView.js', () => ({
  buildAiTestProgressView: vi.fn(() => ({
    label: document.createElement('span'),
    elapsedEl: document.createElement('div'),
  })),
  renderAiTestProgressLabel: vi.fn(),
  renderAiTestProgressElapsed: vi.fn(),
}));

import { exportMarkdown } from '../exportLogsService.js';
import {
  getLocalDateString,
  groupEntriesByLocalDate,
} from '../markdownExport.js';
import type { BrowsingLogEntry } from '../dashboardSqliteService.js';
import { handleTestLocalMarkdown } from '../generalSettings/connectionTests.js';
import { StorageKeys } from '../../utils/storage/types.js';

/** 2026-09-21 00:30 JST — the midnight-boundary case from the PBI. */
const MIDNIGHT_TS = new Date('2026-09-21T00:30:00+09:00').getTime();
/** 2026-09-20 23:30 JST — falls on the previous local day. */
const BEFORE_MIDNIGHT_TS = new Date('2026-09-20T23:30:00+09:00').getTime();

function logRow(overrides: Partial<BrowsingLogEntry> = {}): BrowsingLogEntry {
  return {
    id: 7,
    url: 'https://example.com/midnight',
    title: 'Midnight Entry',
    summary: 'Boundary summary',
    tags: JSON.stringify(['tech', 'ai']),
    created_at: MIDNIGHT_TS,
    domain: 'example.com',
    is_starred: 0,
    ...overrides,
  } as BrowsingLogEntry;
}

describe('golden: exportMarkdown YAML output (pre-SSOT)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pins the full YAML block for a midnight-boundary entry', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [logRow()], total: 1 } });
    const result = await exportMarkdown();
    // JST-runner literal pin (see file header for the TZ limitation).
    expect(result).toBe(
      '---\n' +
        'title: "Midnight Entry"\n' +
        'url: "https://example.com/midnight"\n' +
        'date: "2026-09-21"\n' +
        'tags: ["tech", "ai"]\n' +
        '---\n' +
        '\n' +
        'Boundary summary\n',
    );
  });

  it('exportMarkdown date matches getLocalDateString for the boundary timestamps', async () => {
    for (const ts of [MIDNIGHT_TS, BEFORE_MIDNIGHT_TS]) {
      mockQueryLogs.mockResolvedValue({ data: { rows: [logRow({ created_at: ts })], total: 1 } });
      const result = await exportMarkdown();
      expect(result).toContain(`date: "${getLocalDateString(ts)}"`);
    }
  });

  it('en-CA Intl and manual-local derivations agree on the pinned timestamps', () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    for (const ts of [MIDNIGHT_TS, BEFORE_MIDNIGHT_TS]) {
      const viaIntl = new Date(ts).toLocaleDateString('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: tz,
      });
      expect(getLocalDateString(ts)).toBe(viaIntl);
    }
  });

  it('pins tag rendering: valid JSON array, invalid JSON, null', async () => {
    mockQueryLogs.mockResolvedValue({
      data: {
        rows: [
          logRow({ id: 1, tags: JSON.stringify(['tech', 'ai']) }),
          logRow({ id: 2, tags: '{invalid}' }),
          logRow({ id: 3, tags: null }),
        ],
        total: 3,
      },
    });
    const result = await exportMarkdown();
    expect(result).toContain('tags: ["tech", "ai"]');
    // Both the invalid-JSON and null rows fall back to an empty list.
    expect(result.split('tags: []')).toHaveLength(3);
  });
});

describe('golden: markdownExport grouping (pre-SSOT)', () => {
  it('buckets the two boundary rows into different local days', () => {
    const grouped = groupEntriesByLocalDate([
      logRow({ id: 1, created_at: BEFORE_MIDNIGHT_TS }),
      logRow({ id: 2, created_at: MIDNIGHT_TS }),
    ]);
    // JST-runner literal pin (see file header for the TZ limitation).
    expect([...grouped.keys()]).toEqual(['2026-09-20', '2026-09-21']);
    expect(grouped.get('2026-09-20')!.map((r) => r.id)).toEqual([1]);
    expect(grouped.get('2026-09-21')!.map((r) => r.id)).toEqual([2]);
  });

  it('grouping key always equals getLocalDateString of each row', () => {
    const rows = [
      logRow({ id: 1, created_at: BEFORE_MIDNIGHT_TS }),
      logRow({ id: 2, created_at: MIDNIGHT_TS }),
    ];
    const grouped = groupEntriesByLocalDate(rows);
    for (const row of rows) {
      expect([...grouped.keys()]).toContain(getLocalDateString(row.created_at));
    }
  });
});

describe('golden: connectionTests test-export filename (post-SSOT)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <button id="testLocalMarkdownBtnTop"></button>
      <div id="statusTop"></div>
      <form id="panel-general"></form>
    `;
    (globalThis.URL as any).createObjectURL = vi.fn(() => 'blob:mock-url');
    (globalThis.URL as any).revokeObjectURL = vi.fn();
  });

  it('pins the CURRENT filename date derivation (UTC via toISOString)', async () => {
    // 2026-09-20 23:00 UTC = 2026-09-21 08:00 JST: UTC and local days differ.
    const downloadMock = vi.fn().mockResolvedValue('id');
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({}),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      downloads: { download: downloadMock },
    };
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-20T23:00:00Z'));
      const repo = {
        getMany: vi.fn().mockResolvedValue({
          [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: true,
          [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: 'Yasumaro',
        }),
        getAll: vi.fn(),
      };
      const p = handleTestLocalMarkdown(repo);
      await vi.advanceTimersByTimeAsync(0);
      await p;
      const filename = downloadMock.mock.calls[0]?.[0].filename as string;
      // PBI 2026-09-21-12 intentional change: local date via getLocalDateString
      // (was UTC via toISOString). 2026-09-20 23:00 UTC = 2026-09-21 08:00 JST.
      // JST-runner literal pin (see file header for the TZ limitation).
      expect(filename).toBe('Yasumaro/test-2026-09-21.md');
      expect(filename).toBe(
        `Yasumaro/test-${getLocalDateString(new Date('2026-09-20T23:00:00Z').getTime())}.md`,
      );
      await vi.advanceTimersByTimeAsync(1000);
    } finally {
      vi.useRealTimers();
    }
  });
});
