/**
 * entryFrictionHandlers.ts
 *
 * Omnibox + keyboard-command entry points for record-without-opening (PBI
 * 2026-10-23-07). Both ride the shared recordTabContent core with the
 * context menu; the insecure-URL gate and the per-tab in-flight guard stay
 * entry-point-local so the log origin and the skip policy stay readable.
 *
 * Permission-free by design: `omnibox` and `commands` are manifest keys, not
 * permissions. The side panel (chrome.sidePanel needs the sidePanel
 * permission) stays staged out of this slice.
 */
import { isSecureUrl } from '../../utils/urlUtils.js';
import { getMessageOr } from '../../utils/i18n.js';
import { logWarn } from '../../utils/logger/api.js';
import { SingleFlight } from '../../utils/singleFlight.js';
import { NotificationHelper } from '../notificationHelper.js';
import { recordTabContent, type RecordTabContentDeps } from './activeTabRecorder.js';

/** The keyboard command this module owns (manifest `commands` key). */
export const RECORD_CURRENT_PAGE_COMMAND = 'record-current-page';

export interface EntryFrictionDeps {
  recordTabContent: RecordTabContentDeps;
  /** Injectable active-tab query (chrome.tabs is unavailable in unit tests). */
  queryActiveTab?: () => Promise<chrome.tabs.Tab | null>;
  /** Injectable success notifier (NotificationHelper by default). */
  notifyRecorded?: (pageTitle: string) => void;
}

/**
 * Record the active tab through the shared core. Shared by the omnibox and
 * the keyboard command: insecure URL skips with the entry-point label, the
 * RecordingResult captured through sendResponse drives the confirmation
 * notification (件名 = the page title). The in-flight guard is created once
 * per handler (same policy as the context menu's per-tab guard), so repeat
 * triggers while a record is running are dropped for the same tab.
 */
function createActiveTabRunner(deps: EntryFrictionDeps, entryLabel: string): () => Promise<void> {
  const inFlightByTabId = new SingleFlight<number>();
  const queryActiveTab =
    deps.queryActiveTab ?? (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab ?? null;
    });
  return async () => {
    const tab = await queryActiveTab();
    if (!tab?.id || !tab.url) return;
    // Capture the narrowed values in consts: the SingleFlight closure below
    // would otherwise lose the undefined narrowing on tab.id / tab.url.
    const tabId = tab.id;
    const tabUrl = tab.url;

    if (!isSecureUrl(tabUrl)) {
      await logWarn(`${entryLabel} ignored for insecure URL`, { url: tabUrl }, undefined, 'service-worker');
      return;
    }

    await inFlightByTabId.run(tabId, async () => {
      try {
        await recordTabContent(
          {
            ...deps.recordTabContent,
            captureResult: (result) => {
              // A successful record confirms with the page title; failures are
              // already notified by the pipeline's outcome policy.
              if (
                result &&
                typeof result === 'object' &&
                'success' in result &&
                (result as { success?: unknown }).success === true
              ) {
                notifyRecorded(deps, tab);
              }
            },
          },
          entryLabel,
          tabId,
          tabUrl,
        );
      } catch {
        // The pipeline's outcome policy owns the failure notification; the
        // omnibox/command path stays silent instead of double-notifying.
      }
    }, 'drop');
  };
}

function notifyRecorded(deps: EntryFrictionDeps, tab: chrome.tabs.Tab): void {
  const title = tab.title || tab.url || '';
  if (deps.notifyRecorded) {
    deps.notifyRecorded(title);
    return;
  }
  NotificationHelper.notifySuccess(
    getMessageOr('recordSuccessTitle', 'Recorded'),
    getMessageOr('recordSuccessBody', `Recorded "${title}"`, [title]),
  );
}

/**
 * Keyboard command handler (manifest `commands.record-current-page`).
 * Unknown commands are ignored so adding a second command later cannot
 * accidentally reuse this handler's behavior.
 */
export function createKeyboardCommandHandler(deps: EntryFrictionDeps): (command: string) => Promise<void> {
  const runner = createActiveTabRunner(deps, 'Keyboard command');
  return (command: string) => {
    if (command !== RECORD_CURRENT_PAGE_COMMAND) return Promise.resolve();
    return runner();
  };
}

/**
 * Omnibox input-entered handler (manifest `omnibox.keyword`). Enter always
 * records the active tab — the typed text is how the user reaches keyword
 * mode, not a search term. The dashboard search hand-off needs the ?q=
 * deep link and stays in the M1/M3 input-selection wave.
 */
export function createOmniboxInputHandler(deps: EntryFrictionDeps): (text: string) => Promise<void> {
  const runner = createActiveTabRunner(deps, 'Omnibox');
  return (_text: string) => runner();
}
