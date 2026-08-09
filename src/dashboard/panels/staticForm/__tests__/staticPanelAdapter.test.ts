// @vitest-environment jsdom
/**
 * staticPanelAdapter.test.ts
 * PBI 2026-08-09-22: 単純委譲パネルの宣言表化
 *
 * 対象9件のパネルはテストが1件も存在しなかった。アダプタ化により、
 * 9件分の「idとcategoryを設定し、指定されたinit関数を呼ぶ」という
 * 同一の形を、このテスト1つで担保できるようになる。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../utils/storage.js', () => ({
  getSettings: vi.fn().mockResolvedValue({ some_key: 'value' }),
}));

import { createStaticFormPanel } from '../staticPanelAdapter.js';
import { getSettings } from '../../../../utils/storage.js';

function container(): HTMLElement {
  return document.createElement('div');
}

describe('createStaticFormPanel', () => {
  it('sets id and category', () => {
    const panel = createStaticFormPanel({ id: 'panel-x', mount: () => {} });
    expect(panel.id).toBe('panel-x');
    expect(panel.category).toBe('static-form');
  });

  it('mount calls the supplied init function', async () => {
    const spy = vi.fn();
    const panel = createStaticFormPanel({ id: 'panel-x', mount: spy });

    await panel.mount(container());

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('awaits an async init before resolving', async () => {
    let done = false;
    const panel = createStaticFormPanel({
      id: 'panel-x',
      mount: async () => {
        await Promise.resolve();
        done = true;
      },
    });

    await panel.mount(container());

    expect(done).toBe(true);
  });

  it('passes settings to init only when needsSettings is set', async () => {
    const spy = vi.fn();
    const panel = createStaticFormPanel({ id: 'panel-x', needsSettings: true, mount: spy });

    await panel.mount(container());

    expect(getSettings).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith({ some_key: 'value' });
  });

  it('does not read storage when the panel does not need settings', async () => {
    vi.mocked(getSettings).mockClear();
    const panel = createStaticFormPanel({ id: 'panel-x', mount: () => {} });

    await panel.mount(container());

    // Reading settings for the 7 panels that ignore them would add a
    // needless async storage round-trip to every panel open.
    expect(getSettings).not.toHaveBeenCalled();
  });

  it('omits the refresh property entirely when no refresh is given', () => {
    // PBI 2026-08-08-03 settled that refresh is optional: panels with
    // nothing to re-read declare no refresh rather than an empty one.
    const panel = createStaticFormPanel({ id: 'panel-x', mount: () => {} });
    expect('refresh' in panel).toBe(false);
  });

  it('calls the supplied refresh when one is given', async () => {
    const spy = vi.fn();
    const panel = createStaticFormPanel({ id: 'panel-x', mount: () => {}, refresh: spy });

    await panel.refresh?.();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
