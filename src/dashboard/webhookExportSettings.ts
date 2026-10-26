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
 * No locale keys are added: all wording resolves through getMessageOr with a
 * literal fallback, so _locales/ stays untouched.
 */

import {
  loadWebhookExportSettings,
  saveWebhookExportSettings,
  type WebhookExportSettings,
  type WebhookExportStore,
} from '../background/webhookExport/webhookExportSettings.js';
import {
  WebhookExportHistory,
  type WebhookExportHistoryEntry,
  type WebhookExportHistoryStore,
} from '../background/webhookExport/webhookExportHistory.js';
import type { WebhookExportRecord } from '../background/webhookExport/webhookExportPayload.js';
import { errorMessage } from '../utils/errorUtils.js';
import { getMessageOr } from '../utils/i18n.js';
import { clearElement } from '../utils/domClear.js';

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
  const [{ sendWebhookExport }, { WebhookExportHistory: HistoryClass }] = await Promise.all([
    import('../background/webhookExport/webhookExportSender.js'),
    import('../background/webhookExport/webhookExportHistory.js'),
  ]);
  const { getPermissionManager } = await import('../utils/permissionManager.js');
  const { sanitizeRegex } = await import('../utils/piiSanitizer.js');
  const history = new HistoryClass();
  const result = await sendWebhookExport(
    { record, settings, isPrivate: false },
    {
      fetchFn: (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
        globalThis
          .fetch(url, { method: init.method, headers: init.headers, body: init.body, redirect: 'error' })
          .then((response: Response) => ({ ok: response.ok, status: response.status })),
      isHostPermitted: (url: string) => getPermissionManager().isHostPermitted(url),
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

function readNumberOrUndefined(input: HTMLInputElement | null): number | undefined {
  if (input === null || input.value.trim() === '') return undefined;
  const parsed: number = Number(input.value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function createWebhookExportSettingsUi(seams: WebhookExportUiSeams = {}): WebhookExportUiController {
  const teardown: Array<() => void> = [];

  function listen(target: EventTarget | null, type: string, handler: EventListener): void {
    if (target === null) return;
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
  }

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
      const resendBtn = document.createElement('button');
      resendBtn.className = 'secondary-btn webhook-export-resend';
      resendBtn.textContent = getMessageOr('webhookExportResend', 'Resend');
      resendBtn.setAttribute('aria-label', getMessageOr('webhookExportResendAria', 'Resend', [entry.recordId]));
      resendBtn.addEventListener('click', () => {
        void handleResend(entry.recordId);
      });
      row.append(label, resendBtn);
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

  async function save(): Promise<void> {
    const enabled = document.getElementById('webhookExportEnabled') as HTMLInputElement | null;
    const url = document.getElementById('webhookExportUrl') as HTMLInputElement | null;
    const tag = document.getElementById('webhookExportTag') as HTMLInputElement | null;
    const minScroll = document.getElementById('webhookExportMinScroll') as HTMLInputElement | null;
    const minDuration = document.getElementById('webhookExportMinDuration') as HTMLInputElement | null;
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
      if (seams.settingsStore !== undefined) {
        await saveWebhookExportSettings(settings, seams.settingsStore);
      } else {
        await saveWebhookExportSettings(settings);
      }
      setStatus(getMessageOr('webhookExportSaved', 'Webhook export settings saved.'), false);
    } catch (error) {
      setStatus(errorMessage(error), true);
    }
  }

  async function load(): Promise<void> {
    const settings: WebhookExportSettings = await currentSettings();
    const enabled = document.getElementById('webhookExportEnabled') as HTMLInputElement | null;
    const url = document.getElementById('webhookExportUrl') as HTMLInputElement | null;
    const tag = document.getElementById('webhookExportTag') as HTMLInputElement | null;
    const minScroll = document.getElementById('webhookExportMinScroll') as HTMLInputElement | null;
    const minDuration = document.getElementById('webhookExportMinDuration') as HTMLInputElement | null;
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
