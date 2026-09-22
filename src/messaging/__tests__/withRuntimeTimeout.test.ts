import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRuntimeTimeout } from '../withRuntimeTimeout.js';

describe('withRuntimeTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('passes through the resolved value when the operation wins', async () => {
    const result = await withRuntimeTimeout(Promise.resolve({ ok: 1 }), 1000, new Error('TO'));
    expect(result).toEqual({ ok: 1 });
  });

  it('propagates the operation rejection when it wins', async () => {
    await expect(
      withRuntimeTimeout(Promise.reject(new Error('boom')), 1000, new Error('TO')),
    ).rejects.toThrow('boom');
  });

  it('rejects with the timeout error when the timer wins', async () => {
    // Mark handled up front so the late loser rejection cannot surface as an
    // unhandled rejection (the exact bug this seam exists to fix) — and mark
    // `pending` handled before advancing, since the fake timer rejects it
    // mid-advance (late expect().rejects attachment trips Node's tracker).
    const never = new Promise<never>(() => undefined);
    const pending = withRuntimeTimeout(never, 60_000, new Error('GATEWAY_TIMEOUT'));
    void pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(pending).rejects.toThrow('GATEWAY_TIMEOUT');
  });
});
