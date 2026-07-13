import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NavigationRegistry } from '../NavigationRegistry';
import { type AsyncDataPanel, type StaticFormPanel } from '../types';

function mockAsyncPanel(overrides?: Partial<AsyncDataPanel>): AsyncDataPanel {
  return {
    id: 'panel-test',
    category: 'async-data',
    mount: vi.fn(),
    loadData: vi.fn().mockResolvedValue(undefined),
    onActivate: vi.fn(),
    onDeactivate: vi.fn(),
    ...overrides,
  };
}

describe('NavigationRegistry', () => {
  let registry: NavigationRegistry;

  beforeEach(() => {
    registry = new NavigationRegistry();
  });

  it('register stores a panel', () => {
    const panel = mockAsyncPanel();
    registry.register(panel);
    expect(registry.activeId).toBeNull();
  });

  it('register throws on duplicate id', () => {
    registry.register(mockAsyncPanel({ id: 'panel-a' }));
    expect(() => registry.register(mockAsyncPanel({ id: 'panel-a' }))).toThrow('already registered');
  });

  it('navigate activates a panel and calls lifecycle methods', async () => {
    const panel = mockAsyncPanel({ id: 'panel-a' });
    registry.register(panel);
    registry.navigate('panel-a');
    expect(registry.activeId).toBe('panel-a');
    expect(panel.onActivate).toHaveBeenCalled();
    expect(panel.loadData).toHaveBeenCalled();
  });

  it('navigate deactivates previous panel before activating new one', async () => {
    const panelA = mockAsyncPanel({ id: 'panel-a' });
    const panelB = mockAsyncPanel({ id: 'panel-b' });
    registry.register(panelA);
    registry.register(panelB);
    registry.navigate('panel-a');
    registry.navigate('panel-b');
    expect(panelA.onDeactivate).toHaveBeenCalled();
    expect(panelB.onActivate).toHaveBeenCalled();
    expect(registry.activeId).toBe('panel-b');
  });

  it('navigate to same panel does nothing', () => {
    const panel = mockAsyncPanel({ id: 'panel-a' });
    registry.register(panel);
    registry.navigate('panel-a');
    vi.clearAllMocks();
    registry.navigate('panel-a');
    expect(panel.onDeactivate).not.toHaveBeenCalled();
    expect(panel.onActivate).not.toHaveBeenCalled();
  });

  it('navigate throws on unregistered panel', () => {
    expect(() => registry.navigate('panel-unknown')).toThrow('not registered');
  });

  it('navigate passes init context to onActivate', () => {
    const panel = mockAsyncPanel({ id: 'panel-a' });
    registry.register(panel);
    registry.navigate('panel-a', { searchTag: 'AI' });
    expect(panel.onActivate).toHaveBeenCalledWith({ searchTag: 'AI' });
  });

  it('StaticFormPanel does not call loadData (only refresh is available)', () => {
    const panel: StaticFormPanel = {
      id: 'panel-form',
      category: 'static-form',
      mount: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    registry.register(panel);
    registry.navigate('panel-form');
    expect(registry.activeId).toBe('panel-form');
  });
});
