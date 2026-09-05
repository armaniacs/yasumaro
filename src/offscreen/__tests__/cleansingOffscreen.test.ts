// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanseHtmlOffscreen, handleCleansingOffscreenPayload, CLEANSING_OFFSCREEN_TYPE } from '../cleansingOffscreen.js';
import { handleOffscreenMessage } from '../offscreen.js';

// Mocks for sqlite dependencies required by offscreen.ts (same split as offscreen.test.ts)
vi.mock('../sqliteEngineHost.js', () => ({
    engine: {
        init: vi.fn().mockResolvedValue(true),
        resetForTesting: vi.fn(),
    },
}));
vi.mock('../recordsRepo.js', () => ({
    insert: vi.fn(), insertBatch: vi.fn(), query: vi.fn(), search: vi.fn(),
    update: vi.fn(), hardDelete: vi.fn(), toggleStar: vi.fn(), getCount: vi.fn(),
    getStatus: vi.fn(), serialize: vi.fn(), clearAll: vi.fn(),
}));
vi.mock('../dbMaintenance.js', () => ({
    backupDb: vi.fn(), restoreDb: vi.fn(), purgeOldRecords: vi.fn(), purgeContent: vi.fn(), sqliteHealthCheck: vi.fn(),
}));
vi.mock('../auditLogRepo.js', () => ({
    insertAuditLog: vi.fn(), queryAuditLog: vi.fn(),
}));

describe('cleanseHtmlOffscreen — pure DOM cleansing', () => {
    it('returns cleansed html string and result stats', () => {
        const html = '<div><p>Hello world</p><div class="ad-banner"><span>buy now</span></div><footer>footer</footer></div>';
        const { html: cleansed, result } = cleanseHtmlOffscreen(html);
        expect(typeof cleansed).toBe('string');
        expect(result.bytesBefore).toBeGreaterThan(0);
        expect(result.bytesAfter).toBeGreaterThan(0);
        expect(typeof result.totalRemoved).toBe('number');
        expect(result.removed).toBeDefined();
    });

    it('cleanse result matches sync execution parity (deterministic)', () => {
        const html = '<div><p>keep this content</p><nav>nav content</nav><div class="sidebar">sidebar</div></div>';
        const a = cleanseHtmlOffscreen(html);
        const b = cleanseHtmlOffscreen(html);
        expect(a.html).toBe(b.html);
        expect(a.result.totalRemoved).toBe(b.result.totalRemoved);
        expect(a.result.bytesBefore).toBe(b.result.bytesBefore);
        expect(a.result.bytesAfter).toBe(b.result.bytesAfter);
    });

    it('empty html does not throw', () => {
        const { html, result } = cleanseHtmlOffscreen('');
        expect(typeof html).toBe('string');
        expect(result.totalRemoved).toBe(0);
    });
});

describe('handleCleansingOffscreenPayload — validation', () => {
    it('returns failure for invalid payload', () => {
        const res = handleCleansingOffscreenPayload(null as unknown as Record<string, unknown>);
        expect(res.success).toBe(false);
    });

    it('returns success for valid html payload', () => {
        const res = handleCleansingOffscreenPayload({ html: '<p>hello</p>' });
        expect(res.success).toBe(true);
        if (res.success) {
            expect(typeof res.html).toBe('string');
            expect(typeof res.totalRemoved).toBe('number');
        }
    });

    it('propagates options to cleansing (deep flag)', () => {
        const html = '<div><p>text</p><div class="deep-noise">deep</div></div>';
        const without = handleCleansingOffscreenPayload({ html, options: { deepEnabled: false } });
        const withDeep = handleCleansingOffscreenPayload({ html, options: { deepEnabled: true } });
        expect(without.success).toBe(true);
        expect(withDeep.success).toBe(true);
    });
});

describe('handleOffscreenMessage — CLEANSING_OFFSCREEN routing', () => {
    it('routes CLEANSING_OFFSCREEN from content script (sender with tab) to cleansing handler', async () => {
        const responses: unknown[] = [];
        const sender = { tab: { id: 1 } } as unknown as chrome.runtime.MessageSender;
        const msg = { target: 'offscreen', type: CLEANSING_OFFSCREEN_TYPE, payload: { html: '<p>hello <nav>nav</nav></p>' } };

        const kept = handleOffscreenMessage(msg, sender, (r) => responses.push(r));
        expect(kept).toBe(true);
        await vi.waitFor(() => expect(responses.length).toBe(1));
        const resp = responses[0] as { success: boolean; html?: string };
        expect(resp.success).toBe(true);
        expect(typeof resp.html).toBe('string');
    });

    it('returns failure for invalid payload via message channel', async () => {
        const responses: unknown[] = [];
        const msg = { target: 'offscreen', type: CLEANSING_OFFSCREEN_TYPE, payload: { html: 123 as unknown as string } };
        handleOffscreenMessage(msg, {} as chrome.runtime.MessageSender, (r) => responses.push(r));
        await vi.waitFor(() => expect(responses.length).toBe(1));
        const resp = responses[0] as { success: boolean; error?: string };
        expect(resp.success).toBe(false);
        expect(resp.error).toMatch(/Invalid payload/);
    });

    it('offscreen payload result keeps DOM cleansing parity (bytes consistency)', async () => {
        const html = '<article><p>main content here with enough text to measure bytes</p><div class="ad">ad content</div></article>';
        const direct = cleanseHtmlOffscreen(html);
        const viaHandler = handleCleansingOffscreenPayload({ html });
        expect(viaHandler.success).toBe(true);
        if (viaHandler.success) {
            expect(viaHandler.bytesBefore).toBe(direct.result.bytesBefore);
            expect(viaHandler.bytesAfter).toBe(direct.result.bytesAfter);
            expect(viaHandler.totalRemoved).toBe(direct.result.totalRemoved);
        }
    });
});
