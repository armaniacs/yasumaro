/**
 * periodFilter.ts
 * Shared period-filter component for dashboard analysis panels
 * (PBI 2026-09-24-02; reused by later domain/tag-trend panels).
 *
 * Pure + DOM hybrid: date math lives in exported pure helpers
 * (unit-testable with an injectable `now`), while createPeriodFilter
 * renders preset buttons + two optional custom date inputs and emits
 * `{since, until}` (epoch ms, inclusive) via onChange.
 *
 * Local-time boundaries follow the markdownExport.dateRangeToTimestamps
 * precedent: custom dates cover the whole local day (00:00:00–23:59:59.999).
 */

import { getMessageOr } from '../../utils/i18n.js';

/** Preset buttons rendered by the component. 'custom' is entered via the date inputs. */
export type PeriodPreset = 'today' | 'last7' | 'last30' | 'last90' | 'all' | 'custom';

/** Presets selectable as buttons (excludes 'custom', which has no button). */
export type PeriodButtonPreset = Exclude<PeriodPreset, 'custom'>;

export const PERIOD_BUTTON_PRESETS: readonly PeriodButtonPreset[] = [
  'today',
  'last7',
  'last30',
  'last90',
  'all',
];

/** Inclusive epoch-ms bounds. 'all' is represented as no bounds. */
export interface PeriodRange {
  since?: number;
  until?: number;
}

export const DAY_MS = 86_400_000;

/** Local-midnight start of the day containing `ts`. */
export function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Inclusive local end-of-day (23:59:59.999) of the day containing `ts`. */
export function endOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/**
 * Maps a preset button to inclusive epoch-ms bounds at `now`.
 * 'today' is local midnight..now; day-count presets are rolling windows;
 * 'all' is unbounded (both fields undefined).
 */
export function presetToRange(preset: PeriodButtonPreset, now: number): PeriodRange {
  switch (preset) {
    case 'today':
      return { since: startOfLocalDay(now), until: now };
    case 'last7':
      return { since: now - 7 * DAY_MS, until: now };
    case 'last30':
      return { since: now - 30 * DAY_MS, until: now };
    case 'last90':
      return { since: now - 90 * DAY_MS, until: now };
    case 'all':
      return {};
  }
}

/** Parses a YYYY-MM-DD date-input value as a local-midnight timestamp (NaN when invalid). */
export function parseDateInput(value: string): number {
  if (!value) return NaN;
  return new Date(value + 'T00:00:00').getTime();
}

/**
 * Maps custom date-input values to inclusive bounds. An empty `from`
 * leaves `since` unbounded; an empty `to` defaults `until` to `now`.
 */
export function customRangeToBounds(fromDate: string, toDate: string, now: number): PeriodRange {
  const range: PeriodRange = {};
  const since = parseDateInput(fromDate);
  if (Number.isFinite(since)) range.since = since;
  const untilDay = parseDateInput(toDate);
  range.until = Number.isFinite(untilDay) ? endOfLocalDay(untilDay) : now;
  return range;
}

export interface PeriodFilterOptions {
  /** Initial active preset (default 'last30'). */
  initialPreset?: PeriodButtonPreset;
  /** Clock seam for tests (default Date.now). */
  now?: () => number;
  /** Fired on every preset or custom-date change, including the initial render. */
  onChange: (range: PeriodRange, preset: PeriodPreset) => void;
}

export interface PeriodFilterHandle {
  readonly element: HTMLElement;
  getActivePreset(): PeriodPreset;
  getRange(): PeriodRange;
  setPreset(preset: PeriodButtonPreset): void;
  destroy(): void;
}

const PRESET_LABEL_KEYS: Record<PeriodButtonPreset, { key: string; fallback: string }> = {
  today: { key: 'visitDurationPeriodToday', fallback: 'Today' },
  last7: { key: 'visitDurationPeriodLast7Days', fallback: 'Last 7 days' },
  last30: { key: 'visitDurationPeriodLast30Days', fallback: 'Last 30 days' },
  last90: { key: 'visitDurationPeriodLast90Days', fallback: 'Last 90 days' },
  all: { key: 'visitDurationPeriodAll', fallback: 'All time' },
};

