/**
 * Shared DOM scaffold for popup unit tests.
 *
 * Consolidates the `#mainStatus` / 2-dialog / pending-section skeleton and the
 * `HTMLDialogElement` polyfill that each popup test used to duplicate in its
 * own `setupDom()`. Tests keep their mocks, `beforeEach` wiring, and all
 * assertions; only the fixture generation moves here.
 *
 * Production code must not import this module.
 */

export interface PopupDomOptions {
  includePending?: boolean;
  includeDialogs?: boolean;
  includeMainStatus?: boolean;
  includeStatusPanel?: boolean;
  includePermissionBanner?: boolean;
}

const PENDING_SKELETON: string[] = [
  '<div id="pending-section"></div>',
  '<div id="pending-empty"></div>',
  '<div id="pending-pages-list"></div>',
  '<button id="btn-select-all"></button>',
  '<button id="btn-save-selected"></button>',
  '<button id="btn-save-whitelist"></button>',
  '<button id="btn-discard"></button>',
];

const DIALOG_SKELETON: string[] = [
  '<dialog id="private-page-dialog">',
  '  <div id="dialog-message"></div>',
  '  <button id="dialog-cancel">Cancel</button>',
  '  <button id="dialog-save-once">Save Once</button>',
  '  <button id="dialog-save-domain">Save for Domain</button>',
  '  <button id="dialog-save-path">Save for Path</button>',
  '</dialog>',
  '<dialog id="recording-failed-dialog">',
  '  <div id="recording-failed-message"></div>',
  '  <button id="recording-failed-dismiss">Dismiss</button>',
  '  <button id="recording-failed-retry">Retry</button>',
  '</dialog>',
];

const STATUS_PANEL_SKELETON: string[] = [
  '<div id="statusPanel">',
  '  <div id="statusDomainIcon"></div>',
  '  <span id="statusDomainLabel" class="status-label"></span>',
  '  <div id="statusPrivacyIcon"></div>',
  '  <span id="statusPrivacyLabel" class="status-label"></span>',
  '  <div id="statusDomainState"></div>',
  '  <div id="statusDomainMode"></div>',
  '  <div id="statusPrivacyContent"></div>',
  '  <div id="statusCacheContent"></div>',
  '  <div id="statusLastSavedContent"></div>',
  '  <div id="statusCleansingContent"></div>',
  '  <div id="statusTrustContent"></div>',
  '  <div id="statusModeBadge"></div>',
  '  <button id="statusToggleBtn" aria-expanded="false"></button>',
  '  <div id="statusDetails"></div>',
  '  <span id="statusToggleText"></span>',
  '  <div id="permissionRequestArea" class="hidden"></div>',
  '  <div id="permissionDeniedMessage" class="hidden"></div>',
  '  <button id="statusAddDomain"></button>',
  '  <button id="statusAddPath"></button>',
  '</div>',
];

const PERMISSION_BANNER_SKELETON: string[] = [
  '<div id="allUrlsPermissionBanner" class="hidden"></div>',
  '<button id="btnRequestAllUrls"></button>',
];

const DIALOG_IDS: string[] = ['private-page-dialog', 'recording-failed-dialog'];

/**
 * jsdom has no `HTMLDialogElement.showModal` / `close`, so every dialog test
 * polyfills them. `close()` dispatches a real `close` event like the native
 * dialog, so the focus-trap release wired to it is exercised too.
 */
export function polyfillDialogs(ids: string[] = DIALOG_IDS): void {
  for (const id of ids) {
    const dialog = document.getElementById(id) as (HTMLDialogElement & {
      showModal: () => void;
      close: () => void;
    }) | null;
    if (dialog) {
      dialog.showModal = function () {
        this.open = true;
      };
      dialog.close = function () {
        this.open = false;
        this.dispatchEvent(new Event('close'));
      };
    }
  }
}

export function setupPopupDom(opts: PopupDomOptions = {}): void {
  const {
    includePending = true,
    includeDialogs = true,
    includeMainStatus = true,
    includeStatusPanel = false,
    includePermissionBanner = false,
  } = opts;
  const parts: string[] = [];
  if (includePending) parts.push(...PENDING_SKELETON);
  if (includeMainStatus) parts.push('<div id="mainStatus"></div>');
  if (includeDialogs) parts.push(...DIALOG_SKELETON);
  if (includeStatusPanel) parts.push(...STATUS_PANEL_SKELETON);
  if (includePermissionBanner) parts.push(...PERMISSION_BANNER_SKELETON);
  document.body.innerHTML = parts.join('\n');
  if (includeDialogs) polyfillDialogs();
}
