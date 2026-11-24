/**
 * webhookExportSettings.ts (dashboard)
 * Transfer-condition settings UI + transfer history + resend (PBI 2026-10-22-05,
 * boxes (a)(b)).
 *
 * Mount contract (options.html wiring is a later 1-row change owned by the
 * dashboard shell — this module only needs these element IDs to exist):
 * webhookExportEnabled / webhookExportUrl / webhookExportTag /
 * webhookExportMinScroll / webhookExportMinDuration / webhookExportSaveBtn /
 * webhookExportStatus / webhookExportHistoryList / webhookExportReloadBtn.
 *
 * Security notes (from the Topic-3 attacker 5-whys): every row renders via
 * textContent only (history rows carry page-derived URLs), and only the
 * origin is ever displayed — the full webhook URL may carry a secret token.
 * All wording resolves through getMessageOr with a literal fallback; the
 * save-time destination verdict keys are declared in both locales and the
 * verdict text carries the origin only.
 */

import {
  loadWebhookExportSettings,
  saveWebhookExportSettings,
  WebhookDestinationBlockedError,
  type WebhookExportSettings,
  type WebhookExportStore,
} from '../background/webhookExport/webhookExportSettings.js';
import type {
  WebhookDestinationReason,
  WebhookDestinationVerdict,
} from '../background/webhookExport/webhookExportDestinations.js';
import {
  WebhookExportHistory,
  type WebhookExportHistoryEntry,
  type WebhookExportHistoryStore,
} from '../background/webhookExport/webhookExportHistory.js';
import type { WebhookExportRecord } from '../background/webhookExport/webhookExportPayload.js';
import { errorMessage } from '../utils/errorUtils.js';
import { getMessageOr } from '../utils/i18n.js';
import { clearElement } from '../utils/domClear.js';
import { createListen } from '../utils/domListen.js';

export interface WebhookExportResendResult {
  ok: boolean;
  message: string;
}

/** Resolves a stored record for resend; production reads it back from SQLite. */
export type WebhookRecordResolver = (recordId: string) => Promise<WebhookExportRecord | null>;

/** Sends now; the default dynamic-imports the SW sender (dashboard → background seam). */
export type WebhookResender = (
  record: WebhookExportRecord,
  settings: WebhookExportSettings,
  force: boolean,
) => Promise<WebhookExportResendResult>;

