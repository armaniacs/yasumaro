// @vitest-environment jsdom
/**
 * statusTimerRace.test.ts
 *
 * PBI 2026-09-28-19 (a): showStatus fired a bare setTimeout and kept no handle,
 * so a second render on the same element left the first deadline running — the
 * error message of the 5s default could be blanked 3s in by the success timer
 * that preceded it. The pending clear now belongs to the element, and a render
 * that asks for no auto-clear cancels whatever was already scheduled.
 *
 * Driven by the fake clock from testDir/waitPolicy.ts; no real-time waits.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTimerClock } from '../../../../testDir/waitPolicy.js';
import { showStatus } from '../settingsUiHelper.js';

function setupDom(): void {
  document.body.innerHTML = [
    '<div id="first"></div>',
    '<div id="second"></div>',
  ].join('\n');
}

const first = (): HTMLElement => document.getElementById('first')!;
const second = (): HTMLElement => document.getElementById('second')!;

beforeEach(() => {
  setupDom();
  useTimerClock();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('showStatus clear timer ownership', () => {
  it('lets the newer message outlive the older message deadline', () => {
    showStatus(first(), 'Saved!', 'success');
    showStatus(first(), 'Failed!', 'error');

    vi.advanceTimersByTime(3000);
    expect(first().textContent).toBe('Failed!');
    expect(first().className).toBe('status-message error');

    vi.advanceTimersByTime(1999);
    expect(first().textContent).toBe('Failed!');

    vi.advanceTimersByTime(1);
    expect(first().textContent).toBe('');
    expect(first().className).toBe('status-message');
  });

  it('cancels the pending clear when a render asks for no auto-clear', () => {
    showStatus(first(), 'Saved!', 'success');
    showStatus(first(), 'Stays put', 'error', { autoClear: false });

    vi.advanceTimersByTime(60000);

    expect(first().textContent).toBe('Stays put');
    expect(first().className).toBe('status-message error');
  });

  it('keeps a no-auto-clear message past its own would-be deadline too', () => {
    showStatus(first(), 'Stays put', 'success', { durationMs: 2000, autoClear: false });

    vi.advanceTimersByTime(60000);

    expect(first().textContent).toBe('Stays put');
  });

  it('scopes the pending clear to its own element', () => {
    showStatus(first(), 'First saved!', 'success');
    showStatus(second(), 'Second failed!', 'error');

    vi.advanceTimersByTime(3000);

    expect(first().textContent).toBe('');
    expect(second().textContent).toBe('Second failed!');
    expect(second().className).toBe('status-message error');
  });

  it('reschedules from the newest render, not from the first', () => {
    showStatus(first(), 'Saved!', 'success');
    showStatus(first(), 'Still saving', 'success', { durationMs: 1000 });

    vi.advanceTimersByTime(999);
    expect(first().textContent).toBe('Still saving');

    vi.advanceTimersByTime(1);
    expect(first().textContent).toBe('');
  });

  it('leaves a no-auto-clear render on one element alone while another clears', () => {
    showStatus(first(), 'Stays put', 'error', { autoClear: false });
    showStatus(second(), 'Saved!', 'success');

    vi.advanceTimersByTime(3000);

    expect(first().textContent).toBe('Stays put');
    expect(second().textContent).toBe('');
  });
});
