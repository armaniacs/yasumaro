// @vitest-environment jsdom
/**
 * Deep links used to be applied by navigating away from the default panel
 * after the bootstrapper had already started on it. Now the starting panel is
 * resolved up front and handed to start(), so these tests pin the mapping
 * that main.ts depends on.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveInitialPanelId, applySectionDeepLink } from '../dashboard.js';

vi.mock('../localMarkdownExport.js', () => ({
  handleExportLocalMarkdown: vi.fn(),
  handleHistoryExportLocalMarkdown: vi.fn(),
}));
vi.mock('../trancoConsent.js', () => ({
  initTrancoConsentPanel: vi.fn().mockResolvedValue(undefined),
}));

describe('resolveInitialPanelId', () => {
  it('defaults to the general panel when there is no deep link', () => {
    expect(resolveInitialPanelId('')).toBe('panel-general');
    expect(resolveInitialPanelId('?foo=bar')).toBe('panel-general');
  });

  it('opens the history panel for ?tab=history', () => {
    expect(resolveInitialPanelId('?tab=history')).toBe('panel-sqlite-history');
  });

  it.each(['obsidian', 'ai-provider', 'general'])(
    'maps ?section=%s to the general panel',
    (section) => {
      expect(resolveInitialPanelId(`?section=${section}`)).toBe('panel-general');
    },
  );

  it('falls back to the default for an unknown section', () => {
    expect(resolveInitialPanelId('?section=nope')).toBe('panel-general');
  });

  it('lets ?tab=history win over ?section=', () => {
    expect(resolveInitialPanelId('?tab=history&section=obsidian')).toBe('panel-sqlite-history');
  });
});

describe('applySectionDeepLink', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <details id="obsidianSettingsDetails"></details>
      <div id="aiProviderSection"></div>
    `;
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('expands the Obsidian block for ?section=obsidian', () => {
    const details = document.getElementById('obsidianSettingsDetails') as HTMLDetailsElement;
    details.open = false;

    applySectionDeepLink('?section=obsidian');

    expect(details.open).toBe(true);
    expect(details.scrollIntoView).toHaveBeenCalled();
  });

  it('scrolls to the AI provider block for ?section=ai-provider', () => {
    applySectionDeepLink('?section=ai-provider');

    const aiSection = document.getElementById('aiProviderSection') as HTMLElement;
    expect(aiSection.scrollIntoView).toHaveBeenCalled();
    expect((document.getElementById('obsidianSettingsDetails') as HTMLDetailsElement).open).toBe(false);
  });

  it('does nothing without a section', () => {
    applySectionDeepLink('');

    expect((document.getElementById('obsidianSettingsDetails') as HTMLDetailsElement).open).toBe(false);
    expect(document.getElementById('aiProviderSection')?.scrollIntoView).not.toHaveBeenCalled();
  });
});
