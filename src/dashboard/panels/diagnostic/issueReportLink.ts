/**
 * issueReportLink.ts (PBI 2026-09-13-45)
 *
 * Builds a sanitized, human-reviewable issue body from a DiagnosticsSnapshot
 * and recent log entries, then opens a prefilled GitHub "new issue" tab.
 *
 * Security contract: buildIssueReportBody() is the ONLY path allowed to turn
 * a DiagnosticsSnapshot into outbound text. It must never forward apiKey,
 * baseUrl, the Obsidian dailyPath, or raw log message contents — only error
 * code names and counts. Callers must not read those snapshot fields
 * directly for reporting purposes.
 */

import type { DiagnosticsSnapshot } from './DiagnosticsCollector.js';
import type { LogEntry } from '../../../utils/logger/types.js';
import { getLogs } from '../../../utils/logger/core.js';
import { getMessageOr } from '../../../utils/i18n.js';

const GITHUB_ISSUE_URL = 'https://github.com/armaniacs/yasumaro/issues/new';
const MAX_ERROR_CODES_LISTED = 10;

function summarizeErrorCodes(logs: LogEntry[]): string {
  const counts = new Map<string, number>();
  for (const log of logs) {
    if (!log.errorCode) continue;
    counts.set(log.errorCode, (counts.get(log.errorCode) ?? 0) + 1);
  }
  if (counts.size === 0) return '(none)';
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ERROR_CODES_LISTED)
    .map(([code, count]) => `${code}: ${count}`)
    .join(', ');
}

function summarizeAiProviders(details: DiagnosticsSnapshot['aiProviderDetails']): string {
  if (details.length === 0) return '(none configured)';
  // Provider/model names only — apiKey and baseUrl are intentionally dropped.
  return details.map((d) => `${d.provider} (${d.model ?? 'no model'})`).join(', ');
}

/**
 * Build the sanitized issue body text. Never includes apiKey, baseUrl, the
 * Obsidian dailyPath, or log message contents — see module doc comment.
 */
export function buildIssueReportBody(snapshot: DiagnosticsSnapshot, recentLogs: LogEntry[]): string {
  const sqliteLine = snapshot.sqlite
    ? `SQLite: initialized=${snapshot.sqlite.initialized}, fallback=${snapshot.sqlite.fallback}, fts5=${snapshot.sqlite.fts5}`
    : 'SQLite: (not initialized)';

  const lines = [
    '## Diagnostic Information',
    '',
    `- Extension version: ${snapshot.extInfo.version}`,
    `- Browser: ${navigator.userAgent}`,
    `- Debug mode: ${snapshot.debugMode}`,
    `- ${sqliteLine}`,
    `- AI providers: ${summarizeAiProviders(snapshot.aiProviderDetails)}`,
    `- Obsidian connection: protocol=${snapshot.obsidian.protocol}, port=${snapshot.obsidian.port}`,
    `- Recent error codes: ${summarizeErrorCodes(recentLogs)}`,
    '',
    '## What happened',
    '',
    '<!-- Describe the problem here -->',
  ];

  return lines.join('\n');
}

/** Build the GitHub "new issue" URL with the sanitized body prefilled. */
export function buildIssueReportUrl(snapshot: DiagnosticsSnapshot, recentLogs: LogEntry[]): string {
  const body = buildIssueReportBody(snapshot, recentLogs);
  const params = new URLSearchParams({
    template: 'bug_report.md',
    body,
  });
  return `${GITHUB_ISSUE_URL}?${params.toString()}`;
}

export interface IssueReportModalElements {
  previewModal: HTMLDialogElement | null;
  previewContent: HTMLTextAreaElement | null;
  cancelBtn: HTMLButtonElement | null;
  closeBtn: HTMLButtonElement | null;
  openBtn: HTMLButtonElement | null;
}

export interface IssueReportModalControllerOptions {
  /**
   * Bounds the diagnostic collection. The collection fans out to sub-probes
   * (settings, SQLite status, logs) that have no timeout of their own, so a
   * single hung probe would otherwise leave the trigger permanently in-flight
   * and the report un-openable. The bound must stay injectable so tests drive
   * it with a fake clock instead of waiting in real time.
   */
  collectionTimeoutMs?: number;
}

const DEFAULT_COLLECTION_TIMEOUT_MS = 15_000;

