// @vitest-environment jsdom
/**
 * The popup failure-display contract: every failure path derives the
 * user-visible sentence from the failure payload (errorUtils) instead of a
 * fixed generic, so the same failure reads the same on every path — the
 * pending list, the private-page dialog (result and exception branches), and
 * the status panel.
 *
 * errorUtils is deliberately NOT mocked here — the point is the text the user
 * actually ends up reading.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForMock } from '../../../testDir/waitPolicy.js';

const MSG = 'the pending-record worker is asleep';

const {
  mockGetPendingPages,
  mockRemovePendingPages,
  mockRecordPendingPage,
  mockAddDomainToWhitelist,
  mockAddPathToWhitelist,
  mockShowConfirmDialog,
  mockLogError,
  mockGetAll,
  mockSetAll,
  mockIsAllUrlsPermitted,
  mockRequestAllUrls,
  mockStartAutoCloseTimer,
} = vi.hoisted(() => ({
  mockGetPendingPages: vi.fn().mockResolvedValue([]),
  mockRemovePendingPages: vi.fn().mockResolvedValue(undefined),
  mockRecordPendingPage: vi.fn().mockResolvedValue({ success: true }),
  mockAddDomainToWhitelist: vi.fn().mockResolvedValue({ ok: true, entry: 'example.com', added: true }),
  mockAddPathToWhitelist: vi.fn().mockResolvedValue({ ok: true, entry: 'example.com', added: true }),
  mockShowConfirmDialog: vi.fn().mockResolvedValue(true),
  mockLogError: vi.fn(),
  mockGetAll: vi.fn().mockResolvedValue({ domain_whitelist: [] }),
  mockSetAll: vi.fn().mockResolvedValue(undefined),
  mockIsAllUrlsPermitted: vi.fn().mockResolvedValue(false),
  mockRequestAllUrls: vi.fn().mockResolvedValue(true),
  mockStartAutoCloseTimer: vi.fn(),
}));

vi.mock('../../utils/logger/types.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    ErrorCode: { INTERNAL_ERROR: 'INT_001', STORAGE_WRITE_FAILURE: 'STORAGE_WRITE_FAILURE', INVALID_INPUT: 'INVALID_INPUT', OBSIDIAN_SEND_FAILURE: 'OBS_SEND_001', CONTENT_EXTRACTION_FAILURE: 'CONTENT_EXTRACTION_FAILURE' },
  }),
);
vi.mock('../../utils/logger/core.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: { INTERNAL_ERROR: 'INT_001' },
  }),
);
vi.mock('../../utils/logger/api.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: { INTERNAL_ERROR: 'INT_001', STORAGE_WRITE_FAILURE: 'STORAGE_WRITE_FAILURE' },
  }),
);

vi.mock('../../utils/pendingStorage.js', () => ({
  getPendingPages: mockGetPendingPages,
  removePendingPages: mockRemovePendingPages,
  savePendingPages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../messaging/pendingRecordGateway.js', () => ({
  recordPendingPage: mockRecordPendingPage,
}));

vi.mock('../whitelistWriter.js', () => ({
  addDomainToWhitelist: mockAddDomainToWhitelist,
  addPathToWhitelist: mockAddPathToWhitelist,
}));

vi.mock('../../utils/ui/confirmDialog.js', () => ({
  showConfirmDialog: mockShowConfirmDialog,
  showAlertDialog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    settingsRepository: { getAll: mockGetAll, setAll: mockSetAll, getMany: mockGetAll, clearCache: vi.fn() },
  };
});

vi.mock('../../utils/permissionManager.js', () => ({
  isAllUrlsPermitted: mockIsAllUrlsPermitted,
  requestAllUrls: mockRequestAllUrls,
  isHostPermitted: vi.fn().mockResolvedValue(false),
  recordDeniedVisit: vi.fn().mockResolvedValue(undefined),
  requestPermission: vi.fn().mockResolvedValue(false),
}));

vi.mock('../autoClose.js', () => ({ startAutoCloseTimer: mockStartAutoCloseTimer }));

function setupDom(): void {
  document.body.innerHTML = [
    '<div id="pending-section"></div>',
    '<div id="pending-empty"></div>',
    '<div id="pending-pages-list"></div>',
    '<div id="mainStatus"></div>',
    '<button id="btn-select-all"></button>',
    '<button id="btn-save-selected"></button>',
    '<button id="btn-save-whitelist"></button>',
    '<button id="btn-discard"></button>',
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
    '<div id="allUrlsPermissionBanner" class="hidden"></div>',
    '<button id="btnRequestAllUrls"></button>',
  ].join('\n');
  for (const id of ['private-page-dialog', 'recording-failed-dialog']) {
    const dialog = document.getElementById(id) as HTMLDialogElement & {
      showModal: () => void;
      close: () => void;
    };
    dialog.showModal = function () { this.open = true; };
    dialog.close = function () {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  }
}

function pendingSave(): Record<string, unknown> {
  return {
    title: 'Test Page',
    url: 'https://example.com/test-page',
    content: 'Test content',
    privacyData: null,
  };
}

function check(...urls: string[]): void {
  document.getElementById('pending-pages-list')!.innerHTML = urls
    .map((url) => `<input type="checkbox" class="pending-checkbox" value="${url}" checked>`)
    .join('\n');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPendingPages.mockResolvedValue([]);
  mockRemovePendingPages.mockResolvedValue(undefined);
  mockRecordPendingPage.mockResolvedValue({ success: true });
  mockAddDomainToWhitelist.mockResolvedValue({ ok: true, entry: 'example.com', added: true });
  mockAddPathToWhitelist.mockResolvedValue({ ok: true, entry: 'example.com', added: true });
  mockShowConfirmDialog.mockResolvedValue(true);
  mockIsAllUrlsPermitted.mockResolvedValue(false);
  mockRequestAllUrls.mockResolvedValue(true);
  mockSetAll.mockResolvedValue(undefined);
  mockGetAll.mockResolvedValue({ domain_whitelist: [] });
  setupDom();
});

afterEach(async () => {
  const { focusTrapManager } = await import('../../utils/ui/focusTrap.js');
  focusTrapManager.releaseAll();
  vi.resetModules();
});

describe('single display contract — derived, not fixed generic', () => {
  it('shows the same derived sentence on all three exception-boundary paths', async () => {
    const expected = `${chrome.i18n.getMessage('errorPrefix')} ${MSG}`;

    // Pending-list path: showError derives from the rejected record send.
    const { saveSelectedPages } = await import('../pendingPages.js');
    check('https://example.com/page');
    mockGetPendingPages.mockResolvedValue([
      { url: 'https://example.com/page', title: 'Example', reason: 'test', headerValue: '' },
    ]);
    mockRecordPendingPage.mockRejectedValue(new Error(MSG));
    await saveSelectedPages();
    const pendingText = document.getElementById('mainStatus')!.textContent;
    expect(pendingText).toBe(expected);
    expect(pendingText).not.toBe('An error occurred.');

    // Private-page dialog path: reportDialogActionFailure derives.
    setupDom();
    const dialogMod = await import('../privatePageDialog.js');
    dialogMod.showPrivatePageDialog('https://example.com/private', 'auth_required', 'Basic Auth');
    dialogMod.setCurrentPendingSave(pendingSave() as never);
    document.getElementById('dialog-save-once')!.click();
    await waitForMock(() => {
      expect(document.getElementById('mainStatus')!.textContent).toBe(expected);
    });

    // Status-panel path: reportHandlerError derives.
    setupDom();
    const panelMod = await import('../statusPanel.js');
    await panelMod.initAllUrlsPermissionBanner();
    mockRequestAllUrls.mockRejectedValue(new Error(MSG));
    document.getElementById('btnRequestAllUrls')!.click();
    await waitForMock(() => {
      expect(document.getElementById('mainStatus')!.textContent).toBe(expected);
    });
  });

  it('keeps one display contract inside privatePageDialog (result branch / exception boundary)', async () => {
    const saveErrorPrefix = chrome.i18n.getMessage('saveError');
    const expectedException = `${chrome.i18n.getMessage('errorPrefix')} ${MSG}`;
    setupDom();
    const dialogMod = await import('../privatePageDialog.js');
    const statusDiv = document.getElementById('mainStatus')!;

    // Result-driven failure: the gateway envelope carries the sentence.
    mockRecordPendingPage.mockResolvedValue({ success: false, error: MSG });
    dialogMod.showPrivatePageDialog('https://example.com/private', 'auth_required', 'Basic Auth');
    dialogMod.setCurrentPendingSave(pendingSave() as never);
    document.getElementById('dialog-save-once')!.click();
    await waitForMock(() => {
      expect(statusDiv.textContent).toContain(saveErrorPrefix);
    });
    expect(statusDiv.textContent).toBe(`${saveErrorPrefix}: ${MSG}`);
    expect(statusDiv.textContent).not.toBe('An error occurred.');
    expect(mockStartAutoCloseTimer).not.toHaveBeenCalled();

    // Exception boundary: the thrown error carries the sentence.
    mockRecordPendingPage.mockRejectedValue(new Error(MSG));
    dialogMod.setCurrentPendingSave(pendingSave() as never);
    document.getElementById('dialog-save-once')!.click();
    await waitForMock(() => {
      expect(statusDiv.textContent).toBe(expectedException);
    });
    expect(statusDiv.textContent).not.toBe('An error occurred.');
  });
});
