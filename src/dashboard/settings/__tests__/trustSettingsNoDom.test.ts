// @vitest-environment node
/**
 * trustSettingsNoDom.test.ts
 * Pins the lazy-init convention (same as customPromptManager.ts): importing
 * trustSettings.ts must not touch `document`, so it works in a DOM-free
 * Node environment.
 */

import { describe, expect, it, vi } from 'vitest';

// Minimal chrome stub: present in SW/Node test envs, but no DOM.
vi.stubGlobal('chrome', {
  i18n: { getMessage: vi.fn(() => '') },
  storage: { local: { get: vi.fn(), set: vi.fn() }, session: { get: vi.fn(), set: vi.fn() } },
  alarms: { create: vi.fn(), clear: vi.fn() },
});

describe('trustSettings imports without a DOM', () => {
  // The body has no wait: the cost is the first transform of the module graph,
  // which exceeds the 30 s default when the suite runs inside a Stryker
  // sandbox with several workers. The pin is "the import succeeds without a
  // DOM", so give that import room instead of leaving it load-dependent.
  it('has no document global and still imports', async () => {
    expect((globalThis as Record<string, unknown>).document).toBeUndefined();
    const mod = await import('../trustSettings.js');
    expect(typeof mod.init).toBe('function');
    expect(typeof mod.loadTrustSettings).toBe('function');
    expect(typeof mod.renderPermissionSuggestList).toBe('function');
  }, 120_000);
});
