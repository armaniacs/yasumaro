// @vitest-environment jsdom
/**
 * asyncDataPanelLifecycle unit tests (PBI 2026-09-28-09). The ring owns four
 * duties — filter-host resolution, filter mount, the loadSeq-guarded reload,
 * and the seq-bumping destroy — and nothing else. These tests pin them with
 * fake hosts so a panel regression cannot be confused with a ring regression:
 *
 * - reload bumps the seq, so two loads in flight and the older one loses;
 * - a load that resolves after destroy reports itself stale;
 * - destroy clears every registered notice scope (the two-comparison panel
 *   passes two);
 * - the missing-filter-host range is the panel's DECLARED preset, which is
 *   the PBI's one intentional behavior change (previously unbounded `{}` in
 *   four panels while three already fell back to the preset).
 *
 * Waits are condition-based (vi.waitFor / drainMacrotask), never a duration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitForMock, drainMacrotask } from '../../../../../testDir/waitPolicy.js';
import { createAsyncDataPanelLifecycle } from '../asyncDataPanelLifecycle.js';
import { PanelNotices } from '../../PanelNotices.js';
import { DAY_MS, presetToRange, type PeriodRange } from '../../../components/periodFilter.js';

function makeContainer(filterHostSelector?: string): HTMLElement {
  const container = document.createElement('div');
  if (filterHostSelector) {
    const host = document.createElement('div');
    host.id = filterHostSelector.replace('#', '');
    container.appendChild(host);
  }
  return container;
}

interface HarnessOptions {
  filterHostSelector?: string;
  initialPreset?: 'last7' | 'last90' | 'last30' | 'all';
  autoApply?: boolean;
  noticeCount?: number;
  ready?: boolean;
}

function makeHarness(options: HarnessOptions = {}) {
  const notices = Array.from({ length: options.noticeCount ?? 1 }, () => new PanelNotices());
  const loads: Array<{ range: PeriodRange; isStale: () => boolean }> = [];
  const events: string[] = [];
  let ready = options.ready ?? true;
  let teardowns = 0;

  const lifecycle = createAsyncDataPanelLifecycle({
    label: 'harness',
    notices,
    // WHY: exactOptionalPropertyTypes — the ring treats an absent selector as
    // "no period filter", which is what the two panels without one pass.
    ...(options.filterHostSelector !== undefined
      ? { filterHostSelector: options.filterHostSelector }
      : {}),
    ...(options.initialPreset !== undefined ? { initialPreset: options.initialPreset } : {}),
    ...(options.autoApply !== undefined ? { autoApply: options.autoApply } : {}),
    isReady: () => ready,
    resetOutput: () => {
      events.push('resetOutput');
    },
    load: async ({ range, isStale }) => {
      events.push('load');
      loads.push({ range, isStale });
    },
    teardown: () => {
      events.push('teardown');
      teardowns += 1;
    },
  });

  return {
    lifecycle,
    notices,
    loads,
    events,
    setReady: (value: boolean) => {
      ready = value;
    },
    teardowns: () => teardowns,
  };
}

describe('asyncDataPanelLifecycle — the ring', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('mounts the filter into the resolved host and does not fetch', async () => {
    const harness = makeHarness({
      filterHostSelector: '#harnessFilter',
      initialPreset: 'last7',
      autoApply: true,
    });
    const container = makeContainer('#harnessFilter');
    document.body.appendChild(container);

    harness.lifecycle.mount(container);

    const fieldset = container.querySelector<HTMLElement>('.period-filter');
    expect(fieldset).not.toBeNull();
    expect(fieldset!.dataset.activePreset).toBe('last7');
    expect(harness.loads).toHaveLength(0);
  });

  it('mounts no filter without a host selector, and survives a missing host', async () => {
    const withoutSelector = makeHarness();
    const container = document.createElement('div');
    document.body.appendChild(container);
    withoutSelector.lifecycle.mount(container);
    expect(container.querySelector('.period-filter')).toBeNull();

    const missingHost = makeHarness({
      filterHostSelector: '#notInTheDom',
      initialPreset: 'last7',
    });
    missingHost.lifecycle.mount(container);
    expect(container.querySelector('.period-filter')).toBeNull();
    // Fail-soft: the range still comes from the declared preset.
    await missingHost.lifecycle.reload();
    expect(missingHost.loads).toHaveLength(1);
    expect(missingHost.loads[0]!.range.since).toEqual(expect.any(Number));
  });

  it('reloads only when the panel is ready, and resets output before the body', async () => {
    const harness = makeHarness();
    harness.setReady(false);
    await harness.lifecycle.reload();
    expect(harness.events).toEqual([]);

    harness.setReady(true);
    await harness.lifecycle.reload();
    expect(harness.events).toEqual(['resetOutput', 'load']);
  });

  it('bumps the seq so the older of two loads in flight reports itself stale', async () => {
    const harness = makeHarness();
    const first = harness.lifecycle.reload();
    const second = harness.lifecycle.reload();
    await Promise.all([first, second]);

    expect(harness.loads).toHaveLength(2);
    expect(harness.loads[0]!.isStale()).toBe(true);
    expect(harness.loads[1]!.isStale()).toBe(false);
  });

  it('makes an in-flight load stale after destroy, and never re-renders', async () => {
    const harness = makeHarness();
    const pending = harness.lifecycle.reload();
    const load = harness.loads[0]!;
    expect(load.isStale()).toBe(false);

    harness.lifecycle.destroy();
    await pending;

    expect(load.isStale()).toBe(true);
  });

  it('destroy runs the panel teardown and clears every notice scope', () => {
    const harness = makeHarness({ noticeCount: 2 });
    const emptyA = document.createElement('div');
    const emptyB = document.createElement('div');
    const noticeA = document.createElement('div');
    const noticeB = document.createElement('div');
    harness.notices[0]!.register('empty', emptyA, { i18nKey: 'a', fallbackText: 'a' });
    harness.notices[0]!.register('rowCap', noticeA, { fetchScoped: true });
    harness.notices[1]!.register('empty', emptyB, { i18nKey: 'b', fallbackText: 'b' });
    harness.notices[1]!.register('rowCap', noticeB, { fetchScoped: true });
    harness.notices.forEach((notices) => notices.show('rowCap'));
    expect(noticeA.hidden).toBe(false);
    expect(noticeB.hidden).toBe(false);

    harness.lifecycle.destroy();

    expect(harness.teardowns()).toBe(1);
    // clear() drops the registrations, so a later show() cannot resurrect them.
    harness.notices.forEach((notices) => notices.show('rowCap'));
    expect(noticeA.hidden).toBe(false);
    expect(noticeB.hidden).toBe(false);
    expect(emptyA.hasAttribute('data-i18n')).toBe(false);
    expect(emptyB.hasAttribute('data-i18n')).toBe(false);
  });

  it('reset is idempotent, so a panel that validates before loading can reset alone', async () => {
    const harness = makeHarness();
    const empty = document.createElement('div');
    const cap = document.createElement('div');
    harness.notices[0]!.register('empty', empty, { i18nKey: 'a', fallbackText: 'a' });
    harness.notices[0]!.register('rowCap', cap, { fetchScoped: true });
    harness.notices[0]!.show('rowCap');
    expect(cap.hidden).toBe(false);

    harness.lifecycle.resetNotices();
    harness.lifecycle.resetNotices();
    expect(cap.hidden).toBe(true);

    // The reset does not start a load and does not invalidate one in flight.
    const pending = harness.lifecycle.reload();
    harness.lifecycle.resetNotices();
    await pending;
    expect(harness.loads).toHaveLength(1);
    expect(harness.loads[0]!.isStale()).toBe(false);
  });

  it('destroy removes the mounted filter and is safe to call twice', () => {
    const harness = makeHarness({
      filterHostSelector: '#harnessFilter',
      initialPreset: 'last7',
    });
    const container = makeContainer('#harnessFilter');
    document.body.appendChild(container);
    harness.lifecycle.mount(container);
    expect(container.querySelector('.period-filter')).not.toBeNull();

    expect(() => {
      harness.lifecycle.destroy();
      harness.lifecycle.destroy();
    }).not.toThrow();
    expect(container.querySelector('.period-filter')).toBeNull();
  });

  it('an auto-apply host refetches on a preset click, an explicit-apply host does not', async () => {
    const container = makeContainer('#harnessFilter');
    document.body.appendChild(container);

    const auto = makeHarness({
      filterHostSelector: '#harnessFilter',
      initialPreset: 'last7',
      autoApply: true,
    });
    auto.lifecycle.mount(container);
    container
      .querySelector<HTMLButtonElement>('button[data-preset="all"]')!
      .click();
    await waitForMock(() => {
      expect(auto.loads).toHaveLength(1);
    });
    expect(auto.loads[0]!.range).toEqual({});

    // The explicit-apply host (Run button) owns the reload; the filter must
    // record the range only. createPeriodFilter emits nothing at
    // construction, so an explicit host sees no load until it applies.
    const container2 = makeContainer('#harnessFilter');
    document.body.appendChild(container2);
    const explicit = makeHarness({
      filterHostSelector: '#harnessFilter',
      initialPreset: 'last7',
    });
    explicit.lifecycle.mount(container2);
    container2.querySelector<HTMLButtonElement>('button[data-preset="all"]')!.click();
    await drainMacrotask();
    expect(explicit.loads).toHaveLength(0);

    await explicit.lifecycle.reload();
    expect(explicit.loads[0]!.range).toEqual({});
  });

  it('a body throw is logged and does not reject the load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const notices = [new PanelNotices()];
    const lifecycle = createAsyncDataPanelLifecycle({
      label: 'throwingPanel',
      notices,
      isReady: () => true,
      resetOutput: () => {},
      load: async () => {
        throw new Error('boom');
      },
    });

    await expect(lifecycle.reload()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith('[throwingPanel] reload failed:', expect.any(Error));
    consoleError.mockRestore();
  });

  /**
   * The PBI's one intentional behavior change, pinned per panel: the range
   * used when the filter host is missing is the preset the panel declares.
   * 'all' stays unbounded — that is the preset, not a fallback.
   */
  it.each([
    ['tagClusterPanel', 'last7'],
    ['wordClusterPanel', 'last7'],
    ['researchSessionsPanel', 'last7'],
    ['domainAnalysisPanel', 'last30'],
    ['tagFrequencyTimelinePanel', 'last30'],
    ['timeHeatmapPanel', 'last90'],
    ['tagCooccurrenceTablePanel', 'all'],
  ] as const)('%s falls back to its declared %s range without a filter host', async (
    _panel,
    preset,
  ) => {
    const before = Date.now();
    const harness = makeHarness({
      filterHostSelector: `#${_panel}Filter`,
      initialPreset: preset,
    });
    const container = document.createElement('div');
    document.body.appendChild(container);

    harness.lifecycle.mount(container);
    expect(container.querySelector('.period-filter')).toBeNull();
    await harness.lifecycle.reload();

    const range = harness.loads[0]!.range;
    if (preset === 'all') {
      // 'all' IS unbounded — that is the declared preset, not a fallback.
      expect(range).toEqual({});
      return;
    }
    // presetToRange's rolling-window contract, asserted exactly: since is
    // `until` minus N whole days, and `until` is the load's own now.
    const now = Date.now();
    expect(now - range.until!).toBeLessThanOrEqual(60_000);
    const days = preset === 'last7' ? 7 : preset === 'last30' ? 30 : 90;
    expect(range.until! - range.since!).toBe(days * DAY_MS);
    expect(range.until!).toBeGreaterThanOrEqual(before);
    expect(presetToRange(preset, range.until!)).toEqual({
      since: range.since,
      until: range.until,
    });
  });
});