export interface IssueReportModalController {
  /**
   * Wire one "Report a Bug" entry-point button (diagnostics panel, sidebar,
   * ...) to this controller's shared modal. Safe to call multiple times with
   * different buttons; the modal's own Cancel/Close/Open listeners are
   * attached only once, on controller creation.
   */
  attachTrigger(reportBtn: HTMLButtonElement | null): void;
}

/**
 * Create a controller owning the shared "Report a Bug" preview modal state.
 * The modal and its Cancel/Close/Open buttons are shared, page-level elements
 * (outside any panel); multiple entry-point buttons (diagnostics panel,
 * sidebar, ...) attach to the SAME controller instance via attachTrigger()
 * so a click on any of them is visible to the one set of Cancel/Close/Open
 * listeners wired here, at controller-creation time.
 *
 * The modal opens at click time with a collecting placeholder — the press
 * must always have visible feedback, and a collection that spans awaits must
 * not leave the user staring at an unresponsive button.
 */
export function createIssueReportModalController(
  modalEls: IssueReportModalElements,
  collectSnapshot: () => Promise<DiagnosticsSnapshot>,
  options: IssueReportModalControllerOptions = {},
): IssueReportModalController {
  const { previewModal, previewContent, cancelBtn, closeBtn, openBtn } = modalEls;
  const collectionTimeoutMs = options.collectionTimeoutMs ?? DEFAULT_COLLECTION_TIMEOUT_MS;

  let pendingUrl: string | null = null;
  // Re-entrancy: collectSnapshot spans awaits, so a rapid second click would
  // re-enter the handler and showModal() on the already-open dialog throws
  // InvalidStateError as an unhandled rejection.
  let inFlight = false;
  // Skip duplicate wiring for the same button. WeakSet so entries for
  // removed DOM elements are collectable without manual cleanup.
  const wiredTriggers = new WeakSet<HTMLButtonElement>();

  const closeModal = (): void => {
    pendingUrl = null;
    previewModal?.close();
  };

  if (previewModal && previewContent && openBtn) {
    cancelBtn?.addEventListener('click', closeModal);
    closeBtn?.addEventListener('click', closeModal);

    openBtn.addEventListener('click', () => {
      if (pendingUrl) {
        chrome.tabs.create({ url: pendingUrl });
      }
      closeModal();
    });
  }

  return {
    attachTrigger(reportBtn: HTMLButtonElement | null): void {
      if (!reportBtn || !previewModal || !previewContent || !openBtn) return;
      if (wiredTriggers.has(reportBtn)) return;
      wiredTriggers.add(reportBtn);

      reportBtn.addEventListener('click', () => {
        // Skip while a collection is in flight and while the modal is already
        // open — both cases previously ended in showModal() on an open dialog.
        if (inFlight || previewModal.open) return;
        inFlight = true;
        reportBtn.disabled = true;
        const startedAt = Date.now();
        // Open before collecting, and keep "Open GitHub" disabled until the
        // sanitized body exists — the send-later contract depends on
        // pendingUrl, so a click during collection must not close the modal
        // as if it had opened the issue.
        previewContent.value = getMessageOr('diagBugReportCollecting', 'Collecting diagnostics...');
        pendingUrl = null;
        openBtn.disabled = true;
        previewModal.showModal();
        void (async () => {
          try {
            const collected = await Promise.race([
              (async () => {
                const snapshot = await collectSnapshot();
                const recentLogs = await getLogs();
                return { snapshot, recentLogs };
              })(),
              new Promise<never>((_, reject) => {
                setTimeout(
                  () => reject(new Error('diagnostics collection timed out')),
                  collectionTimeoutMs,
                );
              }),
            ]);
            previewContent.value = buildIssueReportBody(collected.snapshot, collected.recentLogs);
            pendingUrl = buildIssueReportUrl(collected.snapshot, collected.recentLogs);
            openBtn.disabled = false;
          } catch (err) {
            // The reason must reach the developer's console but never the
            // outbound body — the preview textarea is pasted into a public
            // GitHub issue, so error internals stay out of it (see module
            // doc comment). The elapsed time separates a timeout-bound hang
            // (≈ collectionTimeoutMs) from a fast rejection.
            console.error(
              `[BugReport] diagnostics collection failed after ${Date.now() - startedAt}ms:`,
              err,
            );
            previewContent.value = getMessageOr(
              'diagBugReportError',
              'Failed to prepare the report. Close this dialog and try again.',
            );
            pendingUrl = null;
          } finally {
            inFlight = false;
            reportBtn.disabled = false;
          }
        })();
      });
    },
  };
}
