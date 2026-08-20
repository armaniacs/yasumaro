// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTagClusterPanel } from '../tagClusterPanel.js';
import type { PanelLifecycle } from '../../types.js';

describe('tagClusterPanel — PanelLifecycle', () => {
  let panel: PanelLifecycle;
  let container: HTMLDivElement;

  beforeEach(() => {
    panel = createTagClusterPanel();
    container = document.createElement('div');
    container.id = 'panel-tag-cluster';
    container.innerHTML = `
      <svg id="tagClusterSvg"></svg>
      <div id="tagClusterEmptyState"></div>
      <div id="tagClusterTruncatedNotice"></div>
      <button id="tagClusterZoomIn"></button>
      <button id="tagClusterZoomOut"></button>
      <button id="tagClusterZoomReset"></button>
    `;
    document.body.appendChild(container);
    const panelEl = document.createElement('div');
    panelEl.id = 'panel-tag-cluster';
    document.body.appendChild(panelEl);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('has correct id and category', () => {
    expect(panel.id).toBe('panel-tag-cluster');
    expect(panel.category).toBe('async-data');
  });

  it('exposes mount/load/destroy/init', () => {
    expect(panel.mount).toBeDefined();
    expect(panel.load).toBeDefined();
    expect(panel.destroy).toBeDefined();
    expect(panel.init).toBeDefined();
  });

  it('mount does not throw', () => {
    expect(() => panel.mount(container)).not.toThrow();
  });

  it('load without mount is safe', async () => {
    const p2 = createTagClusterPanel();
    await expect(p2.load?.()).resolves.toBeUndefined();
  });

  it('load after mount returns promise', () => {
    panel.mount(container);
    const r = panel.load?.();
    expect(r).toBeInstanceOf(Promise);
  });

  it('destroy without mount does not throw', () => {
    const p2 = createTagClusterPanel();
    expect(() => p2.destroy?.()).not.toThrow();
  });

  it('destroy cleans up panZoom safely', () => {
    panel.mount(container);
    expect(() => panel.destroy?.()).not.toThrow();
    expect(() => panel.destroy?.()).not.toThrow();
  });

  it('init handles focusTag', () => {
    panel.mount(container);
    expect(() => panel.init?.({ focusTag: 'test' })).not.toThrow();
    expect(() => panel.init?.({})).not.toThrow();
    expect(() => panel.init?.()).not.toThrow();
  });

  it('lifecycle mount→init→load→destroy', async () => {
    panel.mount(container);
    panel.init?.({ focusTag: 'ai' });
    const pr = panel.load?.();
    expect(pr).toBeInstanceOf(Promise);
    expect(() => panel.destroy?.()).not.toThrow();
  });
});
