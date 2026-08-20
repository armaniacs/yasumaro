// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NavigationRegistry } from '../NavigationRegistry.js';
import { DashboardBootstrapper } from '../DashboardBootstrapper.js';
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

  it('start activates default panel', () => {
    const panel = mockPanel({ id: 'panel-default' });
    bootstrapper.registerPanels([panel]);
    bootstrapper.start('panel-default');
    expect(registry.activeId).toBe('panel-default');
    expect(panel.activate).toHaveBeenCalled();
  });

  it('wireSidebar navigates on button click', () => {
    const panel = mockPanel({ id: 'panel-settings' });
    bootstrapper.registerPanels([panel]);

    const btn = document.createElement('button');
    btn.setAttribute('data-panel', 'panel-settings');
    sidebar.appendChild(btn);
    bootstrapper.wireSidebar(sidebar);

    btn.click();
    expect(registry.activeId).toBe('panel-settings');
  });

  it('wireSidebar ignores clicks on non-data-panel elements', () => {
    const div = document.createElement('div');
    sidebar.appendChild(div);
    bootstrapper.wireSidebar(sidebar);
    div.click();
    expect(registry.activeId).toBeNull();
  });

  it('wireSidebar toggles aria-selected when switching tabs', () => {
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
    expect(btnA.getAttribute('aria-selected')).toBe('false');
    expect(btnB.getAttribute('aria-selected')).toBe('true');
    expect(btnA.classList.contains('active')).toBe(false);
    expect(btnB.classList.contains('active')).toBe(true);

    btnA.click();
    expect(btnA.getAttribute('aria-selected')).toBe('true');
    expect(btnB.getAttribute('aria-selected')).toBe('false');
  });
});
