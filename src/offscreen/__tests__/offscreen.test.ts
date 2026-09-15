// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleOffscreenMessage } from '../offscreen.js';

// offscreen.ts imports each operation from the module that owns it, so the
// mocks have to be split the same way — mocking a single aggregate would not
// intercept the imports the router actually resolves.
vi.mock('../sqliteEngineHost.js', () => ({
    engine: {
        init: vi.fn().mockResolvedValue(true),
        resetForTesting: vi.fn(),
    },
}));

vi.mock('../recordsRepo.js', () => ({
    insert: vi.fn(),
    insertBatch: vi.fn(),
    query: vi.fn(),
    search: vi.fn(),
    update: vi.fn(),
    hardDelete: vi.fn(),
    toggleStar: vi.fn(),
    getCount: vi.fn(),
    getStatus: vi.fn(),
    serialize: vi.fn(),
    clearAll: vi.fn(),
}));

vi.mock('../dbMaintenance.js', () => ({
    backupDb: vi.fn(),
    restoreDb: vi.fn(),
    purgeOldRecords: vi.fn(),
    purgeContent: vi.fn(),
    sqliteHealthCheck: vi.fn(),
}));

vi.mock('../auditLogRepo.js', () => ({
    insertAuditLog: vi.fn(),
    queryAuditLog: vi.fn(),
}));

const noop = () => {};

function makeMessage(type: string, payload?: Record<string, unknown>) {
    return { target: 'offscreen', type, payload };
}

describe('handleOffscreenMessage - routing', () => {
    it('ignores non-object messages', () => {
        const result = handleOffscreenMessage('string', {} as chrome.runtime.MessageSender, noop);
        expect(result).toBe(false);
    });

    it('ignores null messages', () => {
        const result = handleOffscreenMessage(null, {} as chrome.runtime.MessageSender, noop);
        expect(result).toBe(false);
    });

    it('ignores messages without target field', () => {
        const result = handleOffscreenMessage({ type: 'UNKNOWN_TYPE' }, {} as chrome.runtime.MessageSender, noop);
        expect(result).toBe(false);
    });

    it('ignores messages targeted at other components', () => {
        const result = handleOffscreenMessage(
            { target: 'background', type: 'UNKNOWN_TYPE' },
            {} as chrome.runtime.MessageSender,
            noop
        );
        expect(result).toBe(false);
    });

    it('returns true for offscreen-targeted messages to keep channel open', () => {
        const result = handleOffscreenMessage(
            makeMessage('UNKNOWN_TYPE'),
            {} as chrome.runtime.MessageSender,
            noop
        );
        expect(result).toBe(true);
    });
});

describe('handleOffscreenMessage - unknown type', () => {
    it('returns error for unknown message type', async () => {
        const responses: unknown[] = [];
        handleOffscreenMessage(
            makeMessage('UNKNOWN_TYPE'),
            {} as chrome.runtime.MessageSender,
            (r) => responses.push(r)
        );
        await vi.waitFor(() => expect(responses.length).toBe(1));
        const resp = responses[0] as { success: boolean; error: string };
        expect(resp.success).toBe(false);
        expect(resp.error).toBe('Unknown message type');
    });

    it('returns error and does not crash for an unregistered SQLITE_-prefixed type', async () => {
        // isSqliteMessageType() must reject types that merely look like SQLite
        // messages (SQLITE_ prefix) but are not in the SqliteMessage union —
        // these fall through to the same "Unknown message type" path as any
        // other unrecognized type, not into handleSqliteMessage's switch.
        const responses: unknown[] = [];
        handleOffscreenMessage(
            makeMessage('SQLITE_NOT_A_REAL_TYPE'),
            {} as chrome.runtime.MessageSender,
            (r) => responses.push(r)
        );
        await vi.waitFor(() => expect(responses.length).toBe(1));
        const resp = responses[0] as { success: boolean; error: string };
        expect(resp.success).toBe(false);
        expect(resp.error).toBe('Unknown message type');
    });
});

describe('handleOffscreenMessage - Firefox extension pages in tabs (PBI 2026-09-14-09)', () => {
    // Regression pin for the Firefox dashboard rejection: Firefox attaches
    // sender.tab to extension pages running in normal tabs, and their sender
    // URLs use the moz-extension://<uuid>/ scheme. The offscreen sender gate
    // must accept them as extension pages, not reject them as content scripts.
    const FIREFOX_UUID = 'b3a95006-cdfd-49b8-95db-e75c94834b48';

    beforeEach(() => {
        (globalThis as unknown as Record<string, unknown>).chrome = {
            runtime: {
                id: 'test-extension-id',
                getURL: (path: string) => `moz-extension://${FIREFOX_UUID}/${path}`,
            },
        };
    });

    afterEach(() => {
        delete (globalThis as unknown as Record<string, unknown>).chrome;
    });

    it('does not reject SQLITE from a Firefox dashboard sender (tab + moz-extension URL)', async () => {
        const responses: unknown[] = [];
        handleOffscreenMessage(
            makeMessage('SQLITE_HEALTH_CHECK'),
            {
                id: 'test-extension-id',
                tab: { id: 3 },
                url: `moz-extension://${FIREFOX_UUID}/options.html?tab=history`,
            } as chrome.runtime.MessageSender,
            (r) => responses.push(r)
        );
        await vi.waitFor(() => expect(responses.length).toBe(1));
        const resp = responses[0] as { success: boolean; error?: string };
        // The sqliteHealthCheck mock resolves; what matters here is that the
        // sender gate did not fire — the content-script error must be absent.
        expect(String(resp.error ?? '')).not.toContain('content scripts');
    });

    it('still rejects SQLITE from a Firefox web page sender', async () => {
        const responses: unknown[] = [];
        handleOffscreenMessage(
            makeMessage('SQLITE_HEALTH_CHECK'),
            {
                id: 'test-extension-id',
                tab: { id: 3 },
                url: 'https://example.com/article',
            } as chrome.runtime.MessageSender,
            (r) => responses.push(r)
        );
        await vi.waitFor(() => expect(responses.length).toBe(1));
        const resp = responses[0] as { success: boolean; error?: string };
        expect(resp.success).toBe(false);
        expect(resp.error).toContain('content scripts');
    });
});

