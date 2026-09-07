// @layer 1 — Copy-markdown button factory (depends on Layer 0 only, no chrome.* dependency)

import { copyTextToClipboard } from './clipboard.js';
import { formatEntryToMarkdown } from './markdownFormatter.js';
import type { BrowsingLogEntry } from './sqlite-types.js';

/**
 * Feedback reset delay shared by dashboard and popup. Fixed as a constant
 * (not a per-caller argument default): both call sites used 2000ms with no
 * difference, so a single constant keeps the behavior in one place.
 */
export const COPY_FEEDBACK_RESET_MS = 2000;

export interface CopyMarkdownButtonLabels {
  initialText: string;
  successText: string;
  failureText: string;
  initialAriaLabel?: string;
  successAriaLabel?: string;
  failureAriaLabel?: string;
}

export interface CopyMarkdownButtonOptions {
  className?: string;
  labels: CopyMarkdownButtonLabels;
  timeoutMs?: number;
}

/**
 * Create a copy-markdown button owning the 4-step flow: entry → markdown
 * conversion → clipboard copy → success/failure display → aria update with
 * timed reset to the original display.
 *
 * Callers pass already-resolved label strings (i18n resolution stays at the
 * call site) so this factory keeps no chrome.* dependency. Wording follows
 * the pre-existing call-site texts verbatim (no new i18n keys).
 */
export function createCopyMarkdownButton(
  entry: BrowsingLogEntry,
  opts: CopyMarkdownButtonOptions,
): HTMLButtonElement {
  const { labels, className, timeoutMs = COPY_FEEDBACK_RESET_MS } = opts;
  const button = document.createElement('button');
  button.type = 'button';
  if (className) button.className = className;
  button.textContent = labels.initialText;
  if (labels.initialAriaLabel !== undefined) {
    button.setAttribute('aria-label', labels.initialAriaLabel);
  }

  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const markdown = formatEntryToMarkdown(entry);
      await copyTextToClipboard(markdown);
      button.textContent = labels.successText;
      if (labels.successAriaLabel !== undefined) {
        button.setAttribute('aria-label', labels.successAriaLabel);
      }
      setTimeout(() => {
        button.textContent = labels.initialText;
        if (labels.initialAriaLabel !== undefined) {
          button.setAttribute('aria-label', labels.initialAriaLabel);
        }
        button.disabled = false;
      }, timeoutMs);
    } catch {
      button.textContent = labels.failureText;
      if (labels.failureAriaLabel !== undefined) {
        button.setAttribute('aria-label', labels.failureAriaLabel);
      }
      setTimeout(() => {
        button.textContent = labels.initialText;
        if (labels.initialAriaLabel !== undefined) {
          button.setAttribute('aria-label', labels.initialAriaLabel);
        }
        button.disabled = false;
      }, timeoutMs);
    }
  });

  return button;
}
