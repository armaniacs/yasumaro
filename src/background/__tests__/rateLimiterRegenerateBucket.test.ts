/**
 * rateLimiterRegenerateBucket.test.ts — Ask N3-B (PBI 2026-09-22-04).
 *
 * The default-key behavior itself stays pinned by rateLimiter.test.ts; this
 * file only proves the NEW bucket is an independent counter on the same
 * shared limit keys (dashboard regenerate bursts must not starve popup
 * manual records, and vice versa).
 */
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
    (m: Map<string, unknown>) => [...m.entries()],
  );
  return store;
}

describe('RateLimiter — regenerate bucket (CRITICAL: bucket separation)', () => {
  let limiter: RateLimiter;
  // Shared limit key on purpose (Ask N3-B: counters separate, caps shared).
  const settings = { skip_ai_rate_limit_max: 2 };
  const sender = { url: 'https://example.com/page' };

  beforeEach(() => {
    limiter = new RateLimiter(makeSessionStore());
  });

  it('exhausting the default bucket leaves the regenerate bucket allowed (and vice versa)', async () => {
    // Exhaust the default bucket (max 2).
    expect((await limiter.check(sender, settings)).allowed).toBe(true);
    expect((await limiter.check(sender, settings)).allowed).toBe(true);
    expect((await limiter.check(sender, settings)).allowed).toBe(false);

    // Independent counter: the regenerate bucket starts fresh on the same origin.
    expect((await limiter.check(sender, settings, { bucket: 'regenerate' })).allowed).toBe(true);
    expect((await limiter.check(sender, settings, { bucket: 'regenerate' })).allowed).toBe(true);
    expect((await limiter.check(sender, settings, { bucket: 'regenerate' })).allowed).toBe(false);
  });

  it('the shared cap applies to the regenerate bucket too', async () => {
    expect((await limiter.check(sender, settings, { bucket: 'regenerate' })).allowed).toBe(true);
    expect((await limiter.check(sender, settings, { bucket: 'regenerate' })).allowed).toBe(true);
    const third = await limiter.check(sender, settings, { bucket: 'regenerate' });
    expect(third.allowed).toBe(false);
    expect(third.error).toBeDefined();
  });

  it('different origins stay independent inside the bucket', async () => {
    await limiter.check({ url: 'https://a.example/' }, settings, { bucket: 'regenerate' });
    await limiter.check({ url: 'https://a.example/' }, settings, { bucket: 'regenerate' });
    expect(
      (await limiter.check({ url: 'https://a.example/' }, settings, { bucket: 'regenerate' })).allowed,
    ).toBe(false);
    expect(
      (await limiter.check({ url: 'https://b.example/' }, settings, { bucket: 'regenerate' })).allowed,
    ).toBe(true);
  });

  it('omitting the bucket keeps the legacy call signature working', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await limiter.check(sender, {})).allowed).toBe(true);
    }
    expect((await limiter.check(sender, {})).allowed).toBe(false);
  });
});
