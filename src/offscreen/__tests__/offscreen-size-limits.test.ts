// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleOffscreenMessage } from '../offscreen.js';

vi.mock('../recordsRepo.js', () => ({
    update: vi.fn(),
}));

const noop = () => {};

function makeMessage(type: string, payload?: Record<string, unknown>) {
    return { target: 'offscreen', type, payload };
}

describe('VULN-001: SQLITE_UPDATE size cap', () => {
    beforeEach(() => {
        (globalThis as unknown as Record<string, unknown>).chrome = {
            runtime: { id: 'test-extension-id' },
        };
    });

    afterEach(() => {
        delete (globalThis as unknown as Record<string, unknown>).chrome;
    });

    it('rejects update when summary exceeds 1MB', async () => {
        const { update } = await import('../recordsRepo.js');
        vi.mocked(update).mockResolvedValue({ success: true });
        const oversizedSummary = 'a'.repeat(1024 * 1024 + 1);

        const responses: unknown[] = [];
        handleOffscreenMessage(
            makeMessage('SQLITE_UPDATE', { id: 1, summary: oversizedSummary }),
            { id: 'test-extension-id' } as chrome.runtime.MessageSender,
            (r) => responses.push(r)
        );
        await vi.waitFor(() => expect(responses.length).toBe(1));

        const resp = responses[0] as { success: boolean; error?: string };
        // Before fix: update() is called and returns {success:true}, so resp.success === true (FAILS this assertion)
        // After fix: guard rejects before update(), so resp.success === false (PASSES)
        expect(resp.success).toBe(false);
        expect(resp.error).toMatch(/Payload too large|exceeds/i);
        expect(update).not.toHaveBeenCalled();
    });

    it('allows update when summary is under 1MB', async () => {
        const { update } = await import('../recordsRepo.js');
        vi.mocked(update).mockResolvedValue({ success: true });
        const normalSummary = 'a'.repeat(100);

        const responses: unknown[] = [];
        handleOffscreenMessage(
            makeMessage('SQLITE_UPDATE', { id: 1, summary: normalSummary }),
            { id: 'test-extension-id' } as chrome.runtime.MessageSender,
            (r) => responses.push(r)
        );
        await vi.waitFor(() => expect(responses.length).toBe(1));

        const resp = responses[0] as { success: boolean };
        expect(resp.success).toBe(true);
        expect(update).toHaveBeenCalled();
    });
});
