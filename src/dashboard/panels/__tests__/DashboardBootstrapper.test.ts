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

  describe('settings subgroup collapse (Initial Setup toggle)', () => {
    /** Minimal production-shaped sidebar: toggle + subgroup child + data tab. */
    function buildGroupedSidebar(): {
      general: HTMLButtonElement;
      child: HTMLButtonElement;
      data: HTMLButtonElement;
      group: HTMLElement;
    } {
      bootstrapper.registerPanels([
        mockPanel({ id: 'panel-general' }),
        mockPanel({ id: 'panel-domain' }),
        mockPanel({ id: 'panel-tag-cluster' }),
      ]);
      const general = document.createElement('button');
      general.className = 'sidebar-nav-btn active';
      general.setAttribute('data-panel', 'panel-general');
      general.setAttribute('aria-selected', 'true');
      general.setAttribute('aria-expanded', 'false');
      const group = document.createElement('div');
      group.className = 'sidebar-subgroup';
      group.id = 'settingsSubgroup';
      const child = document.createElement('button');
      child.className = 'sidebar-nav-btn';
      child.setAttribute('data-panel', 'panel-domain');
      child.setAttribute('aria-selected', 'false');
      group.appendChild(child);
      const data = document.createElement('button');
      data.className = 'sidebar-nav-btn';
      data.setAttribute('data-panel', 'panel-tag-cluster');
      data.setAttribute('aria-selected', 'false');
      sidebar.appendChild(general);
      sidebar.appendChild(group);
      sidebar.appendChild(data);
      bootstrapper.wireSidebar(sidebar);
      return { general, child, data, group };
    }

    it('collapses the subgroup on wire and marks the toggle collapsed', () => {
      const { general, group } = buildGroupedSidebar();
      expect(group.hidden).toBe(true);
      expect(general.getAttribute('aria-expanded')).toBe('false');
    });

    it('pressing the Initial Setup button expands the group and navigates', async () => {
      const { general, group } = buildGroupedSidebar();
      general.click();
      await flush();
      expect(group.hidden).toBe(false);
      expect(general.getAttribute('aria-expanded')).toBe('true');
      expect(registry.activeId).toBe('panel-general');
    });

    it('clicking a settings child keeps the group expanded', async () => {
      const { general, child, group } = buildGroupedSidebar();
      general.click();
      await flush();
      child.click();
      await flush();
      expect(group.hidden).toBe(false);
      expect(registry.activeId).toBe('panel-domain');
    });

    it('leaving the group collapses it again', async () => {
      const { general, data, group } = buildGroupedSidebar();
      general.click();
      await flush();
      expect(group.hidden).toBe(false);
      data.click();
      await flush();
      expect(group.hidden).toBe(true);
      expect(general.getAttribute('aria-expanded')).toBe('false');
      expect(registry.activeId).toBe('panel-tag-cluster');
    });

    it('programmatic navigate into a settings child expands; out of settings collapses', async () => {
      const { group } = buildGroupedSidebar();
      expect(group.hidden).toBe(true);
      await registry.navigate('panel-domain');
      expect(group.hidden).toBe(false);
      await registry.navigate('panel-tag-cluster');
      expect(group.hidden).toBe(true);
    });

    it('programmatic navigate to Initial Setup leaves the group state untouched', async () => {
      const { group } = buildGroupedSidebar();
      await registry.navigate('panel-general');
      expect(group.hidden).toBe(true);
      await registry.navigate('panel-domain');
      expect(group.hidden).toBe(false);
      await registry.navigate('panel-general');
      expect(group.hidden).toBe(false);
    });

    it('arrow-key navigation skips buttons hidden in the collapsed group', () => {
      const { general, child, data, group } = buildGroupedSidebar();
      // focus() only moves document.activeElement for attached nodes.
      document.body.appendChild(sidebar);
      try {
        general.focus();
        general.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(document.activeElement).toBe(data);

        group.hidden = false;
        general.focus();
        general.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(document.activeElement).toBe(child);
      } finally {
        sidebar.remove();
      }
    });
  });
});
