/**
 * previewView.ts
 * DOM abstraction for sanitizePreview — injectable Document.
 */

import { getMessage } from '../utils/i18n.js';
import type { MaskedPosition } from './maskNavigator.js';
import { focusTrapManager } from '../utils/ui/focusTrap.js';

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

export interface PreviewView {
  readonly doc: Document;
  getModal(): HTMLDialogElement | null;
  getPreviewContent(): HTMLTextAreaElement | null;
  getMaskStatusMessage(): HTMLElement | null;
  setPreviewContent(text: string): void;
  show(html: string): void;
  close(): void;
  onConfirm(handler: () => void): void;
  onCancel(handler: () => void): void;
  /** Full show flow used by presenter — kept separate for testability */
  ensureMaskStatusElement(): HTMLElement | null;
  updateMaskStatus(text: string, visible: boolean): void;
  setCleansingInfo(): void;
  resetBodyWidth(): void;
  focusPreview(): void;
  jumpToPosition(pos: MaskedPosition, index: number, total: number): void;
  buildNavigation(positions: MaskedPosition[], onPrev: () => void, onNext: () => void): void;
  setNavCounter(index: number, total: number): void;
}

export class PreviewViewImpl implements PreviewView {
  readonly doc: Document;

  // store handlers for onConfirm/onCancel interface
  private confirmHandlers: Array<() => void> = [];
  private cancelHandlers: Array<() => void> = [];
  private trapId: string | null = null;

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

  /** Minimal interface: show html in textarea and open modal */
  show(html: string): void {
    this.setPreviewContent(html);
    const modal = this.getModal();
    if (modal && typeof modal.showModal === 'function') {
      try {
        modal.showModal();
      } catch {
        // jsdom fallback
        (modal as unknown as { open: boolean }).open = true;
      }
      this.ensureCloseRelease(modal);
      this.releaseTrap();
      // Escape routes to the existing cancel path (close + release)
      this.trapId = focusTrapManager.trap(modal, () => this.close());
    }
  }

  /** Close the modal and release the focus trap (balanced with show) */
  close(): void {
    const modal = this.getModal();
    this.releaseTrap();
    if (!modal) return;
    try {
      modal.close();
    } catch {
      (modal as unknown as { open: boolean }).open = false;
      modal.dispatchEvent(new Event('close'));
    }
  }

  /** 'close' event (native Escape/backdrop/close) must always release the trap */
  private ensureCloseRelease(modal: HTMLDialogElement): void {
    const el = modal as HTMLDialogElement & { dataset: DOMStringMap };
    if (el.dataset.focusTrapWired === 'true') return;
    el.dataset.focusTrapWired = 'true';
    modal.addEventListener('close', () => this.releaseTrap());
  }

  private releaseTrap(): void {
    if (this.trapId) {
      focusTrapManager.release(this.trapId);
      this.trapId = null;
    }
  }

  onConfirm(handler: () => void): void {
    this.confirmHandlers.push(handler);
  }

  onCancel(handler: () => void): void {
    this.cancelHandlers.push(handler);
  }

  /** Exposed for presenter to wire DOM buttons to handlers */
  getConfirmHandlers(): Array<() => void> {
    return this.confirmHandlers;
  }
  getCancelHandlers(): Array<() => void> {
    return this.cancelHandlers;
  }
  clearHandlers(): void {
    this.confirmHandlers = [];
    this.cancelHandlers = [];
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

  setCleansingInfo(): void {
    // placeholder — presenter will update via existing function;
    // view only needs doc access, presenter imports update logic
  }

  resetBodyWidth(): void {
    this.doc.body.style.width = '320px';
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
      prevBtn.title = getMessage('previousMaskedItem');
      prevBtn.addEventListener('click', onPrev);

      const nextBtn = this.doc.createElement('button');
      nextBtn.id = DOM_IDS.MASK_NAV_NEXT;
      nextBtn.textContent = '▼';
      nextBtn.title = getMessage('nextMaskedItem');
      nextBtn.addEventListener('click', onNext);

      const counter = this.doc.createElement('span');
      counter.id = DOM_IDS.MASK_NAV_COUNTER;

      nav.appendChild(prevBtn);
      nav.appendChild(nextBtn);
      nav.appendChild(counter);
      container.appendChild(nav);
    }

    if (positions.length > 0) {
      (nav as HTMLElement).style.display = 'flex';
      const counter = this.doc.getElementById(DOM_IDS.MASK_NAV_COUNTER);
      if (counter) counter.textContent = `0/${positions.length}`;
    } else {
      (nav as HTMLElement).style.display = 'none';
    }
  }
}
