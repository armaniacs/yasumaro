/**
 * sanitizePreview.ts
 * Facade over PreviewPresenter / PreviewView / MaskNavigator
 * Preserves public API for existing callers while delegating to presenter.
 */

import type { MaskedItem } from '../messaging/types.js';
import { PreviewPresenter } from './previewPresenter.js';
import type { ConfirmationResult } from './previewPresenter.js';
import { PreviewViewImpl } from './previewView.js';
import { MaskNavigator } from './maskNavigator.js';

export type { MaskedPosition } from './maskNavigator.js';
export type { ConfirmationResult } from './previewPresenter.js';

// Singleton presenter for module-level API (backward compat)
// Lazy-initialized to allow Document injection in tests via resetForTesting.
let presenter: PreviewPresenter | null = null;

function getPresenter(): PreviewPresenter {
  if (!presenter) {
    presenter = new PreviewPresenter(new PreviewViewImpl(document), new MaskNavigator());
  }
  return presenter;
}

/** Test hook: create an isolated presenter with injected Document. No global singleton mutation via jest.resetModules needed. */
export function createPresenter(doc: Document = document): PreviewPresenter {
  return new PreviewPresenter(new PreviewViewImpl(doc), new MaskNavigator());
}

/** For tests that need to isolate global singleton between cases without resetModules */
export function __resetPresenterForTesting(): void {
  if (presenter) {
    presenter.cleanupModalEvents();
  }
  presenter = null;
}

export function initializeModalEvents(): void {
  getPresenter().initializeModalEvents();
}

export function cleanupModalEvents(): void {
  getPresenter().cleanupModalEvents();
}

export function showPreview(
  content: string,
  maskedItems: (string | MaskedItem)[] | null = null,
  maskedCount: number = 0,
  cleansedReason?: 'hard' | 'keyword' | 'both' | 'none',
  cleanseStats?: { hardStripRemoved: number; keywordStripRemoved: number; totalRemoved: number }
): Promise<ConfirmationResult> {
  return getPresenter().showPreview(content, maskedItems, maskedCount, cleansedReason, cleanseStats);
}

export function jumpToNextMasked(): void {
  getPresenter().jumpToNextMasked();
}

export function jumpToPrevMasked(): void {
  getPresenter().jumpToPrevMasked();
}

// Re-export pure navigator helpers for direct testing without DOM
export { collectPositions, nextIndex, prevIndex, MaskNavigator } from './maskNavigator.js';
export { PreviewViewImpl } from './previewView.js';
export { PreviewPresenter } from './previewPresenter.js';
