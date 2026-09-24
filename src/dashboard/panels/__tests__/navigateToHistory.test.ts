// @vitest-environment jsdom
/**
 * navigateToHistoryWithTag unit tests: registry-backed navigation on the
 * happy path and the legacy 'navigate-to-tag' CustomEvent fallback
 * (raw-string detail) when the registry is missing, throws, or rejects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { navigateToHistoryWithTag } from '../navigateToHistory.js';
import { setRegistry } from '../registryContext.js';
import { type NavigationRegistry } from '../NavigationRegistry.js';

function setFakeRegistry(navigateTyped: (panelId: string, init?: unknown) => Promise<void>): void {
  setRegistry({ navigateTyped } as unknown as NavigationRegistry);
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('navigateToHistoryWithTag', () => {
  let eventSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    eventSpy = vi.fn();
    document.addEventListener('navigate-to-tag', eventSpy);
  });

  // The listener is added per test; jsdom tears down the document per file,
  // so no explicit removal is needed for these module-local spies.

  it('navigates panel-sqlite-history with searchTag and fires no event on success', async () => {
    const navigateTyped = vi.fn().mockResolvedValue(undefined);
    setFakeRegistry(navigateTyped as never);

    navigateToHistoryWithTag('AI');

    expect(navigateTyped).toHaveBeenCalledWith('panel-sqlite-history', { searchTag: 'AI' });
    expect(eventSpy).not.toHaveBeenCalled();
    await flush();
    expect(eventSpy).not.toHaveBeenCalled();
  });

  it('falls back to navigate-to-tag when the registry is not initialized', () => {
    setRegistry(null as unknown as NavigationRegistry);

    navigateToHistoryWithTag('AI');

    expect(eventSpy).toHaveBeenCalledTimes(1);
    const event = eventSpy.mock.calls[0]![0] as CustomEvent;
    expect(event.type).toBe('navigate-to-tag');
    expect(event.detail).toBe('AI');
  });

  it('falls back to navigate-to-tag when navigateTyped throws synchronously', () => {
    setFakeRegistry(
      vi.fn(() => {
        throw new Error('boom');
      }) as never,
    );

    navigateToHistoryWithTag('tech');

    expect(eventSpy).toHaveBeenCalledTimes(1);
    const event = eventSpy.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toBe('tech');
  });

  it('falls back to navigate-to-tag when navigateTyped rejects', async () => {
    setFakeRegistry(vi.fn().mockRejectedValue(new Error('nav failed')) as never);

    navigateToHistoryWithTag('hot');
    await flush();

    expect(eventSpy).toHaveBeenCalledTimes(1);
    const event = eventSpy.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toBe('hot');
  });
});
