import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimiter } from '../rateLimiter.js';
import { SessionStore } from '../sessionStore.js';

function makeSessionStore(): SessionStore {
  const map = new Map<string, unknown>();
  const store = {
    get: vi.fn((key: string) => Promise.resolve(map.get(key) ?? null)),
    set: vi.fn((key: string, value: unknown) => { map.set(key, value); return Promise.resolve(); }),
  } as unknown as SessionStore;
  // Expose static method used in persist()
  (SessionStore as unknown as Record<string, unknown>).mapToEntries = vi.fn(
    (m: Map<string, unknown>) => [...m.entries()]
  );
  return store;
}

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;
  let sessionStore: SessionStore;
  const settings = {};

  beforeEach(() => {
    sessionStore = makeSessionStore();
    rateLimiter = new RateLimiter(sessionStore);
  });

  it('allows first request for a new sender', async () => {
    const result = await rateLimiter.check('tab:1', settings);
    expect(result.allowed).toBe(true);
  });

  it('allows requests under the rate limit', async () => {
    for (let i = 0; i < 5; i++) {
      const result = await rateLimiter.check('tab:1', settings);
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks requests exceeding the rate limit (default max=5)', async () => {
    // デフォルト SKIP_AI_MAX は 5（appConstants.ts）
    for (let i = 0; i < 5; i++) {
      await rateLimiter.check('tab:1', settings);
    }
    const result = await rateLimiter.check('tab:1', settings);
    expect(result.allowed).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('different senders have independent rate limits', async () => {
    for (let i = 0; i < 5; i++) {
      await rateLimiter.check('tab:1', settings);
    }
    // tab:2 はまだカウントゼロなので許可される
    const result = await rateLimiter.check('tab:2', settings);
    expect(result.allowed).toBe(true);
  });

  it('removeTab removes rate limit state for that tab', async () => {
    for (let i = 0; i < 5; i++) {
      await rateLimiter.check('1', settings);
    }
    rateLimiter.removeTab(1);
    // 削除後は再びカウントゼロから開始
    const result = await rateLimiter.check('1', settings);
    expect(result.allowed).toBe(true);
  });

  it('clear resets all rate limit state', async () => {
    for (let i = 0; i < 5; i++) {
      await rateLimiter.check('tab:1', settings);
    }
    rateLimiter.clear();
    const result = await rateLimiter.check('tab:1', settings);
    expect(result.allowed).toBe(true);
  });

  it('custom rate limit max from settings', async () => {
    const customSettings = { skip_ai_rate_limit_max: 2 };
    await rateLimiter.check('tab:1', customSettings);
    await rateLimiter.check('tab:1', customSettings);
    const result = await rateLimiter.check('tab:1', customSettings);
    expect(result.allowed).toBe(false);
  });

  it('initialize loads empty state when no session data exists', async () => {
    await rateLimiter.initialize();
    const result = await rateLimiter.check('tab:1', settings);
    expect(result.allowed).toBe(true);
  });
});
