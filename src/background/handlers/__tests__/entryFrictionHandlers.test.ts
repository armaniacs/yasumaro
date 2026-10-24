/**
 * entryFrictionHandlers.test.ts
 * PBI 2026-10-23-07 — omnibox + keyboard command record entry points.
 * Pins: both entry points ride the shared recordTabContent core, the
 * insecure-URL gate skips with the entry-point label, the keyboard command
 * ignores unknown commands, and the confirmation notification fires on the
 * captured success result only (failures belong to the pipeline's policy).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createKeyboardCommandHandler,
  createOmniboxInputHandler,
  RECORD_CURRENT_PAGE_COMMAND,
} from '../entryFrictionHandlers.js';
import { recordTabContent } from '../activeTabRecorder.js';
import type { ManualRecordMessage } from '../../messageTypes.js';
import { logWarn } from '../../../utils/logger/api.js';

vi.mock('../../../utils/logger/api.js', () => ({
  logWarn: vi.fn().mockResolvedValue(undefined),
  logError: vi.fn().mockResolvedValue(undefined),
  logInfo: vi.fn().mockResolvedValue(undefined),
  logDebug: vi.fn().mockResolvedValue(undefined),
}));

type ManualRecordFn = (
  message: ManualRecordMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => Promise<void>;

function makeDeps(overrides: {
  handleManualRecord?: ManualRecordFn;
  queryActiveTab?: () => Promise<chrome.tabs.Tab | null>;
  notifyRecorded?: (title: string) => void;
  executeScript?: unknown;
} = {}) {
  const handleManualRecord: ManualRecordFn =
    overrides.handleManualRecord ??
    vi.fn(async (_message: ManualRecordMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
      sendResponse({ success: true });
    });
  const executeScript = overrides.executeScript ?? vi.fn().mockResolvedValue([
    { result: { url: 'https://example.com', title: 'Example', content: 'body' } },
  ]);
  return {
    deps: {
      recordTabContent: {
        handleManualRecord,
        executeScript: executeScript as unknown as typeof chrome.scripting.executeScript,
      },
      queryActiveTab: overrides.queryActiveTab ?? vi.fn().mockResolvedValue(
        { id: 1, url: 'https://example.com', title: 'Example' } as chrome.tabs.Tab,
      ),
      ...(overrides.notifyRecorded ? { notifyRecorded: overrides.notifyRecorded } : {}),
    },
    handleManualRecord,
    executeScript,
  };
}

describe('createKeyboardCommandHandler (PBI 2026-10-23-07)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records the active tab for the owned command (extracted payload via the shared core)', async () => {
    const { deps, handleManualRecord } = makeDeps();
    const handler = createKeyboardCommandHandler(deps);
    await handler(RECORD_CURRENT_PAGE_COMMAND);

    expect(handleManualRecord).toHaveBeenCalledTimes(1);
    const message = (handleManualRecord as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as ManualRecordMessage;
    expect(message.type).toBe('MANUAL_RECORD');
    expect(message.payload).toEqual({
      url: 'https://example.com',
      title: 'Example',
      content: 'body',
      force: true,
      skipAi: false,
    });
  });

  it('ignores unknown commands (second command cannot reuse the behavior)', async () => {
    const { deps, handleManualRecord } = makeDeps();
    const handler = createKeyboardCommandHandler(deps);
    await handler('some-other-command');
    expect(handleManualRecord).not.toHaveBeenCalled();
  });

  it('skips insecure URLs with the entry-point label and never records', async () => {
    const { deps, handleManualRecord } = makeDeps({
      queryActiveTab: vi.fn().mockResolvedValue({ id: 1, url: 'javascript:alert(1)' } as chrome.tabs.Tab),
    });
    const handler = createKeyboardCommandHandler(deps);
    await handler(RECORD_CURRENT_PAGE_COMMAND);

    expect(logWarn).toHaveBeenCalledWith(
      'Keyboard command ignored for insecure URL',
      expect.objectContaining({ url: 'javascript:alert(1)' }),
      undefined,
      'service-worker',
    );
    expect(handleManualRecord).not.toHaveBeenCalled();
  });

  it('notifies with the page title on the captured success result', async () => {
    const notifyRecorded = vi.fn();
    const { deps } = makeDeps({ notifyRecorded });
    const handler = createKeyboardCommandHandler(deps);
    await handler(RECORD_CURRENT_PAGE_COMMAND);
    expect(notifyRecorded).toHaveBeenCalledWith('Example');
  });

  it('does not notify when the captured result is a failure', async () => {
    const notifyRecorded = vi.fn();
    const { deps } = makeDeps({
      notifyRecorded,
      handleManualRecord: vi.fn(async (_m, _s, sendResponse) => {
        sendResponse({ success: false, error: 'privacy_consent_required' });
      }),
    });
    const handler = createKeyboardCommandHandler(deps);
    await handler(RECORD_CURRENT_PAGE_COMMAND);
    expect(notifyRecorded).not.toHaveBeenCalled();
  });
});

describe('createOmniboxInputHandler (PBI 2026-10-23-07)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records the active tab on Enter (typed text is the trigger, not a search term)', async () => {
    const { deps, handleManualRecord } = makeDeps();
    const handler = createOmniboxInputHandler(deps);
    await handler('anything the user typed');

    expect(handleManualRecord).toHaveBeenCalledTimes(1);
    const message = (handleManualRecord as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as ManualRecordMessage;
    expect(message.payload.url).toBe('https://example.com');
  });

  it('skips non-http(s) schemes with the entry-point label', async () => {
    const { deps, handleManualRecord } = makeDeps({
      queryActiveTab: vi.fn().mockResolvedValue({ id: 2, url: 'javascript:alert(1)' } as chrome.tabs.Tab),
    });
    const handler = createOmniboxInputHandler(deps);
    await handler('');

    expect(logWarn).toHaveBeenCalledWith(
      'Omnibox ignored for insecure URL',
      expect.objectContaining({ url: 'javascript:alert(1)' }),
      undefined,
      'service-worker',
    );
    expect(handleManualRecord).not.toHaveBeenCalled();
  });
});

describe('recordTabContent — shared core', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('warns on invalid page data and never records (縮退の出口)', async () => {
    const handleManualRecord = vi.fn().mockResolvedValue(undefined);
    const executeScript = vi.fn().mockResolvedValue([{ result: null }]);
    await recordTabContent(
      {
        handleManualRecord,
        executeScript: executeScript as unknown as typeof chrome.scripting.executeScript,
      },
      'Context menu',
      7,
      'https://example.com',
    );
    expect(logWarn).toHaveBeenCalledWith(
      'Context menu received invalid page data',
      expect.objectContaining({ url: 'https://example.com' }),
      undefined,
      'service-worker',
    );
    expect(handleManualRecord).not.toHaveBeenCalled();
  });

  it('builds the sender from the extracted URL and captures the response', async () => {
    const captured: unknown[] = [];
    const handleManualRecord = vi.fn(async (_m, _s, sendResponse) => {
      sendResponse({ success: true });
    });
    const executeScript = vi.fn().mockResolvedValue([
      { result: { url: 'https://example.com/x', title: 'X', content: '' } },
    ]);
    await recordTabContent(
      {
        handleManualRecord,
        executeScript: executeScript as unknown as typeof chrome.scripting.executeScript,
        captureResult: (result) => captured.push(result),
      },
      'Omnibox',
      9,
      'https://example.com',
    );
    const sender = (handleManualRecord as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as chrome.runtime.MessageSender;
    expect(sender.tab?.id).toBe(9);
    expect(sender.tab?.url).toBe('https://example.com/x');
    expect(captured).toEqual([{ success: true }]);
  });
});
