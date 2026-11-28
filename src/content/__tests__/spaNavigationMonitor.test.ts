/**
 * spaNavigationMonitor.test.ts
 * PBI 2026-11-28-02: SpaNavigationMonitor 協調クラスの純粋契約 pin。
 * モックなし (deps の readUrl/onNavigation を注入)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SpaNavigationMonitor,
  stripUrlFragment,
  shouldResetForUrlChange,
} from '../spaNavigationMonitor.js';

function makeMonitor(opts?: {
  readUrl?: () => string | null;
  onNavigation?: () => void;
  timer?: { setInterval: (cb: () => void, ms: number) => ReturnType<typeof setInterval>; clearInterval: (id: ReturnType<typeof setInterval>) => void };
}): { monitor: SpaNavigationMonitor; onNavigation: ReturnType<typeof vi.fn> } {
  const onNavigation = vi.fn();
  const monitor = new SpaNavigationMonitor({
    readUrl: opts?.readUrl ?? (() => null),
    onNavigation: opts?.onNavigation ?? onNavigation,
    timer: opts?.timer ?? { setInterval: () => 0 as ReturnType<typeof setInterval>, clearInterval: () => {} },
  });
  return { monitor, onNavigation };
}

describe('stripUrlFragment (pure function)', () => {
  it('strips the hash fragment', () => {
    expect(stripUrlFragment('https://example.com/page#anchor')).toBe('https://example.com/page');
  });

  it('returns the URL unchanged when there is no fragment', () => {
    expect(stripUrlFragment('https://example.com/page')).toBe('https://example.com/page');
  });
});

describe('shouldResetForUrlChange (pure function)', () => {
  it('returns true on a fragment-stripped URL change', () => {
    expect(shouldResetForUrlChange('https://example.com/b', 'https://example.com/a')).toBe(true);
  });

  it('returns false on a hash-only change', () => {
    expect(shouldResetForUrlChange('https://example.com/a#b', 'https://example.com/a')).toBe(false);
  });

  it('returns false on the first observation (null lastUrl)', () => {
    expect(shouldResetForUrlChange('https://example.com/a', null)).toBe(false);
  });
});

describe('SpaNavigationMonitor', () => {
  let monitor: SpaNavigationMonitor;
  let onNavigation: ReturnType<typeof vi.fn>;
  let currentUrl: string | null;

  beforeEach(() => {
    currentUrl = 'https://example.com/page-a';
    const result = makeMonitor({
      readUrl: () => currentUrl,
      onNavigation: () => onNavigation(),
    });
    monitor = result.monitor;
    onNavigation = result.onNavigation;
  });

  it('records the first URL without firing onNavigation', () => {
    const changed = monitor.pollOnce();
    expect(changed).toBe(false);
    expect(onNavigation).not.toHaveBeenCalled();
  });

  it('fires onNavigation on a true URL change', () => {
    monitor.pollOnce();
    currentUrl = 'https://example.com/page-b';
    const changed = monitor.pollOnce();
    expect(changed).toBe(true);
    expect(onNavigation).toHaveBeenCalledTimes(1);
  });

  it('does not fire onNavigation on a hash-only change', () => {
    monitor.pollOnce();
    currentUrl = 'https://example.com/page-a#section';
    const changed = monitor.pollOnce();
    expect(changed).toBe(false);
    expect(onNavigation).not.toHaveBeenCalled();
  });

  it('returns the last observed URL', () => {
    monitor.pollOnce();
    currentUrl = 'https://example.com/page-b';
    monitor.pollOnce();
    expect(monitor.getLastUrl()).toBe('https://example.com/page-b');
  });

  it('startPolling polls on the interval and stopPolling stops it', () => {
    const callbacks: Array<() => void> = [];
    const timer = {
      setInterval: (cb: () => void, _ms: number) => { callbacks.push(cb); return callbacks.length as ReturnType<typeof setInterval>; },
      clearInterval: (id: ReturnType<typeof setInterval>) => { callbacks[Number(id) - 1] = () => {}; },
    };
    const m = new SpaNavigationMonitor({
      readUrl: () => currentUrl,
      onNavigation: () => onNavigation(),
      timer,
    });
    currentUrl = 'https://example.com/a';
    m.pollOnce();
    currentUrl = 'https://example.com/b';
    m.startPolling(2000, timer);
    callbacks[0]();
    expect(onNavigation).toHaveBeenCalled();
    m.stopPolling();
    // stopPolling clears the interval: the fake noop callback replaces the
    // polling callback, so a post-stop invocation never fires onNavigation.
    callbacks[0]();
    expect(onNavigation).toHaveBeenCalledTimes(1);
  });
});
