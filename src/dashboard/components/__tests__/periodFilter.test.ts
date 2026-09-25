// @vitest-environment jsdom
/**
 * periodFilter unit tests: preset math (injectable now), custom-range
 * inclusivity, DOM behavior (aria-pressed, labels, onChange payloads).
 */
import { describe, it, expect, vi } from 'vitest';
import enMessages from '../../../../public/_locales/en/messages.json' with { type: 'json' };
import {
  presetToRange,
  customRangeToBounds,
  parseDateInput,
  startOfLocalDay,
  endOfLocalDay,
  createPeriodFilter,
  DAY_MS,
  type PeriodRange,
  type PeriodPreset,
} from '../periodFilter.js';

// Fixed local noon avoids DST-midnight edge cases in expectations.
const NOW = new Date(2026, 8, 24, 12, 0, 0, 0).getTime();

function localMidnight(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

describe('presetToRange', () => {
  it('today spans local midnight..now', () => {
    expect(presetToRange('today', NOW)).toEqual({ since: localMidnight(NOW), until: NOW });
  });

  it('day-count presets are rolling windows ending at now', () => {
    expect(presetToRange('last7', NOW)).toEqual({ since: NOW - 7 * DAY_MS, until: NOW });
    expect(presetToRange('last30', NOW)).toEqual({ since: NOW - 30 * DAY_MS, until: NOW });
    expect(presetToRange('last90', NOW)).toEqual({ since: NOW - 90 * DAY_MS, until: NOW });
  });

  it('all is unbounded', () => {
    expect(presetToRange('all', NOW)).toEqual({});
  });
});

describe('customRangeToBounds', () => {
  it('covers whole local days inclusively', () => {
    const range = customRangeToBounds('2026-09-01', '2026-09-02', NOW);
    expect(range.since).toBe(new Date('2026-09-01T00:00:00').getTime());
    const untilDate = new Date(range.until!);
    expect(untilDate.getFullYear()).toBe(2026);
    expect(untilDate.getMonth()).toBe(8);
    expect(untilDate.getDate()).toBe(2);
    expect(untilDate.getHours()).toBe(23);
    expect(untilDate.getMinutes()).toBe(59);
    expect(untilDate.getSeconds()).toBe(59);
    expect(untilDate.getMilliseconds()).toBe(999);
  });

  it('empty from leaves since unbounded; empty to defaults until to now', () => {
    const range = customRangeToBounds('', '', NOW);
    expect(range.since).toBeUndefined();
    expect(range.until).toBe(NOW);
  });

  it('single-sided ranges keep the given side', () => {
    const fromOnly = customRangeToBounds('2026-09-01', '', NOW);
    expect(fromOnly.since).toBe(new Date('2026-09-01T00:00:00').getTime());
    expect(fromOnly.until).toBe(NOW);
    const toOnly = customRangeToBounds('', '2026-09-02', NOW);
    expect(toOnly.since).toBeUndefined();
    expect(toOnly.until).toBe(endOfLocalDay(new Date('2026-09-02T00:00:00').getTime()));
  });
});

describe('parseDateInput / day helpers', () => {
  it('parses YYYY-MM-DD as local midnight; NaN on empty/invalid', () => {
    expect(parseDateInput('2026-09-01')).toBe(new Date(2026, 8, 1).getTime());
    expect(parseDateInput('')).toBeNaN();
    expect(parseDateInput('not-a-date')).toBeNaN();
  });

  it('start/end of local day bracket the timestamp', () => {
    expect(startOfLocalDay(NOW)).toBe(localMidnight(NOW));
    expect(endOfLocalDay(NOW)).toBe(localMidnight(NOW) + DAY_MS - 1);
  });
});

describe('createPeriodFilter', () => {
  function mount(initialPreset: 'today' | 'last7' | 'last30' | 'last90' | 'all' = 'last30') {
    const calls: Array<{ range: PeriodRange; preset: PeriodPreset }> = [];
    const handle = createPeriodFilter({
      initialPreset,
      now: () => NOW,
      onChange: (range, preset) => calls.push({ range, preset }),
    });
    document.body.appendChild(handle.element);
    return { handle, calls };
  }

  it('renders fieldset+legend, five preset buttons and two labelled date inputs', () => {
    const { handle } = mount();
    expect(handle.element.tagName).toBe('FIELDSET');
    expect(handle.element.querySelector('legend')).not.toBeNull();
    const buttons = handle.element.querySelectorAll('button.period-filter-preset');
    expect(buttons).toHaveLength(5);
    const dates = handle.element.querySelectorAll('input[type="date"]');
    expect(dates).toHaveLength(2);
    for (const input of dates) {
      const id = input.getAttribute('id');
      expect(handle.element.querySelector(`label[for="${id}"]`)).not.toBeNull();
    }
    handle.destroy();
  });

  it('emits nothing during construction; getRange() is the initial source of truth', () => {
    const { handle, calls } = mount('last7');
    // PBI 2026-09-24-11: construction never calls onChange.
    expect(calls).toHaveLength(0);
    expect(handle.getActivePreset()).toBe('last7');
    expect(handle.getRange()).toEqual({ since: NOW - 7 * DAY_MS, until: NOW });
    handle.destroy();
  });

  it('preset click updates aria-pressed and emits since/until exactly once', () => {
    const { handle, calls } = mount('last30');
    const todayBtn = handle.element.querySelector(
      'button[data-preset="today"]',
    ) as HTMLButtonElement;
    todayBtn.click();
    expect(handle.getActivePreset()).toBe('today');
    expect(todayBtn.getAttribute('aria-pressed')).toBe('true');
    expect(
      handle.element
        .querySelector('button[data-preset="last30"]')!
        .getAttribute('aria-pressed'),
    ).toBe('false');
    // First and only emission: the user interaction itself.
    expect(calls).toHaveLength(1);
    const last = calls[calls.length - 1]!;
    expect(last.preset).toBe('today');
    expect(last.range).toEqual({ since: localMidnight(NOW), until: NOW });
    handle.destroy();
  });

  it('all preset emits unbounded range', () => {
    const { handle, calls } = mount();
    (handle.element.querySelector('button[data-preset="all"]') as HTMLButtonElement).click();
    expect(calls).toHaveLength(1);
    const last = calls[calls.length - 1]!;
    expect(last.preset).toBe('all');
    expect(last.range).toEqual({});
    handle.destroy();
  });

  it('custom date change switches to custom and emits inclusive bounds', () => {
    const { handle, calls } = mount();
    const inputs = handle.element.querySelectorAll('input[type="date"]');
    const from = inputs[0] as HTMLInputElement;
    const to = inputs[1] as HTMLInputElement;
    from.value = '2026-09-01';
    from.dispatchEvent(new Event('change', { bubbles: true }));
    to.value = '2026-09-10';
    to.dispatchEvent(new Event('change', { bubbles: true }));
    expect(handle.getActivePreset()).toBe('custom');
    // One emission per user change (from, then to).
    expect(calls).toHaveLength(2);
    const last = calls[calls.length - 1]!;
    expect(last.range.since).toBe(new Date('2026-09-01T00:00:00').getTime());
    expect(last.range.until).toBe(endOfLocalDay(new Date('2026-09-10T00:00:00').getTime()));
    for (const btn of handle.element.querySelectorAll('button.period-filter-preset')) {
      expect(btn.getAttribute('aria-pressed')).toBe('false');
    }
    handle.destroy();
  });

  it('mirrors the active preset into data-active-preset for the stylesheet', () => {
    const { handle } = mount('last30');
    // The selection is styled via this hook, so it must be set on construction
    // and follow both preset clicks and custom date edits.
    expect(handle.element.dataset.activePreset).toBe('last30');
    (handle.element.querySelector('button[data-preset="today"]') as HTMLButtonElement).click();
    expect(handle.element.dataset.activePreset).toBe('today');
    const from = handle.element.querySelectorAll('input[type="date"]')[0] as HTMLInputElement;
    from.value = '2026-09-01';
    from.dispatchEvent(new Event('change', { bubbles: true }));
    // 'custom' owns no button, so the fieldset hook is the only styling target.
    expect(handle.element.dataset.activePreset).toBe('custom');
    handle.destroy();
  });

  it('setPreset drives the same path as a click', () => {
    const { handle, calls } = mount('all');
    handle.setPreset('last90');
    expect(handle.getActivePreset()).toBe('last90');
    expect(handle.getRange()).toEqual({ since: NOW - 90 * DAY_MS, until: NOW });
    expect(calls).toHaveLength(1);
    expect(calls[calls.length - 1]!.preset).toBe('last90');
    handle.destroy();
  });

  it('injects custom label keys; omitting labelKeys keeps the periodFilter* defaults', () => {
    const injected = createPeriodFilter({
      initialPreset: 'last7',
      now: () => NOW,
      // Unknown keys surface as the key itself (missing-translation convention),
      // proving the injected namespace is consulted instead of the default one.
      labelKeys: {
        today: 'panelXPeriodToday',
        last7: 'panelXPeriodLast7',
        last30: 'panelXPeriodLast30',
        last90: 'panelXPeriodLast90',
        all: 'panelXPeriodAll',
      },
      onChange: () => {},
    });
    document.body.appendChild(injected.element);
    const injectedLabel = (
      injected.element.querySelector('button[data-preset="last7"]') as HTMLButtonElement
    ).textContent;
    expect(injectedLabel).toBe('panelXPeriodLast7');
    injected.destroy();

    const defaulted = createPeriodFilter({
      initialPreset: 'last7',
      now: () => NOW,
      onChange: () => {},
    });
    document.body.appendChild(defaulted.element);
    const defaultLabel = (
      defaulted.element.querySelector('button[data-preset="last7"]') as HTMLButtonElement
    ).textContent;
    // The en mock resolves the unchanged periodFilterLast7Days key.
    expect(defaultLabel).toBe('Last 7 days');
    defaulted.destroy();
  });

  it('resolves its own periodFilter* i18n keys, all present in the real locale', () => {
    // WHY assert the requested KEY, not the rendered text: the two failure
    // modes are not equally loud. Under the vitest mock a missing key resolves
    // to the key string (so a wrong key fails a text assertion), but in
    // production Chrome getMessage returns '' and getMessageOr returns the
    // English literal — a stale key would render untranslated, silently, in
    // every panel. This test fails on the state production cannot report.
    //
    // periodFilter is the only host-wide label source, so one dangling key
    // costs all 6 panels their translation, not one.
    const requested = vi.spyOn(chrome.i18n, 'getMessage');
    const { handle } = mount('last7');
    const keys = requested.mock.calls.map((c) => c[0]);

    for (const key of [
      'periodFilterLabel',
      'periodFilterToday',
      'periodFilterLast7Days',
      'periodFilterLast30Days',
      'periodFilterLast90Days',
      'periodFilterAll',
      'periodFilterCustom',
      'periodFilterStart',
      'periodFilterEnd',
    ]) {
      expect(keys, `component never requested ${key}`).toContain(key);
      expect(key in enMessages, `${key} missing from en locale`).toBe(true);
    }
    requested.mockRestore();
    handle.destroy();
  });

  it('uses no inline handlers', () => {
    const { handle } = mount();
    expect(handle.element.innerHTML).not.toContain('onchange');
    expect(handle.element.innerHTML).not.toContain('onclick');
    handle.destroy();
  });
});
