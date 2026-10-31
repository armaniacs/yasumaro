// @vitest-environment jsdom
/**
 * skipReasonPanel.test.ts
 *
 * Popup last-skip-reason panel (PBI 2026-10-31-01). The popup reads the
 * persisted record from chrome.storage.session on open and shows the reason
 * type with its consecutive count; with no record the panel stays hidden so
 * a normal popup is not cluttered.
 *
 * chrome.i18n is stubbed minimally: the panel reads labels through
 * getMessageOr / the plural key helper, so the stub returns '' for missing
 * keys and echoes the real positional substitution behaviour.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initSkipReasonPanel } from '../skipReasonPanel.js';
import { SKIP_REASON_SESSION_KEY } from '../../utils/skipReason.js';

function setPanelDom(): void {
  document.body.innerHTML =
    '<div id="skipReasonPanel" class="skip-reason-panel hidden" role="status">' +
    '<span class="skip-reason-icon" aria-hidden="true">?</span>' +
    '<span id="skipReasonTitle" data-i18n="skipReasonPanelTitle"></span>' +
    '<span id="skipReasonText"></span>' +
    '<span id="skipReasonCount" class="skip-reason-count"></span>' +
    '</div>';
}

function stubChrome(sessionStore: Record<string, unknown>, messages: Record<string, string> = {}): {
  localSet: ReturnType<typeof vi.fn>;
  messageCalls: Array<{ key: string; subs: string[] }>;
} {
  const localSet = vi.fn();
  const messageCalls: Array<{ key: string; subs: string[] }> = [];
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      session: {
        get: (key: string) =>
          Promise.resolve(key in sessionStore ? { [key]: sessionStore[key] } : {}),
        set: (items: Record<string, unknown>) => {
          Object.assign(sessionStore, items);
          return Promise.resolve();
        },
      },
      local: { set: localSet },
    },
    i18n: {
      getMessage: (key: string, subs?: string[]) => {
        messageCalls.push({ key, subs: subs ?? [] });
        const message = messages[key];
        if (!message) return '';
        if (!subs) return message;
        return message.replace(/\$(\d+)\$/g, (_, i) => subs[Number(i) - 1] ?? '');
      },
    },
  };
  return { localSet, messageCalls };
}

beforeEach(() => {
  setPanelDom();
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (globalThis as Record<string, unknown>).chrome;
  vi.restoreAllMocks();
});

describe('initSkipReasonPanel (PBI 2026-10-31-01)', () => {
  it('shows the recent skip reason with its count when a record is stored', async () => {
    const { messageCalls } = stubChrome(
      { [SKIP_REASON_SESSION_KEY]: { reason: 'duplicate', count: 2 } },
      {
        skipReasonDuplicate: '同日重複',
        skipReasonTimes_other: '連続$1$回',
      },
    );

    await initSkipReasonPanel();

    const panel = document.getElementById('skipReasonPanel');
    expect(panel?.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('skipReasonText')?.textContent).toBe('同日重複');
    expect(document.getElementById('skipReasonCount')?.textContent).toBe('連続2回');
    expect(messageCalls.some((c) => c.key === 'skipReasonDuplicate')).toBe(true);
    expect(messageCalls.some((c) => c.key === 'skipReasonTimes_other' && c.subs?.[0] === '2')).toBe(true);
  });

  it('stays hidden with no record (a normal popup is not cluttered)', async () => {
    stubChrome({});

    await initSkipReasonPanel();

    const panel = document.getElementById('skipReasonPanel');
    expect(panel?.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('skipReasonText')?.textContent).toBe('');
  });

  it('stays hidden on a foreign shape so no half-record is rendered', async () => {
    stubChrome({ [SKIP_REASON_SESSION_KEY]: { reason: 'not-a-code', count: 1 } });

    await initSkipReasonPanel();

    expect(document.getElementById('skipReasonPanel')?.classList.contains('hidden')).toBe(true);
  });

  it('falls back to the locale-neutral literal when the message bundle has no entry (test DOMs)', async () => {
    stubChrome({ [SKIP_REASON_SESSION_KEY]: { reason: 'condition-not-met', count: 3 } });

    await initSkipReasonPanel();

    expect(document.getElementById('skipReasonText')?.textContent).toBe('Condition not met');
    expect(document.getElementById('skipReasonCount')?.textContent).toBe('×3');
  });

  it('reads chrome.storage.session only — never chrome.storage.local', async () => {
    const { localSet } = stubChrome({
      [SKIP_REASON_SESSION_KEY]: { reason: 'pipeline-error', count: 1 },
    });

    await initSkipReasonPanel();

    expect(localSet).not.toHaveBeenCalled();
    expect(document.getElementById('skipReasonPanel')?.classList.contains('hidden')).toBe(false);
  });

  it('renders nothing when the panel element is absent (test DOMs)', async () => {
    document.body.innerHTML = '';
    stubChrome({ [SKIP_REASON_SESSION_KEY]: { reason: 'duplicate', count: 1 } });

    await expect(initSkipReasonPanel()).resolves.toBeUndefined();
  });
});
