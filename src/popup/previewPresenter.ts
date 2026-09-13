/**
 * previewPresenter.ts
 * Owns resolvePromise + ResizeObserver lifecycle, delegates to MaskNavigator + PreviewView.
 */

import { getMessage } from '../utils/i18n.js';
import { getPluralKey } from '../utils/i18nPlural.js';
import { buildCleansingCountDetail, getCleansedBadgeText } from '../utils/cleansingBadge.js';
import type { MaskedItem } from '../messaging/types.js';
import { logError, ErrorCode } from '../utils/logger.js';
import { MaskNavigator } from './maskNavigator.js';
import { PreviewViewImpl } from './previewView.js';
import type { PreviewView } from './previewView.js';
import { focusTrapManager } from '../utils/ui/focusTrap.js';

export interface ConfirmationResult {
  confirmed: boolean;
  content: string | null;
}

const PII_TYPE_LABELS: Record<string, () => string> = {
  creditCard: () => getMessage('piiCreditCard'),
  myNumber: () => getMessage('piiMyNumber'),
  bankAccount: () => getMessage('piiBankAccount'),
  email: () => getMessage('piiEmail'),
  phoneJp: () => getMessage('piiPhoneJp'),
};

const DEFAULT_WIDTH = '320px';

function buildMaskStatusText(maskedItems: (string | MaskedItem)[] | null, maskedCount: number): string {
  if (!Array.isArray(maskedItems) || maskedItems.length === 0) {
    return getMessage(getPluralKey('maskStatusCount', maskedCount), { count: maskedCount });
  }
  const typeCounts: Record<string, number> = {};
  for (const item of maskedItems) {
    const type = typeof item === 'string' ? item : (item as MaskedItem).type;
    const labelFunction = PII_TYPE_LABELS[type];
    const label = labelFunction ? labelFunction() : type;
    typeCounts[label] = (typeCounts[label] || 0) + 1;
  }
  const details = Object.entries(typeCounts)
    .map(([label, count]) => `${label}${getMessage(getPluralKey('itemsCount', count), { count })}`)
    .join(getMessage('items'));
  return getMessage('maskStatusDetails', { details });
}

function updateCleansingInfo(
  doc: Document,
  cleansedReason?: 'hard' | 'keyword' | 'both' | 'none',
  cleanseStats?: { hardStripRemoved: number; keywordStripRemoved: number; totalRemoved: number }
): void {
  const cleansingInfo = doc.getElementById('cleansingInfo');
  const cleansingBadge = doc.getElementById('cleansingBadge');
  if (!cleansingInfo || !cleansingBadge) return;
  if (!cleansedReason || cleansedReason === 'none') {
    cleansingInfo.classList.add('hidden');
    cleansingBadge.textContent = '';
    return;
  }
  cleansingInfo.classList.remove('hidden');
  // PBI 2026-09-11-05: badge text comes from the shared CleansingBadge table
  // (same table as statusPanel) instead of a per-view switch.
  // PBI 2026-09-11-07: the count detail is also badge-module policy now
  // (i18n'd — was an English literal).
  let badgeText = getCleansedBadgeText(cleansedReason, getMessage);
  if (cleanseStats && cleanseStats.totalRemoved > 0) {
    const detail = buildCleansingCountDetail(cleanseStats, getMessage);
    if (detail) badgeText += ` (${detail})`;
  }
  cleansingBadge.textContent = badgeText;
  cleansingBadge.className = 'cleansing-badge';
}

