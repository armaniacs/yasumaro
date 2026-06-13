import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimiter } from '../rateLimiter.js';
import { SessionStore } from '../sessionStore.js';

function makeSessionStore(): SessionStore {
  const map = new Map<string, unknown>();
  const store = {
    get: vi.fn((key: string) => Promise.resolve(map.get(key) ?? null)),
    set: vi.fn((key: string, value: unknown) => { map.set(key, value); return Promise.resolve(); }),
  } as unknown as SessionStore;
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
    const result = await rateLimiter.check({ url: 'https://example.com/page' }, settings);
    expect(result.allowed).toBe(true);
  });

  it('allows requests under the rate limit', async () => {
    for (let i = 0; i < 5; i++) {
      const result = await rateLimiter.check({ url: 'https://example.com/page' }, settings);
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks requests exceeding the rate limit (default max=5)', async () => {
    for (let i = 0; i < 5; i++) {
      await rateLimiter.check({ url: 'https://example.com/page' }, settings);
    }
    const result = await rateLimiter.check({ url: 'https://example.com/page' }, settings);
    expect(result.allowed).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('different origins have independent rate limits', async () => {
    for (let i = 0; i < 5; i++) {
      await rateLimiter.check({ url: 'https://example.com/page' }, settings);
    }
    const result = await rateLimiter.check({ url: 'https://other.com/page' }, settings);
    expect(result.allowed).toBe(true);
  });

  it('removeOrigin removes rate limit state for that origin', async () => {
    for (let i = 0; i < 5; i++) {
      await rateLimiter.check({ url: 'https://example.com/page' }, settings);
    }
    rateLimiter.removeOrigin('https://example.com');
    const result = await rateLimiter.check({ url: 'https://example.com/page' }, settings);
    expect(result.allowed).toBe(true);
  });

  it('removeTab is a deprecated no-op', async () => {
    for (let i = 0; i < 5; i++) {
      await rateLimiter.check({ url: 'https://example.com/page' }, settings);
    }
    rateLimiter.removeTab(1);
    const result = await rateLimiter.check({ url: 'https://example.com/page' }, settings);
    expect(result.allowed).toBe(false);
  });

  it('clear resets all rate limit state', async () => {
    for (let i = 0; i < 5; i++) {
      await rateLimiter.check({ url: 'https://example.com/page' }, settings);
    }
    rateLimiter.clear();
    const result = await rateLimiter.check({ url: 'https://example.com/page' }, settings);
    expect(result.allowed).toBe(true);
  });

  it('custom rate limit max from settings', async () => {
    const customSettings = { skip_ai_rate_limit_max: 2 };
    await rateLimiter.check({ url: 'https://example.com/page' }, customSettings);
    await rateLimiter.check({ url: 'https://example.com/page' }, customSettings);
    const result = await rateLimiter.check({ url: 'https://example.com/page' }, customSettings);
    expect(result.allowed).toBe(false);
  });

  it('initialize loads empty state when no session data exists', async () => {
    await rateLimiter.initialize();
    const result = await rateLimiter.check({ url: 'https://example.com/page' }, settings);
    expect(result.allowed).toBe(true);
  });
});

describe('RateLimiter — origin-based sender key (H4)', () => {
  let limiter: RateLimiter;
  let store: SessionStore;

  beforeEach(() => {
    store = makeSessionStore();
    limiter = new RateLimiter(store);
  });

  it('uses origin as the sender key, not tabId', async () => {
    const sender = { url: 'https://example.com/page1', tab: { id: 1 } };
    const result = await limiter.check(sender, {});
    expect(result.allowed).toBe(true);
    expect(limiter['state'].has('origin:https://example.com')).toBe(true);
  });

  it('rate limit applies across all tabs from the same origin', async () => {
    const settings = { skip_ai_rate_limit_max: 2 };
    await limiter.check({ url: 'https://example.com/p1' }, settings);
    await limiter.check({ url: 'https://example.com/p2' }, settings);
    const result = await limiter.check({ url: 'https://example.com/p3' }, settings);
    expect(result.allowed).toBe(false);
  });

  it('handles sender with no url gracefully', async () => {
    const result = await limiter.check(undefined, {});
    expect(result.allowed).toBe(true);
    expect(limiter['state'].has('origin:unknown')).toBe(true);
  });

  it('handles sender with invalid url gracefully', async () => {
    const result = await limiter.check({ url: 'not-a-url' }, {});
    expect(result.allowed).toBe(true);
    expect(limiter['state'].has('origin:unknown')).toBe(true);
  });

  it('persists state via sessionStore.set on check', async () => {
    await limiter.check({ url: 'https://example.com/' }, {});
    expect(store.set).toHaveBeenCalled();
  });
});
