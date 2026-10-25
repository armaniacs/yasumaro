// @vitest-environment jsdom
/**
 * savedCollectionsRegionRender.test.ts
 * PBI 2026-10-23-06 — region render pins.
 * The collections + auto-tag rules region paints from plain data (settings
 * content, never SQLite), so the list, recall, rename/duplicate controls and
 * the rule form render identically in fallback mode — the SQLite outage path
 * cannot blank them.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  SAVED_COLLECTIONS_REGION_ID,
  renderSavedCollectionsRegion,
  type SavedCollectionsRegionActions,
} from '../savedCollectionsPanelView.js';
import type { SavedCollection } from '../../../../utils/storage/savedCollections.js';
import type { AutoTagRule } from '../../../../utils/storage/autoTagRules.js';

function stubActions(): SavedCollectionsRegionActions & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onSave: vi.fn(async () => { calls.push('save'); return { ok: true }; }),
    onApply: vi.fn((id: string) => { calls.push(`apply:${id}`); }),
    onDelete: vi.fn(async () => { calls.push('delete'); }),
    onRename: vi.fn(async () => { calls.push('rename'); return { ok: true }; }),
    onDuplicate: vi.fn(async () => { calls.push('duplicate'); }),
    onAddRule: vi.fn(async () => { calls.push('addRule'); return { ok: true }; }),
    onToggleRule: vi.fn(async () => { calls.push('toggleRule'); }),
    onDeleteRule: vi.fn(async () => { calls.push('deleteRule'); }),
    onUndoRule: vi.fn(async () => { calls.push('undoRule'); return { ok: true, message: 'done' }; }),
  };
}

const COLLECTIONS: Record<string, SavedCollection> = {
  c1: { id: 'c1', name: 'Rust notes', query: { tag: 'rust' }, createdAt: 1, updatedAt: 2 },
};
const RULES: Record<string, AutoTagRule> = {
  r1: { id: 'r1', name: 'Docs', domainSuffix: 'example.com', tag: 'docs', priority: 10, enabled: true },
};

function mount(actions: SavedCollectionsRegionActions): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = `<div id="${SAVED_COLLECTIONS_REGION_ID}"></div>`;
  document.body.appendChild(container);
  renderSavedCollectionsRegion(container, COLLECTIONS, RULES, actions);
  return container;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('renderSavedCollectionsRegion', () => {
  it('paints collection rows with rename/duplicate controls', () => {
    const actions = stubActions();
    const container = mount(actions);
    expect(container.querySelector('.saved-collection-name')?.textContent).toBe('Rust notes');
    expect(container.querySelector('[data-collection-action="rename"]')).not.toBeNull();
    expect(container.querySelector('[data-collection-action="duplicate"]')).not.toBeNull();
    expect(container.querySelector('[data-collection-action="apply"]')).not.toBeNull();
  });

  it('routes rename editor save through onRename', () => {
    const actions = stubActions();
    const container = mount(actions);
    container.querySelector<HTMLButtonElement>('[data-collection-action="rename"]')?.click();
    const input = container.querySelector<HTMLInputElement>('.saved-collection-rename-input');
    expect(input).not.toBeNull();
    input!.value = 'Renamed';
    container.querySelector<HTMLButtonElement>('[data-collection-action="rename-save"]')?.click();
    expect(actions.calls).toContain('rename');
  });

  it('paints the rule form and rows with toggle/undo/delete controls', () => {
    const actions = stubActions();
    const container = mount(actions);
    expect(container.querySelector('.auto-tag-rule-name')).not.toBeNull();
    expect(container.querySelector('.auto-tag-rule-tag')).not.toBeNull();
    expect(container.querySelector('[data-rule-action="add"]')).not.toBeNull();
    expect(container.querySelector('.auto-tag-rule-row .auto-tag-rule-name')?.textContent).toBe('Docs');
    expect(container.querySelector('[data-rule-action="toggle"]')).not.toBeNull();
    expect(container.querySelector('[data-rule-action="undo"]')).not.toBeNull();
    expect(container.querySelector('[data-rule-action="delete"]')).not.toBeNull();
  });

  it('routes rule toggle and undo through the actions', () => {
    const actions = stubActions();
    const container = mount(actions);
    container.querySelector<HTMLInputElement>('[data-rule-action="toggle"]')?.click();
    container.querySelector<HTMLButtonElement>('[data-rule-action="undo"]')?.click();
    expect(actions.calls).toContain('toggleRule');
    expect(actions.calls).toContain('undoRule');
  });
});
