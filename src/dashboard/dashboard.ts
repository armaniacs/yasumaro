/**
 * dashboard.ts
 * ダッシュボードページのグローバル初期化
 *
 * The settings-panel behaviour that used to live here moved to
 * generalSettings/ and localMarkdownExport.ts (PBI 2026-08-09-24); what
 * remains is page-level initialization: language direction, deep links
 * (?tab= / ?section=), and the export buttons that sit outside any panel.
 *
 * This module is imported by src/dashboard/main.ts, which owns the single
 * bootstrap. It must not import panel implementations from panels/ — the
 * panel registry is not built until main.ts constructs it. The one exception
 * is panels/panelCatalog.ts: pure metadata with zero imports, so resolving
 * deep links from it cannot pull any panel (or the registry) in.
 */

import { toMarkdownTemplateEntryData } from './markdownExport.js';
// Re-exported for existing importers (notably the dashboard tests), which
// referenced this helper from dashboard.ts before it moved to markdownExport.ts.
export { toMarkdownTemplateEntryData };
import {
  handleExportLocalMarkdown,
  handleHistoryExportLocalMarkdown,
} from './localMarkdownExport.js';
import { initTrancoConsentPanel } from './trancoConsent.js';
import {
  DEFAULT_PANEL_ID,
  resolvePanelIdForSection,
  resolvePanelIdForTab,
} from './panels/panelCatalog.js';
// Not a panel implementation (no PanelLifecycle, no panel registry
// dependency) — a standalone module the diagnostics panel also wires its
// own "Report a Bug" button through. Safe to import at page-init time.
import {
  createIssueReportModalController,
  type IssueReportModalController,
} from './panels/diagnostic/issueReportLink.js';
import { diagnosticsCollector } from './panels/diagnostic/DiagnosticsCollector.js';

/**
 * Single shared controller for the "Report a Bug" preview modal, created
 * lazily by initDashboard() (DOM must be ready first). The diagnostics panel
 * attaches its own #diagReportBugBtn to the same modal state as the sidebar
 * button via attachIssueReportTrigger(), which queues the request when the
 * controller does not exist yet — a panel's mount() can run before the async
 * page init creates the controller (e.g. diagnostics as the ?tab= deep-link
 * initial panel), and mount never re-runs, so a silent skip would leave the
 * button permanently unwired.
 */
let issueReportModalController: IssueReportModalController | null = null;

// Entry-point buttons captured before initDashboard() created the controller.
// attachTrigger is idempotent per button (WeakSet guard), so the flush after
// creation can never double-wire an entry point.
const pendingIssueReportTriggers: Array<HTMLButtonElement | null> = [];

/**
 * Wire a "Report a Bug" entry-point button to the shared preview-modal
 * controller. Safe to call before initDashboard() — the button is queued and
 * wired as soon as the controller exists.
 */
export function attachIssueReportTrigger(reportBtn: HTMLButtonElement | null): void {
  if (issueReportModalController) {
    issueReportModalController.attachTrigger(reportBtn);
    return;
  }
  pendingIssueReportTriggers.push(reportBtn);
}

/**
 * Which panel the page should open on, from ?tab= / ?section=.
 *
 * Returned rather than navigated to: main.ts hands this to
 * DashboardBootstrapper.start(), so the deep link and the default go through
 * the same single navigation instead of one overwriting the other.
 */
export function resolveInitialPanelId(search: string = window.location.search): string {
  const urlParams = new URLSearchParams(search);

  // ?tab= wins over ?section= (legacy precedence, pinned by deepLink.test.ts).
  // Both resolutions derive from panelCatalog.ts — no hand-written map here.
  return resolvePanelIdForTab(urlParams.get('tab'))
    ?? resolvePanelIdForSection(urlParams.get('section'))
    ?? DEFAULT_PANEL_ID;
}

/**
 * Scroll to / expand the part of the general panel named by ?section=.
 *
 * Separate from resolveInitialPanelId because it must run after the panel has
 * mounted — the elements it reaches for do not exist before then.
 */
export function applySectionDeepLink(search: string = window.location.search): void {
  const section = new URLSearchParams(search).get('section');

  // Which sections are known comes from the catalog; only sections that
  // resolve to the general panel carry an in-panel anchor. Unknown sections
  // (and ?section=general, which has no anchor) stay a no-op as before.
  if (resolvePanelIdForSection(section) !== DEFAULT_PANEL_ID) return;

  if (section === 'obsidian') {
    const details = document.getElementById('obsidianSettingsDetails') as HTMLDetailsElement | null;
    if (details) {
      details.open = true;
      details.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } else if (section === 'ai-provider') {
    document.getElementById('aiProviderSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

export function setHtmlLangDir(): void {
  const locale = chrome.i18n.getUILanguage();
  const langCode = locale.split('-')[0] ?? locale;
  document.documentElement.lang = locale;
  const rtlLanguages = ['ar', 'he', 'fa', 'ur', 'ku', 'yi', 'dv'];
  document.documentElement.dir = rtlLanguages.includes(langCode) ? 'rtl' : 'ltr';
}

/** Page-level wiring that does not depend on any panel being mounted. */
export async function initDashboard(): Promise<void> {
  console.log('[Dashboard] Starting initialization...');

  try { setHtmlLangDir(); } catch (e) { console.error('[Dashboard] setHtmlLangDir error:', e); }

  document.getElementById('historyExportAllMarkdownBtn')?.addEventListener('click', handleHistoryExportLocalMarkdown);
  document.getElementById('exportLocalMarkdownBtn')?.addEventListener('click', handleExportLocalMarkdown);
  try { await initTrancoConsentPanel(); } catch (e) { console.error('[Dashboard] initTrancoConsentPanel error:', e); }

  // Sidebar "Report a Bug" — reuses the diagnostics panel's preview modal
  // (#bugReportPreviewModal lives outside any panel) so the button works
  // from any panel without requiring the user to navigate to Diagnostics
  // first. The diagnostics panel attaches its own #diagReportBugBtn to the
  // same controller instance (via attachIssueReportTrigger()), so both
  // entry points share one modal state and one DiagnosticsCollector.
  try {
    const controller = createIssueReportModalController(
      {
        previewModal: document.getElementById('bugReportPreviewModal') as HTMLDialogElement | null,
        previewContent: document.getElementById('bugReportPreviewContent') as HTMLTextAreaElement | null,
        cancelBtn: document.getElementById('bugReportCancelBtn') as HTMLButtonElement | null,
        closeBtn: document.getElementById('bugReportPreviewCloseBtn') as HTMLButtonElement | null,
        openBtn: document.getElementById('bugReportOpenBtn') as HTMLButtonElement | null,
      },
      () => diagnosticsCollector.collect(),
    );
    issueReportModalController = controller;
    controller.attachTrigger(
      document.getElementById('sidebarReportBugBtn') as HTMLButtonElement | null,
    );
    // Panels that mounted before this point queued their buttons — wire them
    // now (idempotent, and mount never re-runs so there is no later chance).
    for (const btn of pendingIssueReportTriggers.splice(0)) {
      controller.attachTrigger(btn);
    }
  } catch (e) { console.error('[Dashboard] issueReportModalController (sidebar) error:', e); }

  console.log('[Dashboard] Initialization complete');
}
