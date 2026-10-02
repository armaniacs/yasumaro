// @vitest-environment jsdom
/**
 * The pending-list buttons are the popup's only entry point for a batch of
 * withheld pages, and every step they await (settings write, pending-record
 * send, removal) can reject. A rejection that escaped the click handler left
 * the list frozen with no message, so these tests pin the boundary itself:
 * the failure reaches #mainStatus, the cause reaches the log, and one bad
 * entry cannot take the rest of the batch with it.
 *
 * errorUtils is deliberately NOT mocked here — the point of these tests is the
 * text the user actually ends up reading.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitForMock } from '../../../testDir/waitPolicy.js';

const {
  mockGetPendingPages,
  mockRemovePendingPages,
  mockRecordPendingPage,
  mockAddDomainToWhitelist,
  mockAddPathToWhitelist,
  mockShowConfirmDialog,
  mockLogError,
} = vi.hoisted(() => ({
  mockGetPendingPages: vi.fn().mockResolvedValue([]),
  mockRemovePendingPages: vi.fn().mockResolvedValue(undefined),
  mockRecordPendingPage: vi.fn().mockResolvedValue({ success: true }),
  mockAddDomainToWhitelist: vi.fn().mockResolvedValue({ ok: true, entry: 'example.com', added: true }),
  mockAddPathToWhitelist: vi.fn().mockResolvedValue({ ok: true, entry: 'example.com', added: true }),
  mockShowConfirmDialog: vi.fn().mockResolvedValue(true),
  mockLogError: vi.fn(),
}));

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

vi.mock('../../utils/logger/types.js', () => ({
  ErrorCode: {
    CONTENT_EXTRACTION_FAILURE: 'CONTENT_EXTRACTION_FAILURE',
    STORAGE_WRITE_FAILURE: 'STORAGE_WRITE_FAILURE',
    INVALID_INPUT: 'INVALID_INPUT',
  },
}));
vi.mock('../../utils/logger/core.js', () => ({
  logError: mockLogError,
  ErrorCode: { STORAGE_WRITE_FAILURE: 'STORAGE_WRITE_FAILURE' },
}));
vi.mock('../../utils/logger/api.js', () => ({
  logError: mockLogError,
  ErrorCode: { STORAGE_WRITE_FAILURE: 'STORAGE_WRITE_FAILURE' },
}));

vi.mock('../../utils/i18n.js', () => {
  const messages: Record<string, string> = {
    pendingPagesEmpty: 'No items selected.',
    errorPrefix: '✗ Error:',
    unknownError: 'Unknown error occurred',
    connectionError: 'Connection error',
    domainBlockedError: 'Domain blocked',
    success: 'Success',
    cancelled: 'Cancelled',
    forceRecord: 'Record Anyway',
    recording: 'Recording',
  };
  const getMessage = vi.fn((key: string, _subs?: string[]) => messages[key] ?? key);
  return {
    getMessage,
    getMessageOr: (key: string, fallback: string, subs?: unknown): string =>
      (subs === undefined ? getMessage(key) : getMessage(key, subs as string[])) || fallback,
  };
});

Object.defineProperty(global, 'chrome', {
  value: {
    i18n: {
      getMessage: (key: string) => (key === 'errorPrefix' ? '✗ Error:' : key),
      getUILanguage: () => 'en',
    },
    runtime: { sendMessage: vi.fn().mockResolvedValue({ success: true }) },
    tabs: { create: vi.fn().mockResolvedValue({}) },
  },
  writable: true,
});

import { saveSelectedPages, setupEventListeners } from '../pendingPages.js';

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
  ].join('\n');
  setupEventListeners();
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
  setupDom();
});

describe('saveSelectedPages — rejected dependency', () => {
  it('resolves instead of rejecting and reports the storage failure to the user', async () => {
    check('https://example.com/page');
    mockGetPendingPages.mockRejectedValue(new Error('storage is locked'));

    await expect(saveSelectedPages()).resolves.toBeUndefined();

    const status = document.getElementById('mainStatus')!;
    expect(status.textContent).toContain('storage is locked');
    expect(status.className).toBe('error');
    expect(mockLogError).toHaveBeenCalledWith(
      'Failed to save the selected pending pages',
      expect.objectContaining({ cause: expect.any(Error) }),
      'STORAGE_WRITE_FAILURE'
    );
  });

  it('reports a rejected record send through the same status element', async () => {
    check('https://example.com/page');
    mockGetPendingPages.mockResolvedValue([
      { url: 'https://example.com/page', title: 'Example', reason: 'test', headerValue: '' },
    ]);
    mockRecordPendingPage.mockRejectedValue(new Error('worker is asleep'));

    await saveSelectedPages();

    const status = document.getElementById('mainStatus')!;
    expect(status.textContent).toContain('worker is asleep');
    expect(status.className).toBe('error');
  });

  it('shows the failure when the button is clicked, not only on a direct call', async () => {
    check('https://example.com/page');
    mockRemovePendingPages.mockRejectedValue(new Error('quota exceeded'));

    document.getElementById('btn-save-selected')!.click();

    await waitForMock(() => {
      expect(document.getElementById('mainStatus')!.textContent).toContain('quota exceeded');
    });
    expect(document.getElementById('mainStatus')!.className).toBe('error');
  });
});

describe('saveSelectedPages — one malformed URL must not abort the batch', () => {
  it('whitelists the remaining URLs and still runs the save pass', async () => {
    check('not a url', 'https://example.com/page');
    mockGetPendingPages.mockResolvedValue([
      { url: 'https://example.com/page', title: 'Example', reason: 'test', headerValue: '' },
    ]);

    await saveSelectedPages('domain');

    // The unparsable entry is dropped, not propagated: the loop continues and
    // the save pass below it still runs.
    expect(mockAddDomainToWhitelist).toHaveBeenCalledTimes(1);
    expect(mockAddDomainToWhitelist).toHaveBeenCalledWith('example.com');
    expect(mockRecordPendingPage).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/page' })
    );
    expect(mockRemovePendingPages).toHaveBeenCalledWith(['not a url', 'https://example.com/page']);
  });

  it('surfaces the malformed entry so the user knows why it was skipped', async () => {
    check('not a url', 'https://example.com/page');

    await saveSelectedPages('domain');

    const status = document.getElementById('mainStatus')!;
    expect(status.textContent).toContain('Invalid URL');
    expect(status.className).toBe('error');
    expect(mockLogError).toHaveBeenCalledWith(
      'Failed to read the hostname of a pending page URL',
      expect.objectContaining({ cause: expect.any(Error) }),
      'INVALID_INPUT'
    );
  });

  it('keeps the path batch going when a whitelist write itself rejects', async () => {
    check('https://a.example/page', 'https://b.example/page');
    mockGetPendingPages.mockResolvedValue([
      { url: 'https://a.example/page', title: 'A', reason: 'r', headerValue: '' },
      { url: 'https://b.example/page', title: 'B', reason: 'r', headerValue: '' },
    ]);
    mockAddPathToWhitelist.mockRejectedValueOnce(new Error('storage is locked'));

    await expect(saveSelectedPages('path')).resolves.toBeUndefined();

    const status = document.getElementById('mainStatus')!;
    expect(status.textContent).toContain('storage is locked');
    expect(mockLogError).toHaveBeenCalledWith(
      'Failed to save the selected pending pages',
      expect.objectContaining({ cause: expect.any(Error) }),
      'STORAGE_WRITE_FAILURE'
    );
  });
});

describe('btn-discard — rejected dependency', () => {
  it('reports the failure after a confirmed discard instead of leaking it', async () => {
    check('https://example.com/page');
    mockShowConfirmDialog.mockResolvedValue(true);
    mockRemovePendingPages.mockRejectedValue(new Error('storage is locked'));

    document.getElementById('btn-discard')!.click();

    await waitForMock(() => {
      expect(document.getElementById('mainStatus')!.textContent).toContain('storage is locked');
    });
    expect(mockLogError).toHaveBeenCalledWith(
      'Failed to discard the selected pending pages',
      expect.objectContaining({ cause: expect.any(Error) }),
      'STORAGE_WRITE_FAILURE'
    );
  });

  it('reports a rejected confirmation dialog', async () => {
    check('https://example.com/page');
    mockShowConfirmDialog.mockRejectedValue(new Error('no such element'));

    document.getElementById('btn-discard')!.click();

    await waitForMock(() => {
      expect(document.getElementById('mainStatus')!.textContent).toContain('no such element');
    });
    expect(mockRemovePendingPages).not.toHaveBeenCalled();
  });

  it('leaves the empty-selection hint on the success path', async () => {
    check('https://example.com/page');
    document.querySelector<HTMLInputElement>('.pending-checkbox')!.checked = false;

    document.getElementById('btn-discard')!.click();

    await waitForMock(() => {
      expect(document.getElementById('mainStatus')!.textContent).toBe('No items selected.');
    });
    expect(document.getElementById('mainStatus')!.className).toBe('success');
    expect(mockShowConfirmDialog).not.toHaveBeenCalled();
  });
});
