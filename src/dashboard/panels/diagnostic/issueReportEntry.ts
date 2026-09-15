/**
 * issueReportEntry.ts (PBI 2026-09-15-06)
 *
 * 「Report a Bug」プレビューモーダルへの全 entry point の配線を集約する module。
 *
 * 不変条件:
 * - controller は initIssueReportEntry() で1度だけ生成される（DOM 準備後）。
 * - registerReportBugButton() は controller が無くても安全 — ボタンはキューに
 *   入り、controller 生成直後に配線される。mount は再実行されないため、
 *   静かなスキップはボタンを恒久的に未配線のままにする（過去の退行）。
 * - attachTrigger は WeakSet ガードでボタン単位に冪等 — flush での二重配線は
 *   構造的に起きない。
 *
 * かつてこの知識は dashboard.ts（controller 生成・flush）と diagnosticsPanel
 * （キュー呼び出し）に分散していた。panel → dashboard の依存もこの集約で解消。
 */

import {
  createIssueReportModalController,
  type IssueReportModalController,
} from './issueReportLink.js';
import { diagnosticsCollector } from './DiagnosticsCollector.js';

let controller: IssueReportModalController | null = null;

// Entry-point buttons captured before initIssueReportEntry() ran.
const pending: Array<HTMLButtonElement | null> = [];

/** Wire a "Report a Bug" entry-point button. Safe to call before page init. */
export function registerReportBugButton(reportBtn: HTMLButtonElement | null): void {
  if (controller) {
    controller.attachTrigger(reportBtn);
    return;
  }
  pending.push(reportBtn);
}

/**
 * Create the shared controller and wire the sidebar button + any queued
 * panel buttons. Called once from initDashboard() after the DOM is ready.
 */
export function initIssueReportEntry(): void {
  try {
    const created = createIssueReportModalController(
      {
        previewModal: document.getElementById('bugReportPreviewModal') as HTMLDialogElement | null,
        previewContent: document.getElementById('bugReportPreviewContent') as HTMLTextAreaElement | null,
        cancelBtn: document.getElementById('bugReportCancelBtn') as HTMLButtonElement | null,
        closeBtn: document.getElementById('bugReportPreviewCloseBtn') as HTMLButtonElement | null,
        openBtn: document.getElementById('bugReportOpenBtn') as HTMLButtonElement | null,
      },
      () => diagnosticsCollector.collect(),
    );
    controller = created;
    created.attachTrigger(
      document.getElementById('sidebarReportBugBtn') as HTMLButtonElement | null,
    );
    // Panels that mounted before this point queued their buttons — wire them
    // now (idempotent, and mount never re-runs so there is no later chance).
    for (const btn of pending.splice(0)) {
      created.attachTrigger(btn);
    }
  } catch (e) { console.error('[Dashboard] issueReportModalController (sidebar) error:', e); }
}
