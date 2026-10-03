import { getMessage } from '../utils/i18n.js';
import { ErrorCode } from '../utils/logger/types.js';
import { logError } from '../utils/logger/api.js';
import { extractDomain } from '../utils/domainUtils.js';
import { getActiveTabUrl } from './tabUtils.js';
import { escapeHtml, wireOnce } from './domUtils.js';
import { setElementHtml } from '../utils/htmlFragment.js';
import { getUserErrorMessage } from './errorUtils.js';
import { statusChannel } from '../utils/ui/statusChannel.js';
import { renderLockedHtml, renderTrustHtml, renderTrustFallbackHtml } from './statusRenderers.js';

/** Per-element toast timer — rapid double-deny used to start two competing chains (PBI 2026-09-12-41). */
let errorToastTimer: ReturnType<typeof setTimeout> | undefined = undefined;

/**
 * Failure path for the panel's async handlers. A rejected permission request
 * or a storage write used to end the click silently — the click had no other
 * visible effect, so the user could not tell it apart from a no-op. The
 * message goes through the same status seam the success paths use.
 *
 * The sentence derives from the error object (same rule as the pending-list
 * showError path) so the logged cause stays visible to the user; a fixed
 * generic would read differently from the other failure paths.
 */
export function reportHandlerError(message: string, error: unknown): void {
  statusChannel.report('mainStatus', getUserErrorMessage(error), 'error');
  logError(message, { cause: error }, ErrorCode.INTERNAL_ERROR);
}

export async function updateTrustStatus(url: string): Promise<void> {
  const trustContent = document.getElementById('statusTrustContent');
  const permArea = document.getElementById('permissionRequestArea');
  const errorMsg = document.getElementById('permissionDeniedMessage') as HTMLElement | null;
  if (!trustContent) return;

  try {
    const { isAllUrlsPermitted, isHostPermitted, requestPermission, recordDeniedVisit } = await import('../utils/permissionManager.js');
    const allUrlsGranted = await isAllUrlsPermitted();
    const permitted = allUrlsGranted || await isHostPermitted(url);
    if (!permitted) {
      // PBI 2026-09-11-04 (round 5): LOCKED is communicated via the badge +
      // permission area only. The record button is owned solely by
      // RecordSession (sole-writer contract, PBI 2026-09-07-24) — disabling
      // it here raced resetRecordButton and blocked the designed
      // "Record Anyway" (force) escape hatch.
      setElementHtml(trustContent, renderLockedHtml({ t: getMessage, esc: escapeHtml }));
      if (permArea) {
        permArea.classList.remove('hidden');
        // Wire the request button once per element — updateTrustStatus runs on
        // every status refresh and addEventListener would stack duplicate
        // handlers (double prompt + double recordDeniedVisit).
        const requestBtn = document.getElementById('btnRequestPermission') as HTMLElement & { dataset: DOMStringMap } | null;
        wireOnce(requestBtn, (el) => {
          el.addEventListener('click', async () => {
            // PBI 2026-09-12-41: extractDomain instead of `new URL(url)` —
            // a malformed URL threw before the toast ever showed. The stale
            // closure URL concern (user navigates between render and click)
            // is noted but re-querying chrome.tabs added async complexity
            // that broke the wiring contract; revisit with an event-based
            // tab-URL refresh.
            try {
              const granted = await requestPermission(url);
              if (granted) {
                permArea.classList.add('hidden');
                void updateTrustStatus(url);
              } else {
                const domain = extractDomain(url);
                if (domain) await recordDeniedVisit(domain);
                if (errorMsg) {
                  errorMsg.classList.remove('hidden');
                  requestAnimationFrame(() => {
                    errorMsg.classList.add('visible');
                  });
                  // PBI 2026-09-12-41: per-element timer token — rapid double-deny
                  // used to start two competing toast chains.
                  if (errorToastTimer !== undefined) clearTimeout(errorToastTimer);
                  errorToastTimer = setTimeout(() => {
                    errorMsg.classList.remove('visible');
                    setTimeout(() => {
                      errorMsg.classList.add('hidden');
                    }, 300);
                  }, 3000);
                }
              }
            } catch (e) {
              reportHandlerError('Failed to request host permission', e);
            }
          });
        });
      }
      return;
    }

    if (permArea) permArea.classList.add('hidden');

    const { getTrustLevelDisplay, checkDomainTrust } = await import('../utils/trustChecker.js');
    const [display, checkResult] = await Promise.all([
      getTrustLevelDisplay(url),
      checkDomainTrust(url)
    ]);

    // PBI 2026-09-12-41: string building moved to the statusRenderers seam.
    setElementHtml(trustContent, renderTrustHtml(display, checkResult, { t: getMessage, esc: escapeHtml }));
  } catch {
    setElementHtml(trustContent, renderTrustFallbackHtml({ t: getMessage, esc: escapeHtml }));
  }
}

export async function initAllUrlsPermissionBanner(): Promise<void> {
  const banner = document.getElementById('allUrlsPermissionBanner');
  if (!banner) return;

  const { isAllUrlsPermitted, requestAllUrls } = await import('../utils/permissionManager.js');
  const permitted = await isAllUrlsPermitted();

  if (permitted) {
    banner.classList.add('hidden');
    return;
  }

  banner.classList.remove('hidden');

  // Wire once per element — re-init (popup reopen / recursive initStatusPanel)
  // must not stack duplicate requestAllUrls handlers. Same discipline as
  // btnRequestPermission (PBI 2026-09-11-04).
  const btn = document.getElementById('btnRequestAllUrls') as HTMLElement & { dataset: DOMStringMap } | null;
  wireOnce(btn, (el) => {
    el.addEventListener('click', async () => {
      try {
        const granted = await requestAllUrls();
        if (granted) {
          banner.classList.add('hidden');
          const url = await getActiveTabUrl();
          if (url) {
            void updateTrustStatus(url);
          }
        }
      } catch (e) {
        reportHandlerError('Failed to request the all-URLs permission', e);
      }
    });
  });
}
