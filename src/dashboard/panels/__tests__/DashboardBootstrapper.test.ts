// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NavigationRegistry } from '../NavigationRegistry';
import { DashboardBootstrapper } from '../DashboardBootstrapper';
import { type StaticFormPanel } from '../types';

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
    const panelA: StaticFormPanel = {
      id: 'panel-a', category: 'static-form',
      mount: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    const panelB: StaticFormPanel = {
      id: 'panel-b', category: 'static-form',
      mount: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    bootstrapper.registerPanels([panelA, panelB]);
    expect(registry.activeId).toBeNull();
  });

  it('start activates default panel', () => {
    const panel: StaticFormPanel = {
      id: 'panel-default', category: 'static-form',
      mount: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
      onActivate: vi.fn(),
    };
    bootstrapper.registerPanels([panel]);
    bootstrapper.start('panel-default');
    expect(registry.activeId).toBe('panel-default');
    expect(panel.onActivate).toHaveBeenCalled();
  });

  it('wireSidebar navigates on button click', () => {
    const panel: StaticFormPanel = {
      id: 'panel-settings', category: 'static-form',
      mount: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
    };
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
});
