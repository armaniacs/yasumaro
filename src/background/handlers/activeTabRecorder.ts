/**
 * activeTabRecorder.ts
 *
 * Shared record-the-active-tab core (PBI 2026-10-23-07): the context menu,
 * the omnibox and the keyboard command all extract the page data from the
 * target tab through one site and route it through handleManualRecord.
 *
 * Entry-point policy stays with the entry points: the insecure-URL gate and
 * the per-tab in-flight guard (SingleFlight) are each entry point's own, and
 * log messages carry the entry label so the origin stays readable. The core
 * owns the mechanics that must not drift between entry points: the page-body
 * slice cap, the payload shape and the sender construction.
 *
 * 縮退の出口: invalid page data degrades to a structured-log warn and no
 * record, never a throw into the entry point's error path.
 */
import { logWarn } from '../../utils/logger/api.js';
import type { ManualRecordMessage } from '../messageTypes.js';

/** Page-body slice cap for every record-active-tab path (was the context menu's inline 5000). */
export const ACTIVE_TAB_CONTENT_MAX_CHARS = 5000;

export interface RecordTabContentDeps {
  handleManualRecord: (
    message: ManualRecordMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => Promise<void>;
  /** Injectable chrome.scripting.executeScript (unit tests). */
  executeScript?: typeof chrome.scripting.executeScript;
  /**
   * Capture the RecordingResult handed back through sendResponse. The
   * context menu ignores it; the omnibox/keyboard notify on it.
   */
  captureResult?: (result: unknown) => void;
}

/**
 * Extract the page data from a tab and run the manual record. Errors
 * propagate to the entry point's own error handling (each entry point logs
 * its own failure with its own label); invalid page data only warns here.
 */
export async function recordTabContent(
  deps: RecordTabContentDeps,
  entryLabel: string,
  tabId: number,
  fallbackUrl: string,
): Promise<void> {
  const runScript =
    deps.executeScript ?? ((options: Parameters<typeof chrome.scripting.executeScript>[0]) => chrome.scripting.executeScript(options));
  const [result] = await runScript({
    target: { tabId },
    func: (maxChars: number) => ({
      url: window.location.href,
      title: document.title,
      content: document.body?.innerText?.slice(0, maxChars) || '',
    }),
    args: [ACTIVE_TAB_CONTENT_MAX_CHARS],
  });

  const raw = result?.result;
  if (!raw || typeof raw !== 'object' || !('url' in raw)) {
    await logWarn(`${entryLabel} received invalid page data`, { url: fallbackUrl }, undefined, 'service-worker');
    return;
  }

  const payload = raw as { url: string; title: string; content: string };
  const sender: chrome.runtime.MessageSender = {
    tab: { id: tabId, url: payload.url } as chrome.tabs.Tab,
    id: chrome.runtime.id,
    url: chrome.runtime.getURL(''),
  };

  await deps.handleManualRecord(
    {
      type: 'MANUAL_RECORD',
      payload: {
        url: payload.url,
        title: payload.title,
        content: payload.content,
        force: true,
        skipAi: false,
      },
    },
    sender,
    (response?: unknown) => {
      if (deps.captureResult) deps.captureResult(response);
    },
  );
}
