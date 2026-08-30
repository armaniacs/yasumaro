// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanseViaOffscreen, cleanseHtmlSync, isCleansingOffscreenEnabled } from '../cleansingOffscreenDelegate.js';
import { cleanseHtmlOffscreen } from '../../offscreen/cleansingOffscreen.js';

function setChromeMock(opts: {
    storageGet?: (key: string) => Promise<Record<string, unknown>>;
    sendMessage?: (msg: unknown) => Promise<unknown>;
}) {
    const storageGet = opts.storageGet ?? (async () => ({}));
    const sendMessage = opts.sendMessage ?? (async () => ({ success: true, html: '<p>offscreen</p>' }));
    (globalThis as unknown as Record<string, unknown>).chrome = {
        storage: {
            local: {
                get: vi.fn().mockImplementation((key: unknown) => {
                    const k = typeof key === 'string' ? key : Array.isArray(key) ? (key as string[])[0] : Object.keys(key as Record<string, unknown>)[0];
                    return (storageGet as (k: string) => Promise<Record<string, unknown>>)(k as string);
                }),
            },
        },
        runtime: {
            sendMessage: vi.fn().mockImplementation(sendMessage as unknown as (...args: unknown[]) => unknown),
            id: 'test-extension-id',
        },
    };
}

describe('isCleansingOffscreenEnabled — feature flag', () => {
    afterEach(() => {
        delete (globalThis as unknown as Record<string, unknown>).chrome;
        vi.restoreAllMocks();
    });

    it('returns false when storage flag is absent (default OFF)', async () => {
        setChromeMock({ storageGet: async () => ({}) });
        expect(await isCleansingOffscreenEnabled()).toBe(false);
    });

    it('returns true when storage flag is true', async () => {
        setChromeMock({ storageGet: async () => ({ cleansing_offscreen_enabled: true }) });
        expect(await isCleansingOffscreenEnabled()).toBe(true);
    });

    it('returns false when chrome is undefined', async () => {
        delete (globalThis as unknown as Record<string, unknown>).chrome;
        expect(await isCleansingOffscreenEnabled()).toBe(false);
    });
});

describe('cleanseViaOffscreen — delegation with fallback', () => {
    afterEach(() => {
        delete (globalThis as unknown as Record<string, unknown>).chrome;
        vi.restoreAllMocks();
    });

    it('when feature flag OFF: returns sync fallback and does not call sendMessage', async () => {
        const html = '<p>hello</p><nav>nav</nav>';
        const expected = cleanseHtmlSync(html);
        const sendMessage = vi.fn(async () => ({ success: true, html: '<p>from-offscreen</p>' }));
        setChromeMock({
            storageGet: async () => ({ cleansing_offscreen_enabled: false }),
            sendMessage,
        });

        const result = await cleanseViaOffscreen(html);
        expect(result).toBe(expected);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('when feature flag ON and offscreen succeeds: returns offscreen html', async () => {
        const html = '<div><p>hello</p></div>';
        const offscreenHtml = '<div><p>cleaned by offscreen</p></div>';
        setChromeMock({
            storageGet: async () => ({ cleansing_offscreen_enabled: true }),
            sendMessage: async () => ({ success: true, html: offscreenHtml }),
        });

        const result = await cleanseViaOffscreen(html);
        expect(result).toBe(offscreenHtml);
    });

    it('when feature flag ON but offscreen throws: falls back to sync', async () => {
        const html = '<div><p>fallback test</p><div class="ad-banner">ad</div></div>';
        const expected = cleanseHtmlSync(html);
        setChromeMock({
            storageGet: async () => ({ cleansing_offscreen_enabled: true }),
            sendMessage: async () => { throw new Error('offscreen unavailable'); },
        });

        const result = await cleanseViaOffscreen(html);
        expect(result).toBe(expected);
    });

    it('when offscreen returns failure shape: falls back to sync', async () => {
        const html = '<p>failure shape</p><nav>nav</nav>';
        const expected = cleanseHtmlSync(html);
        setChromeMock({
            storageGet: async () => ({ cleansing_offscreen_enabled: true }),
            sendMessage: async () => ({ success: false, error: 'Unknown message type' }),
        });

        const result = await cleanseViaOffscreen(html);
        expect(result).toBe(expected);
    });

    it('when chrome.runtime is missing: falls back to sync', async () => {
        const html = '<p>no runtime</p>';
        const expected = cleanseHtmlSync(html);
        (globalThis as unknown as Record<string, unknown>).chrome = {
            storage: {
                local: { get: vi.fn(async () => ({ cleansing_offscreen_enabled: true })) },
            },
            // no runtime
        } as unknown as typeof chrome;

        const result = await cleanseViaOffscreen(html);
        expect(result).toBe(expected);
    });

    it('sync fallback is deterministic and matches pure offscreen function', async () => {
        const html = '<article><p>content</p><div class="ad">ad</div><footer>footer</footer></article>';
        // fallback path when OFF should equal direct pure call
        setChromeMock({ storageGet: async () => ({ cleansing_offscreen_enabled: false }) });
        const viaDelegate = await cleanseViaOffscreen(html);
        const direct = cleanseHtmlOffscreen(html).html;
        expect(viaDelegate).toBe(direct);
    });
});

describe('cleanseHtmlSync — parity with offscreen pure function', () => {
    it('produces same html as cleanseHtmlOffscreen', () => {
        const html = '<div><p>parity</p><nav>nav to remove</nav></div>';
        expect(cleanseHtmlSync(html)).toBe(cleanseHtmlOffscreen(html).html);
    });
});
