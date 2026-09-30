/**
 * asyncDataPanelLifecycle.ts
 * The shared reload skeleton of the async-data analysis panels (PBI
 * 2026-09-28-09). It owns exactly four duties — resolve the period-filter
 * host, mount `createPeriodFilter`, run `reload` under the loadSeq guard, and
 * tear down on `destroy`.
 *
 * WHY: nine panels hand-wrote the same seq++ / clear / notices.reset / fetch
 * / seq-compare / catch sequence, and the period fallback drifted with it.
 * Four panels fell back to an unbounded `{}` when the filter host was missing
 * while three fell back to their declared preset, so timeHeatmapPanel
 * advertised 'last90' and queried all time whenever the host was absent. One
 * owner makes both impossible to diverge.
 *
 * Scope: this is the OUTER ring only. Fetching stays in `fetchPeriodRows` and
 * drawing stays inside each panel. Notice keys, notice instances, the range
 * and the panel's own teardown arrive as options, so no panel name leaks in
 * here. Render policy, retry, abort control and caching are deliberately
 * absent — they are not requirements yet, and adding them would bury the seq
 * guard this module exists to centralize.
 */

import {
  createPeriodFilter,
  presetToRange,
  type PeriodButtonPreset,
  type PeriodFilterHandle,
  type PeriodRange,
} from '../../components/periodFilter.js';
import type { PanelNotices } from '../PanelNotices.js';

/** Per-load context handed to a panel's fetch/render body. */
export interface AsyncDataPanelLoad {
  /**
   * Frozen filter selection for this load. Reading it once is what lets the
   * body reuse one consistent window across its awaits (PBI 2026-09-24-11
   * getRange() contract).
   */
  readonly range: PeriodRange;
  /**
   * True once a newer load started or the panel was destroyed. Panels whose
   * body awaits between fetch and draw (narrowing, cooccurrence) must check
   * this before touching the DOM, so a stale load never overwrites a newer
   * render.
   */
  isStale(): boolean;
}

export interface AsyncDataPanelLifecycleOptions {
  /** Panel log prefix — the console label the ring logs under. */
  label: string;
  /**
   * Notice scopes reset per load and cleared on destroy. One entry per panel
   * for the single-notice panels; the two-comparison panel passes one per
   * compared half.
   */
  notices: readonly PanelNotices[];
  /** True once the panel's own hosts are resolved; a load without them is a no-op. */
  isReady: () => boolean;
  /** Clears the panel's output for a fresh fetch (SVG children vs innerHTML). */
  resetOutput: () => void;
  /**
   * Fetch + render body. The panel keeps its own catch so the empty/error
   * notice keys and the error wording stay panel-owned; a throw that escapes
   * it is logged by the ring and does not reject `reload`.
   */
  load: (load: AsyncDataPanelLoad) => Promise<void>;
  /**
   * Container selector of the period-filter host. Omit for the panel with no
   * period filter (revisitInsightsPanel) and for the one that owns its own
   * date inputs (tagClusterTimeSliderPanel).
   */
  filterHostSelector?: string;
  /**
   * Preset the panel declares, and the range used when the host is missing.
   * Together with `filterHostSelector` it must be present or absent together.
   */
  initialPreset?: PeriodButtonPreset;
  /**
   * Auto-apply host: a user selection refetches immediately. Explicit-apply
   * hosts (a Run button reads the range at apply time) leave it off, which
   * also omits the filter's onChange handler.
   */
  autoApply?: boolean;
  /** Panel teardown beyond the shared one (pan/zoom controllers, timers). */
  teardown?: () => void;
}

export interface AsyncDataPanelLifecycle {
  /** Resolves the period-filter host and mounts the filter into it. */
  mount(container: HTMLElement): void;
  /** Guard → seq bump → output/notices reset → the panel's body. */
  reload(): Promise<void>;
  /**
   * Fresh-fetch notices reset on its own, for a panel that validates input
   * before it can start a load.
   */
  resetNotices(): void;
  /** Seq bump, filter teardown, panel teardown, notices clear. */
  destroy(): void;
}

export function createAsyncDataPanelLifecycle(
  options: AsyncDataPanelLifecycleOptions,
): AsyncDataPanelLifecycle {
  let filterHandle: PeriodFilterHandle | null = null;
  let loadSeq = 0;

  /**
   * The filter's own selection, or the declared preset when the host is
   * missing. PBI 2026-09-28-09 unified this fallback: an absent host must not
   * widen the query past the preset the panel advertises, because the panel
   * still renders "last 90 days" wording over an all-time result.
   */
  function currentRange(): PeriodRange {
    if (filterHandle) return filterHandle.getRange();
    if (!options.initialPreset) return {};
    return presetToRange(options.initialPreset, Date.now());
  }

  function resetNotices(): void {
    for (const notices of options.notices) notices.reset();
  }

  async function reload(): Promise<void> {
    if (!options.isReady()) return;
    // WHY: the bump precedes the reset so a load started while this one is
    // already resetting can still win — the guard is checked after every
    // await, never before the reset.
    const seq = ++loadSeq;
    const range = currentRange();
    const load: AsyncDataPanelLoad = {
      range,
      isStale: () => seq !== loadSeq,
    };
    options.resetOutput();
    // Fresh-fetch reset: restores the normal empty binding in case a
    // previous load failed and swapped in the error message, and hides the
    // notices until this fetch's own results decide visibility.
    resetNotices();
    try {
      await options.load(load);
    } catch (error) {
      // WHY: the ring must not turn a body throw into a rejected load() — the
      // registry fires loads fire-and-forget, so a rejection would surface as
      // an unhandled rejection instead of a logged defect. The panel's own
      // catch still owns the user-visible error state.
      console.error(`[${options.label}] reload failed:`, error);
    }
  }

  function mount(container: HTMLElement): void {
    const selector = options.filterHostSelector;
    const preset = options.initialPreset;
    if (!selector || !preset) return;
    // WHY: a missing host is fail-soft, not an error — the panel's own hosts
    // decide readiness, and currentRange() covers the absent filter.
    const host = container.querySelector(selector);
    if (!host) return;
    filterHandle = createPeriodFilter({
      initialPreset: preset,
      // WHY: an explicit-apply host must record no handler at all — the
      // filter contract distinguishes "no onChange" from "onChange" by
      // whether the host reloads per selection.
      ...(options.autoApply
        ? {
            onChange: () => {
              void reload();
            },
          }
        : {}),
    });
    host.appendChild(filterHandle.element);
  }

  function destroy(): void {
    // WHY: the bump is what makes a load that resolves after destroy a no-op,
    // so it must happen even when there is no filter to tear down.
    loadSeq += 1;
    filterHandle?.destroy();
    filterHandle = null;
    options.teardown?.();
    for (const notices of options.notices) notices.clear();
  }

  return { mount, reload, resetNotices, destroy };
}
