/**
 * previewPresenter.ts
 * Owns resolvePromise + ResizeObserver lifecycle, delegates to MaskNavigator + PreviewView.
 */

import { getMessage } from '../utils/i18n.js';
import { getPluralKey } from '../utils/i18nPlural.js';
import type { MaskedItem } from '../messaging/types.js';
import { logError, ErrorCode } from '../utils/logger.js';
import { MaskNavigator } from './maskNavigator.js';
import { PreviewViewImpl } from './previewView.js';
import type { PreviewView } from './previewView.js';

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
  let badgeText = '';
  switch (cleansedReason) {
    case 'hard':
      badgeText = getMessage('cleansedBadgeHard') || '🧹 Hard';
      break;
    case 'keyword':
      badgeText = getMessage('cleansedBadgeKeyword') || '🧹 Keyword';
      break;
    case 'both':
      badgeText = getMessage('cleansedBadgeBoth') || '🧹 Both';
      break;
  }
  if (cleanseStats && cleanseStats.totalRemoved > 0) {
    const details: string[] = [];
    if (cleanseStats.hardStripRemoved > 0) details.push(`Hard: ${cleanseStats.hardStripRemoved}`);
    if (cleanseStats.keywordStripRemoved > 0) details.push(`Keyword: ${cleanseStats.keywordStripRemoved}`);
    if (details.length > 0) badgeText += ` (${details.join(', ')})`;
  }
  cleansingBadge.textContent = badgeText;
  cleansingBadge.className = 'cleansing-badge';
}

export class PreviewPresenter {
  private resolvePromise: ((result: ConfirmationResult) => void) | null = null;
  private rejectPromise: ((err: Error) => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private modalEventListenersAttached = false;
  private boundHandleActionTrue: () => void;
  private boundHandleActionFalse: () => void;
  private boundHandleClose: () => void;

  constructor(
    private view: PreviewView = new PreviewViewImpl(document),
    private navigator: MaskNavigator = new MaskNavigator()
  ) {
    this.boundHandleActionTrue = () => this.handleAction(true);
    this.boundHandleActionFalse = () => this.handleAction(false);
    this.boundHandleClose = () => {
      if (this.resolvePromise) {
        const resolve = this.resolvePromise;
        this.resolvePromise = null;
        this.rejectPromise = null;
        resolve({ confirmed: false, content: null });
      }
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

    const shouldAttach = !this.modalEventListenersAttached;
    if (modal && closeModalBtn && cancelBtn && confirmBtn && shouldAttach) {
      closeModalBtn.addEventListener('click', this.boundHandleActionFalse);
      cancelBtn.addEventListener('click', this.boundHandleActionFalse);
      confirmBtn.addEventListener('click', this.boundHandleActionTrue);
      modal.addEventListener('close', this.boundHandleClose);
      this.modalEventListenersAttached = true;
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
    this.modalEventListenersAttached = false;
  }

  showPreview(
    content: string,
    maskedItems: (string | MaskedItem)[] | null = null,
    maskedCount: number = 0,
    cleansedReason?: 'hard' | 'keyword' | 'both' | 'none',
    cleanseStats?: { hardStripRemoved: number; keywordStripRemoved: number; totalRemoved: number }
  ): Promise<ConfirmationResult> {
    const modal = this.view.getModal();
    const previewContent = this.view.getPreviewContent();
    const modalBody = modal?.querySelector('.modal-body');

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
      logError('Modal or preview content not found in DOM', {}, ErrorCode.INTERNAL_ERROR);
      this.resolvePromise = null;
      this.rejectPromise = null;
      return;
    }
    const resolve = this.resolvePromise;
    this.resolvePromise = null;
    this.rejectPromise = null;
    // close fires 'close' event synchronously — detach guard by nulling first
    try {
      modal.close();
    } catch {
      (modal as unknown as { open: boolean }).open = false;
      modal.dispatchEvent(new Event('close'));
    }
    this.view.doc.body.style.width = DEFAULT_WIDTH;
    const content = (previewContent as HTMLTextAreaElement).value;
    resolve({ confirmed, content: confirmed ? content : null });
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