export class PreviewPresenter {
  private resolvePromise: ((result: ConfirmationResult) => void) | null = null;
  private rejectPromise: ((err: Error) => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private trapId: string | null = null;
  private boundHandleActionTrue: () => void;
  private boundHandleActionFalse: () => void;
  private boundHandleClose: () => void;

  constructor(
    private view: PreviewView = new PreviewViewImpl(document),
    private navigator: MaskNavigator = new MaskNavigator()
  ) {
    this.boundHandleActionTrue = () => this.handleAction(true);
    this.boundHandleActionFalse = () => this.handleAction(false);
    // PBI 2026-09-11-03 (round 6): routes through the settle seam — nulls
    // callbacks + disconnects observer + releases trap + settles once.
    this.boundHandleClose = () => {
      if (!this.resolvePromise) return;
      this.settle({ confirmed: false, content: null });
    };
  }

  getNavigator(): MaskNavigator {
    return this.navigator;
  }
  getView(): PreviewView {
    return this.view;
  }

  initializeModalEvents(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    const modal = this.view.getModal();
    const doc = this.view.doc;
    const closeModalBtn = doc.getElementById('closeModalBtn');
    const cancelBtn = doc.getElementById('cancelPreviewBtn');
    const confirmBtn = doc.getElementById('confirmPreviewBtn');

    // PBI 2026-09-11-03 (round 6): detach-then-attach unconditionally — the
    // modal DOM may have been rebuilt between shows (or a previous cleanup
    // may or may not have run), so idempotent re-wiring beats a flag whose
    // claim ("attached") no longer matches the nodes.
    modal?.removeEventListener('close', this.boundHandleClose);
    doc.getElementById('closeModalBtn')?.removeEventListener('click', this.boundHandleActionFalse);
    doc.getElementById('cancelPreviewBtn')?.removeEventListener('click', this.boundHandleActionFalse);
    doc.getElementById('confirmPreviewBtn')?.removeEventListener('click', this.boundHandleActionTrue);

    if (modal && closeModalBtn && cancelBtn && confirmBtn) {
      closeModalBtn.addEventListener('click', this.boundHandleActionFalse);
      cancelBtn.addEventListener('click', this.boundHandleActionFalse);
      confirmBtn.addEventListener('click', this.boundHandleActionTrue);
      modal.addEventListener('close', this.boundHandleClose);
    }

    const previewContent = this.view.getPreviewContent();
    if (previewContent && modal && typeof ResizeObserver !== 'undefined') {
      const obs = new ResizeObserver(() => {
        if (!modal.open) return;
        const needed = (previewContent as HTMLElement).offsetWidth + 60;
        const minWidth = 320;
        doc.body.style.width = Math.max(needed, minWidth) + 'px';
      });
      this.resizeObserver = obs;
      obs.observe(previewContent);
    }
  }

  cleanupModalEvents(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.releaseTrap();
    // PBI 2026-09-11-03 (round 6): actually detach — the old cleanup only
    // lowered the flag while the bound handlers stayed attached, so every
    // cleanup→init cycle stacked duplicate click/close listeners (benign
    // only because the settle null-guard absorbed the doubles).
    const modal = this.view.getModal();
    const doc = this.view.doc;
    doc.getElementById('closeModalBtn')?.removeEventListener('click', this.boundHandleActionFalse);
    doc.getElementById('cancelPreviewBtn')?.removeEventListener('click', this.boundHandleActionFalse);
    doc.getElementById('confirmPreviewBtn')?.removeEventListener('click', this.boundHandleActionTrue);
    modal?.removeEventListener('close', this.boundHandleClose);
  }

  showPreview(
    content: string,
    maskedItems: (string | MaskedItem)[] | null = null,
    maskedCount: number = 0,
    cleansedReason?: 'hard' | 'keyword' | 'both' | 'none',
    cleanseStats?: { hardStripRemoved: number; keywordStripRemoved: number; totalRemoved: number }
  ): Promise<ConfirmationResult> {
    const modal = this.view.getModal();

    this.initializeModalEvents();

    if (!modal) {
      logError('Confirmation modal not found in DOM', {}, ErrorCode.INTERNAL_ERROR);
      return Promise.resolve({ confirmed: true, content });
    }

    const statusText = maskedCount > 0 ? buildMaskStatusText(maskedItems, maskedCount) : '';
    this.view.updateMaskStatus(statusText, maskedCount > 0);

    updateCleansingInfo(this.view.doc, cleansedReason, cleanseStats);

    this.view.setPreviewContent(content || '');

    this.navigator.setText(content || '');
    const positions = this.navigator.getPositions();

    // Build navigation — delegate to view but bind to navigator actions
    this.view.buildNavigation(
      positions,
      () => this.jumpToPrevMasked(),
      () => this.jumpToNextMasked()
    );

    // show modal
    if (typeof modal.showModal === 'function') {
      try {
        modal.showModal();
      } catch {
        (modal as unknown as { open: boolean }).open = true;
      }
    } else {
      (modal as unknown as { open: boolean }).open = true;
    }

    this.trapModal(modal);

    if (positions.length > 0) {
      this.jumpToMaskedPosition(0);
    } else {
      this.view.focusPreview();
    }

    const promise = new Promise<ConfirmationResult>((resolve, reject) => {
      if (this.resolvePromise && this.rejectPromise) {
        const prevReject = this.rejectPromise;
        this.resolvePromise = null;
        this.rejectPromise = null;
        prevReject(new Error('Preview superseded by consecutive showPreview'));
      }
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
    // Prevent unhandled-rejection warnings for callers that ignore the promise
    // (e.g. legacy tests) while still allowing `await` to observe the rejection.
    promise.catch(() => {});
    return promise;
  }

  private handleAction(confirmed: boolean): void {
    if (!this.resolvePromise) return;
    const modal = this.view.getModal();
    const previewContent = this.view.getPreviewContent();
    if (!modal || !previewContent) {
      // PBI 2026-09-11-03 (round 6): DOM nodes vanished mid-confirm. The old
      // code nulled both callbacks without settling — the caller's promise
      // hung forever (the record flow's only permanent-hang path). Reject.
      const message = 'Preview modal or content not found in DOM';
      logError(message, {}, ErrorCode.INTERNAL_ERROR);
      this.settle({ error: new Error(message) });
      return;
    }
    const content = (previewContent as HTMLTextAreaElement).value;
    // Settle BEFORE modal.close(): the synchronous 'close' event routes to
    // boundHandleClose, whose null-guard then no-ops (exactly-one-settle).
    this.settle({ confirmed, content: confirmed ? content : null });
    try {
      modal.close();
    } catch {
      (modal as unknown as { open: boolean }).open = false;
      modal.dispatchEvent(new Event('close'));
    }
    this.view.doc.body.style.width = DEFAULT_WIDTH;
  }

  /**
   * PBI 2026-09-11-03 (round 6): the single settlement seam — nulls the
   * pending callbacks, disconnects the resize observer, releases the focus
   * trap, and settles the caller's promise exactly once. handleAction
   * (both branches) and boundHandleClose route through here; the supersede
   * path in showPreview does NOT (the fresh show owns the new observer/trap,
   * so tearing down there would kill the replacement's lifecycle).
   */
  private settle(result: ConfirmationResult | { error: Error }): void {
    const resolve = this.resolvePromise;
    const reject = this.rejectPromise;
    this.resolvePromise = null;
    this.rejectPromise = null;
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.releaseTrap();
    if ('error' in result) {
      reject?.(result.error);
    } else {
      resolve?.(result);
    }
  }

  /**
   * Trap focus inside the confirmation modal. Releases any previous trap
   * first so consecutive showPreview calls never double-trap.
   * Escape is routed to the existing cancel path (handleAction(false)).
   */
  private trapModal(modal: HTMLDialogElement): void {
    this.releaseTrap();
    this.trapId = focusTrapManager.trap(modal, () => this.handleAction(false));
  }

  private releaseTrap(): void {
    if (this.trapId) {
      focusTrapManager.release(this.trapId);
      this.trapId = null;
    }
  }

  private jumpToMaskedPosition(index: number): void {
    const positions = this.navigator.getPositions();
    if (positions.length === 0) return;
    this.navigator.jumpTo(index);
    const pos = this.navigator.getCurrent();
    if (!pos) return;
    this.view.jumpToPosition(pos, index, positions.length);
  }

  jumpToNextMasked(): void {
    if (this.navigator.getCount() === 0) return;
    const next = this.navigator.next();
    const pos = this.navigator.getCurrent();
    if (!pos) return;
    this.view.jumpToPosition(pos, next, this.navigator.getCount());
  }

  jumpToPrevMasked(): void {
    if (this.navigator.getCount() === 0) return;
    const prev = this.navigator.prev();
    const pos = this.navigator.getCurrent();
    if (!pos) return;
    this.view.jumpToPosition(pos, prev, this.navigator.getCount());
  }
}
