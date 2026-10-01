// @vitest-environment jsdom
/**
 * statusChannel.test.ts
 *
 * PBI 2026-10-01-01: mirror + TTL policy lives in the StatusChannel adapter
 * registry instead of per call site. Driven by the fake clock from
 * testDir/waitPolicy.ts; no real-time waits.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTimerClock } from '../../../../testDir/waitPolicy.js';
import { StatusChannel } from '../statusChannel.js';

function setupDom(): void {
  document.body.innerHTML = [
    '<div id="target"></div>',
    '<div id="mirror"></div>',
  ].join('\n');
}

const target = (): HTMLElement => document.getElementById('target')!;
const mirror = (): HTMLElement => document.getElementById('mirror')!;

beforeEach(() => {
  setupDom();
  useTimerClock();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('StatusChannel report', () => {
  it('renders and runs the registered mirror hook', () => {
    const channel = new StatusChannel();
    channel.register('target', {
      mirror: () => {
        mirror().textContent = target().textContent;
      },
    });

    channel.report('target', 'Saved!', 'success', { autoClear: false });

    expect(target().textContent).toBe('Saved!');
    expect(target().className).toBe('status-message success');
    expect(mirror().textContent).toBe('Saved!');
  });

  it('applies the adapter TTL when the call site gives none', () => {
    const channel = new StatusChannel();
    channel.register('target', { defaultTtlMs: 2000 });

    channel.report('target', 'Saved!', 'success');

    vi.advanceTimersByTime(1999);
    expect(target().textContent).toBe('Saved!');
    vi.advanceTimersByTime(1);
    expect(target().textContent).toBe('');
  });

  it('lets an explicit durationMs win over the adapter default', () => {
    const channel = new StatusChannel();
    channel.register('target', { defaultTtlMs: 2000 });

    channel.report('target', 'Saved!', 'success', { durationMs: 5000 });

    vi.advanceTimersByTime(2000);
    expect(target().textContent).toBe('Saved!');
    vi.advanceTimersByTime(3000);
    expect(target().textContent).toBe('');
  });

  it('renders without mirroring for unregistered targets', () => {
    const channel = new StatusChannel();

    channel.report('target', 'Saved!', 'success', { autoClear: false });

    expect(target().textContent).toBe('Saved!');
    expect(mirror().textContent).toBe('');
  });
});