/**
 * Renders the filter into a fresh <fieldset> (caller appends `handle.element`).
 * Buttons carry aria-pressed; date inputs are label-bound; all wiring uses
 * addEventListener (MV3 CSP: no inline handlers).
 */
export function createPeriodFilter(options: PeriodFilterOptions): PeriodFilterHandle {
  const clock = options.now ?? Date.now;
  let activePreset: PeriodPreset = options.initialPreset ?? 'last30';
  let currentRange: PeriodRange = presetToRange(activePreset, clock());

  const fieldset = document.createElement('fieldset');
  fieldset.className = 'period-filter';
  const legend = document.createElement('legend');
  legend.textContent = getMessageOr('visitDurationPeriodLabel', 'Period');
  fieldset.appendChild(legend);

  const buttonWrap = document.createElement('div');
  buttonWrap.className = 'period-filter-presets';
  buttonWrap.setAttribute('role', 'group');
  buttonWrap.setAttribute(
    'aria-label',
    getMessageOr('visitDurationPeriodLabel', 'Period'),
  );
  fieldset.appendChild(buttonWrap);

  const buttons = new Map<PeriodButtonPreset, HTMLButtonElement>();
  for (const preset of PERIOD_BUTTON_PRESETS) {
    const def = PRESET_LABEL_KEYS[preset];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'period-filter-preset';
    button.dataset.preset = preset;
    button.textContent = getMessageOr(def.key, def.fallback);
    button.setAttribute('aria-pressed', String(preset === activePreset));
    button.addEventListener('click', () => {
      setActive(preset, presetToRange(preset, clock()));
    });
    buttons.set(preset, button);
    buttonWrap.appendChild(button);
  }

  const customWrap = document.createElement('div');
  customWrap.className = 'period-filter-custom';
  fieldset.appendChild(customWrap);

  const customLabel = document.createElement('span');
  customLabel.className = 'period-filter-custom-label';
  customLabel.textContent = getMessageOr('visitDurationPeriodCustom', 'Custom');
  customWrap.appendChild(customLabel);

  const fromId = 'periodFilterFrom-' + Math.random().toString(36).slice(2);
  const toId = 'periodFilterTo-' + Math.random().toString(36).slice(2);

  const fromLabel = document.createElement('label');
  fromLabel.htmlFor = fromId;
  fromLabel.textContent = getMessageOr('visitDurationPeriodStart', 'From');
  const fromInput = document.createElement('input');
  fromInput.type = 'date';
  fromInput.id = fromId;
  fromInput.className = 'period-filter-date';

  const toLabel = document.createElement('label');
  toLabel.htmlFor = toId;
  toLabel.textContent = getMessageOr('visitDurationPeriodEnd', 'To');
  const toInput = document.createElement('input');
  toInput.type = 'date';
  toInput.id = toId;
  toInput.className = 'period-filter-date';

  const onCustomChange = (): void => {
    setActive('custom', customRangeToBounds(fromInput.value, toInput.value, clock()));
  };
  fromInput.addEventListener('change', onCustomChange);
  toInput.addEventListener('change', onCustomChange);

  customWrap.appendChild(fromLabel);
  customWrap.appendChild(fromInput);
  customWrap.appendChild(toLabel);
  customWrap.appendChild(toInput);

  function setActive(preset: PeriodPreset, range: PeriodRange): void {
    activePreset = preset;
    currentRange = range;
    for (const [key, button] of buttons) {
      button.setAttribute('aria-pressed', String(key === preset));
    }
    options.onChange(range, preset);
  }

  // WHY: emit once so hosts render the initial window without a second call path.
  options.onChange(currentRange, activePreset);

  return {
    element: fieldset,
    getActivePreset: () => activePreset,
    getRange: () => ({ ...currentRange }),
    setPreset: (preset: PeriodButtonPreset) => {
      setActive(preset, presetToRange(preset, clock()));
    },
    destroy: () => {
      fieldset.remove();
    },
  };
}
