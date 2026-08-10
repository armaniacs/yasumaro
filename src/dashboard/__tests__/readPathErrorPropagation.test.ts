// @vitest-environment jsdom
/**
 * readPathErrorPropagation.test.ts
 *
 * Locks the property PBI-19 exists to establish: on the read path, a failure
 * reaches the caller as a reason rather than as "no data".
 *
 * The bug class this guards against has recurred four times — three sites
 * fixed in v6.7.26, plus exportLogsPanel, which reported a broken database as
 * 「データがありません」.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryLogs, searchLogs, queryAuditLogs, backupDb } from '../dashboardSqliteService.js';

/** The categorized messages SqliteClient produces. */
const QUOTA = 'Storage quota exceeded. Some older records may have been removed.';
const TIMEOUT = 'SQLite request timed out. The database may still be initializing.';

/** Current sendMessage spy; reassigned per test, matching the sibling suites. */
let sendMessage: ReturnType<typeof vi.fn>;

/** Every call resolves to the same response. */
function givenResponse(response: unknown): void {
  sendMessage = vi.fn(() => Promise.resolve(response));
  (globalThis as unknown as { chrome: { runtime: { sendMessage: unknown } } })
    .chrome.runtime.sendMessage = sendMessage;
}

/** Successive calls resolve to the given responses in order. */
function givenResponses(...responses: unknown[]): void {
  let i = 0;
  sendMessage = vi.fn(() => Promise.resolve(responses[Math.min(i++, responses.length - 1)]));
  (globalThis as unknown as { chrome: { runtime: { sendMessage: unknown } } })
    .chrome.runtime.sendMessage = sendMessage;
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('read path surfaces the failure reason', () => {
  it('queryLogs returns the specific message, not an empty result', async () => {
    givenResponse({ success: false, error: QUOTA, retriable: false });

    const result = await queryLogs({ limit: 10 });

    expect(result).toEqual({ error: QUOTA });
    // A caller doing `result?.rows ?? []` must not be able to read this as empty.
    expect(result && 'rows' in result).toBe(false);
  });

  it('searchLogs returns the specific message', async () => {
    givenResponse({ success: false, error: QUOTA, retriable: false });

    expect(await searchLogs('x')).toEqual({ error: QUOTA });
  });

  it('queryAuditLogs reports the reason instead of collapsing to null', async () => {
    // The exportLogsPanel bug: null was indistinguishable from an empty log.
    givenResponse({ success: false, error: QUOTA });

    const result = await queryAuditLogs({ limit: 100 });

    expect(result).toEqual({ error: QUOTA });
    expect(result).not.toBeNull();
  });

  it('backupDb reports the reason instead of a missing file', async () => {
    givenResponse({ success: false, error: QUOTA });

    expect(await backupDb()).toEqual({ error: QUOTA });
  });

  it('still distinguishes a genuinely empty result from a failure', async () => {
    givenResponse({ success: true, rows: [], total: 0 });

    expect(await queryLogs({ limit: 10 })).toEqual({ data: { rows: [], total: 0 } });
  });
});

describe('retry follows the retriable flag, not the message text', () => {
  it('retries once when the service worker marks the failure transient', async () => {
    givenResponses(
      { success: false, error: TIMEOUT, retriable: true },
      { success: true, rows: [{ id: 1 }], total: 1 },
    );

    const result = await queryLogs({ limit: 10 });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ data: { rows: [{ id: 1 }], total: 1 } });
  });

  it('does not retry a deterministic failure', async () => {
    givenResponse({ success: false, error: QUOTA, retriable: false });

    await queryLogs({ limit: 10 });

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not retry merely because the message says "Query failed"', async () => {
    // The old condition matched this text. It was a fallback phrase, so the
    // retry fired for unclassifiable errors and stopped firing for the
    // initialization timeouts it was written for.
    givenResponse({ success: false, error: 'Query failed', retriable: false });

    await queryLogs({ limit: 10 });

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('retries a transient search failure', async () => {
    givenResponses(
      { success: false, error: TIMEOUT, retriable: true },
      { success: true, rows: [], total: 0 },
    );

    await searchLogs('x');

    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
