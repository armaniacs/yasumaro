/**
 * reloadGuard.test.ts
 *
 * PBI 2026-10-01-02: the bump-before-await / compare-after-await race guard
 * shared by the outer reload ring, the history model, and the navigation
 * registry. Pure logic, no DOM, no timers.
 */
import { describe, it, expect } from 'vitest';
import { ReloadGuard } from '../reloadGuard.js';

describe('ReloadGuard', () => {
  it('starts loads with live tokens', () => {
    const guard = new ReloadGuard();

    const token = guard.start();

    expect(guard.isCurrent(token)).toBe(true);
  });

  it('stales the previous token when a newer load starts', () => {
    const guard = new ReloadGuard();

    const first = guard.start();
    const second = guard.start();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it('invalidate discards in-flight loads without starting one', () => {
    const guard = new ReloadGuard();

    const token = guard.start();
    guard.invalidate();

    expect(guard.isCurrent(token)).toBe(false);
  });

  it('keeps guards independent across instances', () => {
    const first = new ReloadGuard();
    const second = new ReloadGuard();

    const token = first.start();
    second.start();

    expect(first.isCurrent(token)).toBe(true);
  });
});
