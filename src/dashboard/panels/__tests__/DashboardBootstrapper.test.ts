// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NavigationRegistry } from '../NavigationRegistry.js';
import { DashboardBootstrapper } from '../DashboardBootstrapper.js';
import { PANEL_CATALOG } from '../panelCatalog.js';
import { type PanelLifecycle } from '../types.js';

function mockPanel(overrides?: Partial<PanelLifecycle>): PanelLifecycle {
  return {
    id: 'panel-test',
    category: 'static-form',
    mount: vi.fn().mockResolvedValue(undefined),
    activate: vi.fn(),
    ...overrides,
  };
}

/** Flush the microtask queue so pending navigate()/mount() promises settle. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('DashboardBootstrapper', () => {
  let registry: NavigationRegistry;
  let bootstrapper: DashboardBootstrapper;
  let sidebar: HTMLElement;

  beforeEach(() => {
    registry = new NavigationRegistry();
    bootstrapper = new DashboardBootstrapper(registry);
    sidebar = document.createElement('nav');
  });

  it('registerPanels registers all panels', () => {
    const panelA = mockPanel({ id: 'panel-a' });
    const panelB = mockPanel({ id: 'panel-b' });
    bootstrapper.registerPanels([panelA, panelB]);
    expect(registry.activeId).toBeNull();
  });

  it('start activates default panel', async () => {
    const panel = mockPanel({ id: 'panel-default' });
    bootstrapper.registerPanels([panel]);
    await bootstrapper.start('panel-default');
    expect(registry.activeId).toBe('panel-default');
    expect(panel.activate).toHaveBeenCalled();
  });

  it('wireSidebar navigates on button click', async () => {
    const panel = mockPanel({ id: 'panel-settings' });
    bootstrapper.registerPanels([panel]);

    const btn = document.createElement('button');
    btn.setAttribute('data-panel', 'panel-settings');
    sidebar.appendChild(btn);
    bootstrapper.wireSidebar(sidebar);

    btn.click();
    await flush();
    expect(registry.activeId).toBe('panel-settings');
  });

  it('wireSidebar ignores clicks on non-data-panel elements', async () => {
    const div = document.createElement('div');
    sidebar.appendChild(div);
    bootstrapper.wireSidebar(sidebar);
    div.click();
    await flush();
    expect(registry.activeId).toBeNull();
  });

  it('wireSidebar toggles aria-selected when switching tabs', async () => {
    const panelA = mockPanel({ id: 'panel-a' });
    const panelB = mockPanel({ id: 'panel-b' });
    bootstrapper.registerPanels([panelA, panelB]);

    const btnA = document.createElement('button');
    btnA.className = 'sidebar-nav-btn';
    btnA.setAttribute('data-panel', 'panel-a');
    btnA.setAttribute('aria-selected', 'true');
    const btnB = document.createElement('button');
    btnB.className = 'sidebar-nav-btn';
    btnB.setAttribute('data-panel', 'panel-b');
    btnB.setAttribute('aria-selected', 'false');
    sidebar.appendChild(btnA);
    sidebar.appendChild(btnB);

    bootstrapper.wireSidebar(sidebar);

    btnB.click();
    await flush();
    expect(btnA.getAttribute('aria-selected')).toBe('false');
    expect(btnB.getAttribute('aria-selected')).toBe('true');
    expect(btnA.classList.contains('active')).toBe(false);
    expect(btnB.classList.contains('active')).toBe(true);

    btnA.click();
    await flush();
    expect(btnA.getAttribute('aria-selected')).toBe('true');
    expect(btnB.getAttribute('aria-selected')).toBe('false');
  });

  it('registerCatalog registers every catalog panel in catalog order (PBI 2026-09-07-25)', async () => {
    const created: string[] = [];
    bootstrapper.registerCatalog((id) => {
      created.push(id);
      return mockPanel({ id });
    });

    expect(created).toEqual(PANEL_CATALOG.map((e) => e.id));

    // Every registered panel is navigable without throwing.
    for (const id of created) {
      await registry.navigate(id);
    }
    expect(registry.activeId).toBe(created[created.length - 1]);
  });

  it('syncs sidebar aria-selected on programmatic navigate (no click)', async () => {
    const panelA = mockPanel({ id: 'panel-a' });
    const panelB = mockPanel({ id: 'panel-b' });
    bootstrapper.registerPanels([panelA, panelB]);

    const btnA = document.createElement('button');
    btnA.className = 'sidebar-nav-btn active';
    btnA.setAttribute('data-panel', 'panel-a');
    btnA.setAttribute('aria-selected', 'true');
    const btnB = document.createElement('button');
    btnB.className = 'sidebar-nav-btn';
    btnB.setAttribute('data-panel', 'panel-b');
    btnB.setAttribute('aria-selected', 'false');
    sidebar.appendChild(btnA);
    sidebar.appendChild(btnB);
    bootstrapper.wireSidebar(sidebar);

    // Bypass the click handler entirely, like a panel calling
    // getRegistry().navigate() from the inside.
    await registry.navigate('panel-b');

    expect(btnA.getAttribute('aria-selected')).toBe('false');
    expect(btnB.getAttribute('aria-selected')).toBe('true');
    expect(btnA.classList.contains('active')).toBe(false);
    expect(btnB.classList.contains('active')).toBe(true);
  });
});
