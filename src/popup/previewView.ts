/**
 * previewView.ts
 * DOM abstraction for sanitizePreview — injectable Document.
 */

import { getMessage } from '../utils/i18n.js';
import type { MaskedPosition } from './maskNavigator.js';

export const DOM_IDS = {
  MODAL: 'confirmationModal',
  PREVIEW_CONTENT: 'previewContent',
  MASK_STATUS_MESSAGE: 'maskStatusMessage',
  MASK_NAV: 'maskNav',
  MASK_NAV_PREV: 'maskNavPrev',
  MASK_NAV_NEXT: 'maskNavNext',
  MASK_NAV_COUNTER: 'maskNavCounter',
} as const;

export const CLASS_NAMES = {
  MASK_STATUS_MESSAGE: 'mask-status-message',
} as const;

/**
 * PBI 2026-09-12-37: interface pruned to the implemented seam. The former
 * `show`/`close` duplicated the presenter's inlined modal lifecycle (settle
 * ordering is load-bearing there), `setCleansingInfo` was an empty body, and
 * `resetBodyWidth` duplicated the presenter's DEFAULT_WIDTH constant — the
 * presenter owns modal lifecycle + width, the view owns DOM queries +
 * navigation.
 */
export interface PreviewView {
  readonly doc: Document;
  getModal(): HTMLDialogElement | null;
  getPreviewContent(): HTMLTextAreaElement | null;
  getMaskStatusMessage(): HTMLElement | null;
  setPreviewContent(text: string): void;
  /** Full show flow used by presenter — kept separate for testability */
  ensureMaskStatusElement(): HTMLElement | null;
  updateMaskStatus(text: string, visible: boolean): void;
  focusPreview(): void;
  jumpToPosition(pos: MaskedPosition, index: number, total: number): void;
  buildNavigation(positions: MaskedPosition[], onPrev: () => void, onNext: () => void): void;
  setNavCounter(index: number, total: number): void;
}

export class PreviewViewImpl implements PreviewView {
  readonly doc: Document;

  constructor(doc: Document = document) {
    this.doc = doc;
  }

  getModal(): HTMLDialogElement | null {
    return this.doc.getElementById(DOM_IDS.MODAL) as HTMLDialogElement | null;
  }

  getPreviewContent(): HTMLTextAreaElement | null {
    return this.doc.getElementById(DOM_IDS.PREVIEW_CONTENT) as HTMLTextAreaElement | null;
  }

  getMaskStatusMessage(): HTMLElement | null {
    return this.doc.getElementById(DOM_IDS.MASK_STATUS_MESSAGE);
  }

  setPreviewContent(text: string): void {
    const el = this.getPreviewContent();
    if (el) el.value = text;
  }

  ensureMaskStatusElement(): HTMLElement | null {
    let el = this.getMaskStatusMessage();
    if (el) return el;
    const modal = this.getModal();
    const modalBody = modal?.querySelector('.modal-body');
    if (!modalBody) return null;
    el = this.doc.createElement('div');
    el.id = DOM_IDS.MASK_STATUS_MESSAGE;
    el.className = CLASS_NAMES.MASK_STATUS_MESSAGE;
    modalBody.insertBefore(el, modalBody.firstChild);
    return el;
  }

  updateMaskStatus(text: string, visible: boolean): void {
    const el = this.ensureMaskStatusElement();
    if (!el) return;
    if (visible) {
      el.textContent = text;
      el.style.display = '';
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  focusPreview(): void {
    this.getPreviewContent()?.focus();
  }

  jumpToPosition(pos: MaskedPosition, index: number, total: number): void {
    const el = this.getPreviewContent();
    if (!el) return;
    el.focus();
    try {
      el.setSelectionRange(pos.start, pos.end);
    } catch {
      // jsdom may not support setSelectionRange on non-textarea
    }
    this.setNavCounter(index, total);
  }

  setNavCounter(index: number, total: number): void {
    const counter = this.doc.getElementById(DOM_IDS.MASK_NAV_COUNTER);
    if (counter) counter.textContent = `${index + 1}/${total}`;
  }

  private navHandlers: { prev: (() => void) | null; next: (() => void) | null } = { prev: null, next: null };

  /**
   * Idempotent navigation wiring (PBI 2026-09-12-10): every show rewires
   * prev/next to the current run's callbacks. Previously the buttons were
   * created once and later shows only toggled display, so the second show
   * navigated with the first run's stale closures.
   */
  buildNavigation(
    positions: MaskedPosition[],
    onPrev: () => void,
    onNext: () => void
  ): void {
    const modal = this.getModal();
    const modalBody = modal?.querySelector('.modal-body');
    const anchor = this.doc.getElementById('maskNavAnchor');
    const container: Element | null = (anchor as Element | null) ?? modalBody ?? null;
    if (!container) return;

    let nav = this.doc.getElementById(DOM_IDS.MASK_NAV);
    if (!nav) {
      nav = this.doc.createElement('div');
      nav.id = DOM_IDS.MASK_NAV;

      const prevBtn = this.doc.createElement('button');
      prevBtn.id = DOM_IDS.MASK_NAV_PREV;
      prevBtn.textContent = '▲';

      const nextBtn = this.doc.createElement('button');
      nextBtn.id = DOM_IDS.MASK_NAV_NEXT;
      nextBtn.textContent = '▼';

      const counter = this.doc.createElement('span');
      counter.id = DOM_IDS.MASK_NAV_COUNTER;

      nav.appendChild(prevBtn);
      nav.appendChild(nextBtn);
      nav.appendChild(counter);
      container.appendChild(nav);
    }

    // Always rewire: detach previous run's handlers, attach current ones.
    const prevBtn = this.doc.getElementById(DOM_IDS.MASK_NAV_PREV);
    const nextBtn = this.doc.getElementById(DOM_IDS.MASK_NAV_NEXT);
    if (prevBtn && this.navHandlers.prev) {
      prevBtn.removeEventListener('click', this.navHandlers.prev);
    }
    if (nextBtn && this.navHandlers.next) {
      nextBtn.removeEventListener('click', this.navHandlers.next);
    }
    if (prevBtn) prevBtn.addEventListener('click', onPrev);
    if (nextBtn) nextBtn.addEventListener('click', onNext);
    this.navHandlers = { prev: onPrev, next: onNext };
    this.refreshLabels();

    if (positions.length > 0) {
      (nav as HTMLElement).style.display = 'flex';
      const counter = this.doc.getElementById(DOM_IDS.MASK_NAV_COUNTER);
      if (counter) counter.textContent = `0/${positions.length}`;
    } else {
      (nav as HTMLElement).style.display = 'none';
    }
  }

  /** Re-resolve creation-time labels so a locale switch does not leave stale titles. */
  refreshLabels(): void {
    const prevBtn = this.doc.getElementById(DOM_IDS.MASK_NAV_PREV);
    const nextBtn = this.doc.getElementById(DOM_IDS.MASK_NAV_NEXT);
    if (prevBtn) (prevBtn as HTMLElement).title = getMessage('previousMaskedItem');
    if (nextBtn) (nextBtn as HTMLElement).title = getMessage('nextMaskedItem');
  }
}
