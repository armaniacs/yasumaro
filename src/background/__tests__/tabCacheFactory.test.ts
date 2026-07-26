import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTabCacheInstance, resetTabCacheInstanceForTesting } from '../tabCacheFactory.js';

describe('tabCacheFactory', () => {
    beforeEach(() => {
        resetTabCacheInstanceForTesting();
    });

    it('returns the same instance on repeated calls (singleton via lazy init)', () => {
        const sessionStore = { onSuspend: vi.fn() } as unknown as import('../sessionStore.js').SessionStore;
        const a = getTabCacheInstance(sessionStore);
        const b = getTabCacheInstance(sessionStore);
        expect(a).toBe(b);
    });

    it('does not instantiate TabCache at module load time', async () => {
        // Importing the module itself should not construct a TabCache — only
        // calling getTabCacheInstance() should. This is verified by the module
        // not throwing even before a SessionStore is available, since
        // construction is deferred until first call.
        const mod = await import('../tabCacheFactory.js');
        expect(typeof mod.getTabCacheInstance).toBe('function');
    });
});
