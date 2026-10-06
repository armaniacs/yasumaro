// @vitest-environment jsdom
/**
 * The dialog buttons are wired at module load, so the DOM has to exist before
 * the import — and the record seam is mocked here because its contract is to
 * normalize every send failure into a result. A rejection from it is not a
 * production path today, which is exactly why the boundary around it needs a
 * test of its own: nothing else in the suite would notice if it were dropped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupPopupDom } from './helpers/popupDom.js';

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

vi.mock('../../utils/logger/types.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    ErrorCode: { INTERNAL_ERROR: 'INT_001' },
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
    ErrorCode: { INTERNAL_ERROR: 'INT_001' },
  }),
);

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
  setupPopupDom({ includePending: false });
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
    mod.wireDialogButtons();
    mod.showPrivatePageDialog('https://example.com/private', 'auth_required', 'Basic Auth');
    mod.setCurrentPendingSave(pendingSave() as never);

    document.getElementById('dialog-save-once')!.click();

    await vi.waitFor(() => expect(mockLogError).toHaveBeenCalled());
    expectReported('worker is asleep');
    expect((document.getElementById('private-page-dialog') as HTMLDialogElement).open).toBe(false);
  });

  it('reports the save-domain failure on #mainStatus', async () => {
    const mod = await import('../privatePageDialog.js');
    mod.wireDialogButtons();
    mod.setCurrentPendingSave(pendingSave() as never);

    document.getElementById('dialog-save-domain')!.click();

    await vi.waitFor(() => expect(mockLogError).toHaveBeenCalled());
    expectReported('worker is asleep');
  });

  it('reports the save-path failure on #mainStatus', async () => {
    const mod = await import('../privatePageDialog.js');
    mod.wireDialogButtons();
    mod.setCurrentPendingSave(pendingSave() as never);

    document.getElementById('dialog-save-path')!.click();

    await vi.waitFor(() => expect(mockLogError).toHaveBeenCalled());
    expectReported('worker is asleep');
  });

  it('reports the retry failure on #mainStatus', async () => {
    const mod = await import('../privatePageDialog.js');
    mod.wireDialogButtons();
    mod.setCurrentPendingSave(pendingSave() as never);
    mod.showRecordingFailedDialog('https://example.com/test-page', 'Network error');

    document.getElementById('recording-failed-retry')!.click();

    await vi.waitFor(() => expect(mockLogError).toHaveBeenCalled());
    expectReported('worker is asleep');
    expect((document.getElementById('recording-failed-dialog') as HTMLDialogElement).open).toBe(false);
  });
});
