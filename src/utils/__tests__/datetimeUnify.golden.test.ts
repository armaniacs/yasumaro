// @vitest-environment wasm-quickjs-dom
/**
 * datetimeUnify.golden.test.ts (PBI 2026-11-11-05)
 * Golden pins written BEFORE the seam unification (受け入れシナリオ 1-3)。
 *
 * 方針 (5 Whys #5): 新 seam は元 inline 式とバイト等価であること。
 * locale ソース (`undefined` = 実行時既定 / `navigator.language`) の
 * chrome UI 言語への正規化は表示文字列を変えうるため本 PBI では行わず、
 * 台帳送りとする。よって本 golden は等価性 (seam === 元式) を pin する:
 * タイムゾーン・実行時ロケールに依存せず、置換前後比較として成立する。
 *
 * - Scenario 1 (全画面の日付表示が変わらない): formatTimestamp /
 *   formatLocaleDateTime / formatMediumDateTime が元の inline 式と一致する。
 * - Scenario 3 (相対時刻表示が維持): localeUtils.formatTimeAgo が従来文字列
 *   (statusChecker の期待値と同一) を返す。popup 側は再exportであり、
 *   従来の `statusChecker.test.ts` がその経路を pin し続ける。
 * - Scenario 2 (data-date 契約): YYYY-MM-DD 形状を pin
 *   (委譲先 formatLocalDate)。sqliteHistoryPanelView.formatDate の委譲と
 *   data-date リテラルは既存 `sqliteHistoryViewWiringCycle.test.ts` が pin。
 */
process.env.TZ = 'Asia/Tokyo';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetUILanguage = vi.fn(() => 'en-US');

vi.mock('../i18n.js', async () => {
  const { mockGetMessage: i18nMock } = await import('../../../testDir/i18nMock.js');
  const getMessage = vi.fn((key: string, substitutions?: any) => {
    if (key === 'timeJustNow') return 'Just now';
    if (key === 'timeYesterday') return 'Yesterday';
    if (key.startsWith('timeMinutesAgo')) {
      return substitutions?.count !== undefined ? `${substitutions.count} minutes ago` : 'N minutes ago';
    }
    if (key.startsWith('timeHoursAgo')) {
      return substitutions?.count !== undefined ? `${substitutions.count} hours ago` : 'N hours ago';
    }
    if (key.startsWith('timeDaysAgo')) {
      return substitutions?.count !== undefined ? `${substitutions.count} days ago` : 'N days ago';
    }
    return '';
  });
  return { ...i18nMock(getMessage), tOrKey: (key: string) => key };
});

import {
  formatTimestamp,
  formatTimeAgo,
  formatLocaleDateTime,
  formatMediumDateTime,
} from '../localeUtils.js';
import { formatTimestamp as pendingFormatTimestamp } from '../pendingRowRenderer.js';
import { formatLocalDate } from '../localDate.js';

/** 2026-02-11 14:30 JST — locale/options の差が出やすい平日午後。 */
const TS = new Date('2026-02-11T14:30:00+09:00').getTime();

beforeEach(() => {
  mockGetUILanguage.mockReturnValue('en-US');
  (globalThis as any).chrome = { i18n: { getUILanguage: mockGetUILanguage } };
});

describe('golden: seam === original inline expression (表示文字列不変)', () => {
  it('formatTimestamp matches the pending-row inline expression byte-identically', () => {
    const original = new Date(TS).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(formatTimestamp(TS)).toBe(original);
  });

  it('pendingRowRenderer.formatTimestamp delegates to the localeUtils seam', () => {
    expect(pendingFormatTimestamp(TS)).toBe(formatTimestamp(TS));
  });

  it('formatLocaleDateTime matches the bare toLocaleString() inline sites', () => {
    // cleansingFeedbackView / exportImport / diagnosticsPanel /
    // researchSessionsPanel (range lines): `new Date(x).toLocaleString()`.
    expect(formatLocaleDateTime(TS)).toBe(new Date(TS).toLocaleString());
  });

  it('formatMediumDateTime matches the researchSessions summary-line expression', () => {
    // researchSessionsPanel:190:
    // `new Date(session.startAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })`.
    const original = new Date(TS).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    expect(formatMediumDateTime(TS)).toBe(original);
  });

  it('formatMediumDateTime accepts Date and string inputs like the original', () => {
    expect(formatMediumDateTime(new Date(TS))).toBe(formatMediumDateTime(TS));
    expect(formatMediumDateTime(new Date(TS).toISOString())).toBe(formatMediumDateTime(TS));
    expect(formatLocaleDateTime(new Date(TS))).toBe(formatLocaleDateTime(TS));
  });
});

describe('golden: formatTimeAgo keeps the popup strings (Scenario 3)', () => {
  const NOW = new Date('2026-02-11T14:30:00+09:00').getTime();
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it('returns "Just now" within a minute', () => {
    expect(formatTimeAgo(NOW - 30 * 1000).timeAgo).toBe('Just now');
  });

  it('returns "N minutes ago" within an hour', () => {
    expect(formatTimeAgo(NOW - 5 * 60 * 1000).timeAgo).toBe('5 minutes ago');
  });

  it('returns "N hours ago" within 24 hours', () => {
    expect(formatTimeAgo(NOW - 3 * 60 * 60 * 1000).timeAgo).toBe('3 hours ago');
  });

  it('returns "Yesterday" for the previous day', () => {
    expect(formatTimeAgo(NOW - 25 * 60 * 60 * 1000).timeAgo).toBe('Yesterday');
  });

  it('returns "N days ago" beyond 48 hours', () => {
    expect(formatTimeAgo(NOW - 3 * 24 * 60 * 60 * 1000).timeAgo).toBe('3 days ago');
  });

  it('formats today as HH:MM derived from the same Date fields', () => {
    const d = new Date(NOW - 10 * 60 * 1000);
    const expected = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    expect(formatTimeAgo(d.getTime()).formatted).toBe(expected);
  });

  it('formats other days as MM/DD HH:MM derived from the same Date fields', () => {
    const d = new Date(NOW - 5 * 24 * 60 * 60 * 1000);
    const expected =
      `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ` +
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    expect(formatTimeAgo(d.getTime()).formatted).toBe(expected);
  });
});

describe('golden: data-date contract stays YYYY-MM-DD (Scenario 2)', () => {
  it('formatLocalDate (the SSOT behind formatDate) keeps the YYYY-MM-DD shape', () => {
    for (const ts of [TS, Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31, 23, 59)]) {
      expect(formatLocalDate(new Date(ts))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(formatLocalDate(new Date(2026, 0, 15))).toBe('2026-01-15');
  });
});
