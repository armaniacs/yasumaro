// @vitest-environment jsdom
/**
 * panelCatalog.test.ts (PBI 2026-09-07-25)
 * カタログがパネル存在の単一の真実の源であることを固定する:
 * sidebar HTML (静的維持) との同期は実行時生成ではなくこのテストで担保する。
 *
 * NOTE: sidebar span の data-i18n キーが messages.json に存在することは
 * assert しない。applyI18n は欠落時に HTML フォールバック文言を残す仕様で、
 * tagClusterTab は既存時点で両ロケールに未定義のため。ここでは
 * カタログ宣言キー == HTML 宣言キーの一致だけを固定する。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PANEL_CATALOG,
  SIDEBAR_PANELS,
  DEFAULT_PANEL_ID,
  resolvePanelIdForTab,
  resolvePanelIdForSection,
} from '../panelCatalog.js';
import { createAllPanelsInCatalogOrder, createPanelById } from '../panelFactories.js';
import { STATIC_FORM_SPECS } from '../staticForm/staticPanels.js';

const html = readFileSync(
  resolve(process.cwd(), 'entrypoints/options/index.html'),
  'utf-8',
);
const sidebarNav = html.slice(html.indexOf('<nav id="sidebar"'), html.indexOf('</nav>'));

interface SidebarButton {
  panelId: string;
  i18nKey: string;
  sectionLabel: string;
  role: string | null;
  ariaSelected: string | null;
  ariaControls: string | null;
}

function parseSidebarButtons(): SidebarButton[] {
  const buttons: SidebarButton[] = [];
  let currentSection = '';
  // Walk section labels and buttons in document order.
  const tokenRe = /sidebar-section-label" data-i18n="([^"]+)"|<button\b[^>]*data-panel="([^"]+)"[^>]*>/g;
  const buttonStarts: { index: number; panelId: string; tag: string; section: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(sidebarNav)) !== null) {
    if (m[1]) {
      currentSection = m[1];
    } else if (m[2]) {
      buttonStarts.push({ index: m.index, panelId: m[2], tag: m[0], section: currentSection });
    }
  }
  for (let i = 0; i < buttonStarts.length; i++) {
    const start = buttonStarts[i]!;
    const end = i + 1 < buttonStarts.length ? buttonStarts[i + 1]!.index : sidebarNav.length;
    const block = sidebarNav.slice(start.index, end);
    const span = /<span data-i18n="([^"]+)"/.exec(block);
    const role = /role="([^"]+)"/.exec(start.tag);
    const selected = /aria-selected="([^"]+)"/.exec(start.tag);
    const controls = /aria-controls="([^"]+)"/.exec(start.tag);
    buttons.push({
      panelId: start.panelId,
      i18nKey: span?.[1] ?? '',
      sectionLabel: start.section,
      role: role?.[1] ?? null,
      ariaSelected: selected?.[1] ?? null,
      ariaControls: controls?.[1] ?? null,
    });
  }
  return buttons;
}

const SECTION_LABEL_TO_CATALOG: Record<string, string> = {
  settingsSection: 'settings',
  dataSection: 'data',
  toolsSection: 'tools',
};

describe('panelCatalog — 単一ソース', () => {
  it('declares 18 panels with no duplicate ids', () => {
    expect(PANEL_CATALOG).toHaveLength(18);
    const ids = PANEL_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('pins the full panel set (adding a panel means editing the catalog)', () => {
    expect(PANEL_CATALOG.map((e) => e.id)).toEqual([
      'panel-general',
      'panel-domain',
      'panel-prompt',
      'panel-markdown-template',
      'panel-privacy',
      'panel-content',
      'panel-ai-summary-cleansing',
      'panel-trust',
      'panel-csp',
      'panel-tags',
      'panel-recording-conditions',
      'panel-diagnostics',
      'panel-tag-cluster',
      'panel-sqlite-history',
      'panel-archive',
      'panel-domain-search',
      'panel-export-logs',
      'panel-export-import',
    ]);
  });

  it('no longer registers the legacy panel-history (removed, PBI 2026-09-11-09)', () => {
    expect(PANEL_CATALOG.find((e) => e.id === 'panel-history')).toBeUndefined();
    // The section element is gone from the HTML too.
    expect(html).not.toContain('id="panel-history"');
    expect(sidebarNav).not.toContain('data-panel="panel-history"');
  });

  it('defaults to the general panel', () => {
    expect(DEFAULT_PANEL_ID).toBe('panel-general');
  });
});

describe('panelCatalog ↔ HTML sidebar 同期', () => {
  const buttons = parseSidebarButtons();

  it('has one sidebar button per catalog sidebar panel, in catalog order', () => {
    expect(SIDEBAR_PANELS).toHaveLength(18);
    expect(buttons.map((b) => b.panelId)).toEqual(SIDEBAR_PANELS.map((e) => e.id));
  });

  it('places every button under its catalog section', () => {
    for (const b of buttons) {
      const entry = SIDEBAR_PANELS.find((e) => e.id === b.panelId);
      expect(SECTION_LABEL_TO_CATALOG[b.sectionLabel]).toBe(entry?.sidebarSection);
    }
  });

  it('keeps sidebar i18n keys identical to the catalog declaration', () => {
    for (const b of buttons) {
      const entry = SIDEBAR_PANELS.find((e) => e.id === b.panelId);
      expect(b.i18nKey).toBe(entry?.sidebarI18nKey);
    }
  });

  it('keeps a11y attributes invariant (tab role, aria-selected, aria-controls)', () => {
    const navRole = /<nav id="sidebar" class="sidebar" role="([^"]+)"/.exec(sidebarNav);
    expect(navRole?.[1]).toBe('tablist');
    for (const b of buttons) {
      expect(b.role).toBe('tab');
      expect(b.ariaSelected).toMatch(/^(true|false)$/);
      expect(b.ariaControls).toBe(b.panelId);
    }
    // Exactly the default panel starts selected.
    expect(buttons.filter((b) => b.ariaSelected === 'true').map((b) => b.panelId)).toEqual([
      'panel-general',
    ]);
  });

  it('gives every catalog panel a section element in the options page', () => {
    for (const entry of PANEL_CATALOG) {
      expect(html, `${entry.id} has no <section id>`).toContain(`id="${entry.id}"`);
    }
  });
});

describe('panelCatalog — deep-link 派生', () => {
  it('resolves ?tab=history to the sqlite history panel', () => {
    expect(resolvePanelIdForTab('history')).toBe('panel-sqlite-history');
  });

  it('resolves nothing for missing/unknown ?tab=', () => {
    expect(resolvePanelIdForTab(null)).toBeNull();
    expect(resolvePanelIdForTab('nope')).toBeNull();
  });

  it('resolves the legacy ?section= values to the general panel', () => {
    for (const section of ['obsidian', 'ai-provider', 'general']) {
      expect(resolvePanelIdForSection(section)).toBe('panel-general');
    }
  });

  it('resolves nothing for missing/unknown ?section=', () => {
    expect(resolvePanelIdForSection(null)).toBeNull();
    expect(resolvePanelIdForSection('nope')).toBeNull();
  });
});

describe('panelCatalog — factory 網羅', () => {
  it('creates every catalog panel in catalog order with matching ids', () => {
    const panels = createAllPanelsInCatalogOrder();
    expect(panels.map((p) => p.id)).toEqual(PANEL_CATALOG.map((e) => e.id));
  });

  it('covers every catalog id (static specs or direct factory)', () => {
    const staticIds = new Set(Object.keys(STATIC_FORM_SPECS));
    for (const entry of PANEL_CATALOG) {
      const panel = createPanelById(entry.id);
      expect(panel.id).toBe(entry.id);
      expect(panel.category).toMatch(/^(async-data|static-form|diagnostic)$/);
      if (staticIds.has(entry.id)) {
        expect(panel.category).toBe('static-form');
      }
    }
  });

  it('keeps every static spec key registered in the catalog', () => {
    const catalogIds = new Set(PANEL_CATALOG.map((e) => e.id));
    for (const id of Object.keys(STATIC_FORM_SPECS)) {
      expect(catalogIds.has(id)).toBe(true);
    }
  });
});