describe('handleOffscreenMessage - SQLITE_BACKUP', () => {
    beforeEach(() => {
        (globalThis as unknown as Record<string, unknown>).chrome = {
            runtime: { id: 'test-extension-id' },
        };
    });

    afterEach(() => {
        delete (globalThis as unknown as Record<string, unknown>).chrome;
    });

    it('converts Uint8Array to number[] so Chrome message passing serializes it correctly', async () => {
        const { backupDb } = await import('../dbMaintenance.js');
        const mockData = new Uint8Array([83, 81, 76, 105, 116, 101]); // "SQLite" bytes
        vi.mocked(backupDb).mockResolvedValue({ success: true, data: mockData });

        const responses: unknown[] = [];
        handleOffscreenMessage(
            makeMessage('SQLITE_BACKUP'),
            { id: 'test-extension-id' } as chrome.runtime.MessageSender,
            (r) => responses.push(r)
        );
        await vi.waitFor(() => expect(responses.length).toBe(1));

        const resp = responses[0] as { success: boolean; data: number[] };
        expect(resp.success).toBe(true);
        // Must be a plain Array, not Uint8Array — Chrome sendResponse cannot serialize TypedArrays
        expect(Array.isArray(resp.data)).toBe(true);
        expect(resp.data).toEqual([83, 81, 76, 105, 116, 101]);
    });

    it('passes through failure response unchanged', async () => {
        const { backupDb } = await import('../dbMaintenance.js');
        vi.mocked(backupDb).mockResolvedValue({ success: false, error: 'OPFS unavailable' });

        const responses: unknown[] = [];
        handleOffscreenMessage(
            makeMessage('SQLITE_BACKUP'),
            { id: 'test-extension-id' } as chrome.runtime.MessageSender,
            (r) => responses.push(r)
        );
        await vi.waitFor(() => expect(responses.length).toBe(1));

        const resp = responses[0] as { success: boolean; error: string };
        expect(resp.success).toBe(false);
        expect(resp.error).toBe('OPFS unavailable');
    });
});

describe('handleOffscreenMessage - SQLITE_RESTORE', () => {
    beforeEach(() => {
        (globalThis as unknown as Record<string, unknown>).chrome = {
            runtime: { id: 'test-extension-id' },
        };
    });

    afterEach(() => {
        delete (globalThis as unknown as Record<string, unknown>).chrome;
    });

    it('converts number[] back to Uint8Array and calls restoreDb', async () => {
        const { restoreDb } = await import('../dbMaintenance.js');
        vi.mocked(restoreDb).mockResolvedValue({ success: true });

        const responses: unknown[] = [];
        handleOffscreenMessage(
            makeMessage('SQLITE_RESTORE', { data: [1, 2, 3] }),
            { id: 'test-extension-id' } as chrome.runtime.MessageSender,
            (r) => responses.push(r)
        );
        await vi.waitFor(() => expect(responses.length).toBe(1));

        const resp = responses[0] as { success: boolean };
        expect(resp.success).toBe(true);
        // Verify restoreDb was called with Uint8Array (not number[])
        expect(restoreDb).toHaveBeenCalledWith(expect.any(Uint8Array));
    });

    it('passes through failure response unchanged', async () => {
        const { restoreDb } = await import('../dbMaintenance.js');
        vi.mocked(restoreDb).mockResolvedValue({ success: false, error: 'restore failed' });

        const responses: unknown[] = [];
        handleOffscreenMessage(
            makeMessage('SQLITE_RESTORE', { data: [9, 8, 7] }),
            { id: 'test-extension-id' } as chrome.runtime.MessageSender,
            (r) => responses.push(r)
        );
        await vi.waitFor(() => expect(responses.length).toBe(1));

        const resp = responses[0] as { success: boolean; error: string };
        expect(resp.success).toBe(false);
        expect(resp.error).toBe('restore failed');
    });

    // Note: restoreDb size cap (100MB) cannot be verified with real allocations in unit tests
    // (100M-element array would exceed Node.js memory). The guard is a simple length check
    // at offscreen.ts:SQLITE_RESTORE handler — verified by code review of the diff.
});
