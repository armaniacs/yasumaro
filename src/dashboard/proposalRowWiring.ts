/**
 * proposalRowWiring.ts
 *
 * Shared apply/undo wiring for single proposal rows (PBI 2026-10-23-08).
 * The tag-normalization panel and the domain-intel panel grew the same
 * row shape independently: an apply button, a hidden undo button, and a
 * status line. The shared part is the transitions (apply disables itself,
 * success reveals undo, failure restores the button and reports); the
 * differing part is only how the status text reads, so the callers supply
 * it: success text resolves from the action, failure text defaults to the
 * error message with an optional per-panel formatter (the tag panel uses
 * it to keep its applied-count suffix, the domain panel needs none).
 */

import { errorMessage } from '../utils/errorUtils.js';

/** Button/status selectors resolved against one proposal row element. */
export interface ProposalRowSelectors {
  apply: string;
  undo: string;
  status: string;
}

/**
 * Row actions behind the buttons. Each resolves with the status text to
 * show on success; a rejection shows via the failure text instead.
 */
export interface ProposalRowActions {
  apply: () => Promise<string>;
  undo: () => Promise<string>;
}

/** Optional per-panel failure text. Absent formatters fall back to the error message. */
export interface ProposalRowTexts {
  formatApplyError?: (error: Error) => string;
  formatUndoError?: (error: Error) => string;
}

/**
 * Wires one proposal row's apply/undo buttons to the given actions.
 * The row element scopes every lookup, so each row only drives its own
 * buttons and status line.
 */
export function wireProposalRow(
  row: HTMLElement,
  selectors: ProposalRowSelectors,
  actions: ProposalRowActions,
  texts: ProposalRowTexts = {},
): void {
  const applyButton = row.querySelector<HTMLButtonElement>(selectors.apply);
  const undoButton = row.querySelector<HTMLButtonElement>(selectors.undo);
  const statusEl = row.querySelector<HTMLElement>(selectors.status);
  const showStatus = (message: string): void => {
    if (statusEl) statusEl.textContent = message;
  };
  applyButton?.addEventListener('click', () => {
    void (async () => {
      applyButton.disabled = true;
      try {
        const message = await actions.apply();
        if (undoButton) {
          undoButton.hidden = false;
          undoButton.disabled = false;
        }
        showStatus(message);
      } catch (error) {
        applyButton.disabled = false;
        if (error instanceof Error && texts.formatApplyError) {
          showStatus(texts.formatApplyError(error));
        } else {
          showStatus(errorMessage(error));
        }
      }
    })();
  });
  undoButton?.addEventListener('click', () => {
    void (async () => {
      undoButton.disabled = true;
      try {
        const message = await actions.undo();
        undoButton.hidden = true;
        undoButton.disabled = false;
        if (applyButton) applyButton.disabled = false;
        showStatus(message);
      } catch (error) {
        undoButton.disabled = false;
        if (error instanceof Error && texts.formatUndoError) {
          showStatus(texts.formatUndoError(error));
        } else {
          showStatus(errorMessage(error));
        }
      }
    })();
  });
}
