// @vitest-environment jsdom
/**
 * The dialog buttons are wired at module load, so the DOM has to exist before
 * the import — and the record seam is mocked here because its contract is to
 * normalize every send failure into a result. A rejection from it is not a
 * production path today, which is exactly why the boundary around it needs a
 * test of its own: nothing else in the suite would notice if it were dropped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRecordPendingPage, mockLogError } = vi.hoisted(() => ({
  mockRecordPendingPage: vi.fn(),
  mockLogError: vi.fn(),
}));

vi.mock('../../messaging/pendingRecordGateway.js', () => ({
  recordPendingPage: mockRecordPendingPage,
  PENDING_RECORD_TIMEOUT_MS: 20000,
  PENDING_RECORD_TIMEOUT_ERROR: 'PENDING_RECORD_TIMEOUT',
}));

vi.mock('../whitelistWriter.js', () => ({
  addDomainToWhitelist: vi.fn().mockResolvedValue({ ok: true, entry: 'example.com', added: true }),
  addPathToWhitelist: vi.fn().mockResolvedValue({ ok: true, entry: 'example.com', added: true }),
}));

vi.mock('../autoClose.js', () => ({ startAutoCloseTimer: vi.fn() }));

vi.mock('../../utils/logger/types.js', () => ({
  ErrorCode: { INTERNAL_ERROR: 'INT_001' },
}));
vi.mock('../../utils/logger/core.js', () => ({
  logError: mockLogError,
  ErrorCode: { INTERNAL_ERROR: 'INT_001' },
}));
vi.mock('../../utils/logger/api.js', () => ({
  logError: mockLogError,
  ErrorCode: { INTERNAL_ERROR: 'INT_001' },
}));

vi.mock('../../utils/i18n.js', async () => {
  const { mockGetMessage: i18nMock } = await import('../../../testDir/i18nMock.js');
  const messages: Record<string, string> = {
    saveSuccess: 'Saved to Obsidian',
    saveError: 'Save error',
    errorGeneric: 'An error occurred.',
  };
  const getMessage = vi.fn((key: string, _subs?: string[]) => messages[key] || key);
  return i18nMock(getMessage);
});

function setupDom(): void {
  document.body.innerHTML = [
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
    '<div id="mainStatus"></div>',
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

// Must run before the module is imported: its listeners bind at load time.
setupDom();

function expectReported(detail: string): void {
  const statusDiv = document.getElementById('mainStatus');
  expect(statusDiv!.textContent).toContain(detail);
  expect(statusDiv!.className).toBe('status-message error');
  expect(mockLogError).toHaveBeenCalledWith(
    expect.stringContaining('[privatePageDialog]'),
    expect.objectContaining({ cause: expect.any(Error) }),
    'INT_001'
  );
}

function pendingSave(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Test Page',
    url: 'https://example.com/test-page',
    content: 'Test content',
    privacyData: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The global afterEach empties document.body, so the DOM has to be rebuilt
  // before each test — and before the module import inside it, since the
  // listeners bind to whatever exists at load time.
  setupDom();
  mockRecordPendingPage.mockRejectedValue(new Error('worker is asleep'));
});

afterEach(async () => {
  const { focusTrapManager } = await import('../../utils/ui/focusTrap.js');
  focusTrapManager.releaseAll();
  vi.resetModules();
});

describe('privatePageDialog buttons — a rejected record seam', () => {
  it('reports the save-once failure on #mainStatus after the dialog closed', async () => {
    const mod = await import('../privatePageDialog.js');
    mod.showPrivatePageDialog('https://example.com/private', 'auth_required', 'Basic Auth');
    mod.setCurrentPendingSave(pendingSave() as never);

    document.getElementById('dialog-save-once')!.click();

    await vi.waitFor(() => expect(mockLogError).toHaveBeenCalled());
    expectReported('worker is asleep');
    expect((document.getElementById('private-page-dialog') as HTMLDialogElement).open).toBe(false);
  });

  it('reports the save-domain failure on #mainStatus', async () => {
    const mod = await import('../privatePageDialog.js');
    mod.setCurrentPendingSave(pendingSave() as never);

    document.getElementById('dialog-save-domain')!.click();

    await vi.waitFor(() => expect(mockLogError).toHaveBeenCalled());
    expectReported('worker is asleep');
  });

  it('reports the save-path failure on #mainStatus', async () => {
    const mod = await import('../privatePageDialog.js');
    mod.setCurrentPendingSave(pendingSave() as never);

    document.getElementById('dialog-save-path')!.click();

    await vi.waitFor(() => expect(mockLogError).toHaveBeenCalled());
    expectReported('worker is asleep');
  });

  it('reports the retry failure on #mainStatus', async () => {
    const mod = await import('../privatePageDialog.js');
    mod.setCurrentPendingSave(pendingSave() as never);
    mod.showRecordingFailedDialog('https://example.com/test-page', 'Network error');

    document.getElementById('recording-failed-retry')!.click();

    await vi.waitFor(() => expect(mockLogError).toHaveBeenCalled());
    expectReported('worker is asleep');
    expect((document.getElementById('recording-failed-dialog') as HTMLDialogElement).open).toBe(false);
  });
});
