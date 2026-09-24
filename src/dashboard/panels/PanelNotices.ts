/**
 * PanelNotices.ts
 * Named notice management for the dashboard panels: one owner for the
 * empty/error surface swap and the visibility reset dance that the async-data
 * panels previously hand-wired with drifted policies (false-empty on failure,
 * stale notices, per-panel data-i18n swapping).
 *
 * Semantics:
 * - `register(name, element, opts)` stores an element under a panel-local
 *   name; registering a null element (querySelector miss) is a no-op so
 *   panels can pass querySelector results directly. Re-registering a name
 *   replaces the entry, so mount is idempotent.
 * - The name `empty` is special: that element doubles as the error surface.
 *   `showError(key, fallback)` swaps its data-i18n binding and text to the
 *   error wording and shows it, so a persistent query failure is never
 *   rendered as "no records". `showEmpty()` restores the NORMAL binding
 *   (i18nKey/fallbackText registered at construction) and shows it;
 *   `setEmptyMessage(key, fallback)` syncs a different normal wording
 *   (e.g. a period-aware empty state) without changing visibility.
 * - `show` / `hide` / `hideAll` are idempotent visibility helpers. The
 *   per-fetch text of special notices (row caps, excluded counts, unmeasured
 *   ratios) stays panel-side; only their visibility is managed here.
 * - `reset()` is the fresh-fetch reset: it restores the empty element's
 *   normal binding and hides EVERY registered element, fetch-scoped ones
 *   included — a new fetch invalidates the previous fetch's notices until
 *   its own results decide visibility again.
 * - `resetForReaggregate()` is the re-aggregation reset (granularity/top-N
 *   re-ranks over cached rows, tag-select re-ranking): it restores the empty
 *   binding and hides only non-fetch-scoped elements. `fetchScoped: true`
 *   elements (row-cap notices, the cooccurrence tag-universe truncation)
 *   describe the FETCH, not the current re-aggregation, and survive — the
 *   tagFrequencyTimelinePanel lastFetchCapped / tagCooccurrenceTablePanel
 *   precedents. They leave the screen only via explicit hide calls or the
 *   next fresh fetch's reset().
 *
 * MV3 CSP: DOM writes are textContent + setAttribute only, never innerHTML.
 */

import { getMessageOr } from '../../utils/i18n.js';

export interface NoticeRegistrationOptions {
  /** Normal data-i18n binding restored by reset() on the `empty` element. */
  i18nKey?: string;
  /** Fallback text for the normal binding when the key has no translation. */
  fallbackText?: string;
  /** Fetch-scoped notices survive resetForReaggregate(); see module docs. */
  fetchScoped?: boolean;
}

interface NoticeEntry {
  element: HTMLElement;
  fetchScoped: boolean;
}

const EMPTY_NAME = 'empty';

export class PanelNotices {
  private notices = new Map<string, NoticeEntry>();
  private emptyKey: string | null = null;
  private emptyFallback = '';

  register(name: string, element: HTMLElement | null, opts: NoticeRegistrationOptions = {}): void {
    if (!element) return;
    this.notices.set(name, { element, fetchScoped: opts.fetchScoped === true });
    if (name === EMPTY_NAME) {
      this.emptyKey = opts.i18nKey ?? null;
      this.emptyFallback = opts.fallbackText ?? '';
    }
  }

  show(name: string): void {
    const entry = this.notices.get(name);
    if (entry) entry.element.hidden = false;
  }

  hide(name: string): void {
    const entry = this.notices.get(name);
    if (entry) entry.element.hidden = true;
  }

  hideAll(): void {
    for (const { element } of this.notices.values()) {
      element.hidden = true;
    }
  }

  /**
   * Syncs the empty element's data-i18n binding + text WITHOUT changing
   * visibility — the reload-start binding restore (a later language switch
   * re-applies the same message instead of a stale one).
   */
  setEmptyMessage(key: string, fallback: string): void {
    const entry = this.notices.get(EMPTY_NAME);
    if (!entry) return;
    entry.element.setAttribute('data-i18n', key);
    entry.element.textContent = getMessageOr(key, fallback);
  }

  /**
   * Sets a registered element's text WITHOUT changing visibility — the
   * panel computes the localized string (substitutions stay panel-side)
   * and hands the finished text over.
   */
  setMessage(name: string, text: string): void {
    const entry = this.notices.get(name);
    if (entry) entry.element.textContent = text;
  }

  /** Empty element: normal wording (or an explicit override) + show. */
  showEmpty(key?: string, fallback?: string): void {
    const entry = this.notices.get(EMPTY_NAME);
    if (!entry) return;
    const resolvedKey = key ?? this.emptyKey;
    if (resolvedKey) {
      entry.element.setAttribute('data-i18n', resolvedKey);
      entry.element.textContent = getMessageOr(resolvedKey, fallback ?? this.emptyFallback);
    }
    entry.element.hidden = false;
  }

  /** Empty element doubles as the error surface: error wording + show. */
  showError(key: string, fallback: string): void {
    this.setEmptyMessage(key, fallback);
    this.show(EMPTY_NAME);
  }

  /** Fresh-fetch reset: normal binding restored, every notice hidden. */
  reset(): void {
    this.restoreEmptyBinding();
    this.hideAll();
  }

  /** Re-aggregation reset: fetch-scoped notices survive; see module docs. */
  resetForReaggregate(): void {
    this.restoreEmptyBinding();
    for (const { element, fetchScoped } of this.notices.values()) {
      if (!fetchScoped) element.hidden = true;
    }
  }

  /** Drops every registration (panel destroy), releasing element refs. */
  clear(): void {
    this.notices.clear();
    this.emptyKey = null;
    this.emptyFallback = '';
  }

  private restoreEmptyBinding(): void {
    if (!this.emptyKey) return;
    this.setEmptyMessage(this.emptyKey, this.emptyFallback);
  }
}
