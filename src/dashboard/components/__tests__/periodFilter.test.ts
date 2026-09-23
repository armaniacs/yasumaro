// @vitest-environment jsdom
/**
 * periodFilter unit tests: preset math (injectable now), custom-range
 * inclusivity, DOM behavior (aria-pressed, labels, onChange payloads).
 */
import { describe, it, expect, vi } from 'vitest';
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

  it('emits the initial preset range once on creation', () => {
    const { calls } = mount('last7');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.preset).toBe('last7');
    expect(calls[0]!.range).toEqual({ since: NOW - 7 * DAY_MS, until: NOW });
  });

  it('preset click updates aria-pressed and emits since/until', () => {
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
    const last = calls[calls.length - 1]!;
    expect(last.preset).toBe('today');
    expect(last.range).toEqual({ since: localMidnight(NOW), until: NOW });
    handle.destroy();
  });

  it('all preset emits unbounded range', () => {
    const { handle, calls } = mount();
    (handle.element.querySelector('button[data-preset="all"]') as HTMLButtonElement).click();
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
    const last = calls[calls.length - 1]!;
    expect(last.range.since).toBe(new Date('2026-09-01T00:00:00').getTime());
    expect(last.range.until).toBe(endOfLocalDay(new Date('2026-09-10T00:00:00').getTime()));
    for (const btn of handle.element.querySelectorAll('button.period-filter-preset')) {
      expect(btn.getAttribute('aria-pressed')).toBe('false');
    }
    handle.destroy();
  });

  it('setPreset drives the same path as a click', () => {
    const { handle, calls } = mount('all');
    handle.setPreset('last90');
    expect(handle.getActivePreset()).toBe('last90');
    expect(handle.getRange()).toEqual({ since: NOW - 90 * DAY_MS, until: NOW });
    expect(calls[calls.length - 1]!.preset).toBe('last90');
    handle.destroy();
  });

  it('uses no inline handlers', () => {
    const { handle } = mount();
    expect(handle.element.innerHTML).not.toContain('onchange');
    expect(handle.element.innerHTML).not.toContain('onclick');
    handle.destroy();
  });
});