async function defaultResend(
  record: WebhookExportRecord,
  settings: WebhookExportSettings,
  force: boolean,
): Promise<WebhookExportResendResult> {
  const [{ sendWebhookExport, defaultIsWebhookHostPermitted }, { WebhookExportHistory: HistoryClass }] =
    await Promise.all([
      import('../background/webhookExport/webhookExportSender.js'),
      import('../background/webhookExport/webhookExportHistory.js'),
    ]);
  const { sanitizeRegex } = await import('../utils/piiSanitizer.js');
  const history = new HistoryClass();
  const result = await sendWebhookExport(
    // isPrivate: false is deliberate: the resend targets a record the user
    // explicitly picked in the history UI — the explicit pick is the user's
    // consent — and the verdict source (the SW privacy cache reader) is not
    // reachable at this seam, so re-running the verdict here is impossible.
    { record, settings, isPrivate: false },
    {
      fetchFn: (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
        globalThis
          .fetch(url, { method: init.method, headers: init.headers, body: init.body, redirect: 'error' })
          .then((response: Response) => ({ ok: response.ok, status: response.status })),
      // Same allowlist verdict the SW send path uses
      // (defaultIsWebhookHostPermitted → judgeWebhookDestination) —
      // NOT permissionManager.isHostPermitted, whose granted-set answer
      // (chrome.permissions.contains) covers every origin in a real install
      // and would bypass the allowlist gate.
      isHostPermitted: defaultIsWebhookHostPermitted,
      maskText: (text: string) => sanitizeRegex(text).then((masked) => masked.text),
      notify: () => {},
      now: () => Date.now(),
      history,
    },
    { force },
  );
  return { ok: result.outcome === 'sent' || result.outcome === 'resent', message: result.reason };
}

export interface WebhookExportUiSeams {
  settingsStore?: WebhookExportStore | undefined;
  historyStore?: WebhookExportHistoryStore | undefined;
  resolveRecord?: WebhookRecordResolver | undefined;
  resend?: WebhookResender | undefined;
}

export interface WebhookExportUiController {
  init(): void;
  load(): Promise<void>;
  destroy(): void;
}

interface WebhookExportFormElements {
  enabled: HTMLInputElement | null;
  url: HTMLInputElement | null;
  tag: HTMLInputElement | null;
  minScroll: HTMLInputElement | null;
  minDuration: HTMLInputElement | null;
}

function readNumberOrUndefined(input: HTMLInputElement | null): number | undefined {
  if (input === null || input.value.trim() === '') return undefined;
  const parsed: number = Number(input.value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Save-time verdict wording. The origin rides the positional substitution
 * only: the full (possibly token-bearing) URL never composes the status line.
 */
const DESTINATION_REASON_TEXT: Record<WebhookDestinationReason, { key: string; fallback: string }> = {
  permitted: { key: 'webhookExportDestinationPermitted', fallback: 'Saved. The destination is permitted.' },
  'non-https-or-empty-destination': {
    key: 'webhookExportDestinationNonHttps',
    fallback: 'Save rejected: the destination must be https.',
  },
  'destination-not-in-allowlist': {
    key: 'webhookExportDestinationNotInAllowlist',
    fallback: 'Save rejected: the destination origin is not in the webhook destination allowlist.',
  },
};

const GRANDFATHERED_TEXT = {
  key: 'webhookExportDestinationGrandfathered',
  fallback: 'Saved. The existing destination is preserved, but the send gate rejects non-https destinations.',
};

function destinationStatusText(verdict: WebhookDestinationVerdict, grandfathered: boolean): string {
  const text = grandfathered ? GRANDFATHERED_TEXT : DESTINATION_REASON_TEXT[verdict.reason];
  return getMessageOr(text.key, text.fallback, [verdict.origin]);
}

export function createWebhookExportSettingsUi(seams: WebhookExportUiSeams = {}): WebhookExportUiController {
  const teardown: Array<() => void> = [];

  const listen = createListen(teardown);

  function setStatus(message: string, isError: boolean): void {
    const status = document.getElementById('webhookExportStatus');
    if (status === null) return;
    status.textContent = message;
    status.className = isError ? 'error' : 'success';
  }

  async function currentSettings(): Promise<WebhookExportSettings> {
    if (seams.settingsStore !== undefined) {
      return loadWebhookExportSettings(seams.settingsStore);
    }
    return loadWebhookExportSettings();
  }

  async function renderHistory(): Promise<void> {
    const list = document.getElementById('webhookExportHistoryList');
    if (list === null) return;
    clearElement(list);
    const history =
      seams.historyStore !== undefined ? new WebhookExportHistory(seams.historyStore) : new WebhookExportHistory();
    let entries: WebhookExportHistoryEntry[] = [];
    try {
      entries = await history.list();
    } catch (error) {
      setStatus(errorMessage(error), true);
      return;
    }
    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'help-text';
      empty.textContent = getMessageOr('webhookExportHistoryEmpty', 'No webhook transfers yet.');
      list.appendChild(empty);
      return;
    }
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'webhook-export-history-row';
      const label = document.createElement('span');
      label.className = 'webhook-export-history-label';
      const when: string = new Date(entry.createdAt).toISOString();
      label.textContent = `${when} ${entry.origin} ${entry.status} (${entry.charCount} chars)`;
      if (seams.resolveRecord === undefined) {
        // The record resolver is not wired in this view: a Resend button
        // would always fail with "not wired", so it never renders here.
        row.append(label);
      } else {
        const resendBtn = document.createElement('button');
        resendBtn.className = 'secondary-btn webhook-export-resend';
        resendBtn.textContent = getMessageOr('webhookExportResend', 'Resend');
        resendBtn.setAttribute('aria-label', getMessageOr('webhookExportResendAria', 'Resend', [entry.recordId]));
        resendBtn.addEventListener('click', () => {
          void handleResend(entry.recordId);
        });
        row.append(label, resendBtn);
      }
      list.appendChild(row);
    }
  }

  async function handleResend(recordId: string): Promise<void> {
    if (seams.resolveRecord === undefined) {
      setStatus(getMessageOr('webhookExportResendUnavailable', 'Resend is not wired in this view.'), true);
      return;
    }
    try {
      const record: WebhookExportRecord | null = await seams.resolveRecord(recordId);
      if (record === null) {
        setStatus(getMessageOr('webhookExportRecordMissing', 'The original record is gone.'), true);
        return;
      }
      const settings: WebhookExportSettings = await currentSettings();
      const resend: WebhookResender = seams.resend ?? defaultResend;
      const result: WebhookExportResendResult = await resend(record, settings, true);
      setStatus(result.message, !result.ok);
      await renderHistory();
    } catch (error) {
      setStatus(errorMessage(error), true);
    }
  }

  /** Looked up on every call: the panel may be re-rendered between save and load. */
  function getFormElements(): WebhookExportFormElements {
    const input = (id: string): HTMLInputElement | null => document.getElementById(id) as HTMLInputElement | null;
    return {
      enabled: input('webhookExportEnabled'),
      url: input('webhookExportUrl'),
      tag: input('webhookExportTag'),
      minScroll: input('webhookExportMinScroll'),
      minDuration: input('webhookExportMinDuration'),
    };
  }

  async function save(): Promise<void> {
    const { enabled, url, tag, minScroll, minDuration } = getFormElements();
    const settings: WebhookExportSettings = {
      enabled: enabled?.checked ?? false,
      url: url?.value.trim() ?? '',
      condition: {
        tag: tag !== null && tag.value.trim() !== '' ? tag.value.trim() : undefined,
        minScrollDepth: readNumberOrUndefined(minScroll),
        minVisitDuration: readNumberOrUndefined(minDuration),
      },
    };
    try {
      const verdict: WebhookDestinationVerdict | null =
        seams.settingsStore !== undefined
          ? await saveWebhookExportSettings(settings, seams.settingsStore)
          : await saveWebhookExportSettings(settings);
      if (verdict === null) {
        setStatus(getMessageOr('webhookExportSaved', 'Webhook export settings saved.'), false);
      } else {
        // A saved-but-non-permitted verdict is the grandfathered destination:
        // preserved, yet the send gate still rejects it, so it shows as an error.
        setStatus(destinationStatusText(verdict, !verdict.permitted), !verdict.permitted);
      }
    } catch (error) {
      if (error instanceof WebhookDestinationBlockedError) {
        setStatus(destinationStatusText(error.verdict, false), true);
      } else {
        setStatus(errorMessage(error), true);
      }
    }
  }

  async function load(): Promise<void> {
    const settings: WebhookExportSettings = await currentSettings();
    const { enabled, url, tag, minScroll, minDuration } = getFormElements();
    if (enabled !== null) enabled.checked = settings.enabled;
    if (url !== null) url.value = settings.url;
    if (tag !== null) tag.value = settings.condition.tag ?? '';
    if (minScroll !== null) minScroll.value = settings.condition.minScrollDepth?.toString() ?? '';
    if (minDuration !== null) minDuration.value = settings.condition.minVisitDuration?.toString() ?? '';
    await renderHistory();
  }

  function init(): void {
    destroy();
    listen(document.getElementById('webhookExportSaveBtn'), 'click', () => {
      void save();
    });
    listen(document.getElementById('webhookExportReloadBtn'), 'click', () => {
      void renderHistory();
    });
  }

  function destroy(): void {
    for (const remove of teardown) remove();
    teardown.length = 0;
  }

  return { init, load, destroy };
}
