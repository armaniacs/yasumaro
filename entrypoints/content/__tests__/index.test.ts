// @vitest-environment node
/**
 * entrypoints/content/index.ts
 * PBI 03: the dynamic loader import must report a failure instead of leaving
 * it as a silent unhandled rejection. The 2026-04-15
 * web_accessible_resources regression rejected exactly here and stayed
 * invisible.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { defineContentScriptMock } = vi.hoisted(() => ({
  defineContentScriptMock: vi.fn((config: unknown) => config),
}));

vi.mock('wxt/utils/define-content-script', () => ({
  defineContentScript: defineContentScriptMock,
}));

import entrypoint, { startContentLoader } from '../index.js';

interface ContentScriptConfig {
  matches: string[];
  main: () => void;
}

describe('entrypoints/content/index.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers a content script that loads the loader module on page load', () => {
    // defineContentScript runs at import time; beforeEach's clearAllMocks
    // wipes the call history, so the returned config is the observable.
    const config = entrypoint as ContentScriptConfig;
    expect(config.matches).toEqual(['<all_urls>']);
    expect(typeof config.main).toBe('function');
  });

  it('reports a failed dynamic import through console.error instead of rejecting', async () => {
    const error = new Error('Failed to fetch dynamically imported module');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await startContentLoader(() => Promise.reject(error));

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Yasumaro] Failed to load the content loader module',
      error,
    );
  });

  it('resolves without logging when the loader module loads', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await startContentLoader(() => Promise.resolve({}));

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
