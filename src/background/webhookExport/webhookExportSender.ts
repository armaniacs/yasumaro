/**
 * webhookExportSender.ts
 *
 * Send path for the minimal webhook export (PBI 2026-10-22-05, box (c)):
 * SW fetch + user notification, with PII masking and private exclusion
 * applied BEFORE any network happens.
 *
 * Masking point (なぜなぜ Topic 1: 利用者/保守者/攻撃者 × 5 whys): the
 * persisted summary already rides post-cleansing text, but the sender does
 * not trust storage state — it re-applies `sanitizeRegex` (the same regex
 * pass the privacy pipeline owns) to the summary immediately before
 * building the payload. The input type carries no raw-content field at all,
 * so raw page text cannot reach this module by construction (pinned by unit
 * test). Masking is therefore enforced at the last gate before egress,
 * regardless of how the stored summary was produced.
 *
 * Declaration pattern (PBI 01): the destination must be https
 * (isWebhookUrlAllowed) AND granted in the manifest's host_permissions
 * (permissionManager.isHostPermitted → chrome.permissions.contains). An
 * undeclared origin is blocked without touching the network and the reason
 * surfaces in history + notification. The browser's extension_pages document
 * CSP is the second layer (pinned by testDir/e2e/webhook-egress.spec.ts).
 * The AI-provider-scoped CSPValidator gate is deliberately NOT consulted —
 * it allowlists provider domains only and would fail every webhook closed
 * without a verdict this feature can explain.
 *
 * The fetch itself runs `redirect: 'error'`: a 30x must never forward the
 * JSON body to a Location no gate checked (same policy as the Gist target).
 */

import {
  buildWebhookExportPayload,
  isWebhookUrlAllowed,
  matchesWebhookExportCondition,
  webhookUrlOrigin,
  type WebhookExportRecord,
} from './webhookExportPayload.js';
import { getPermissionManager } from '../../utils/permissionManager.js';
import { sanitizeRegex } from '../../utils/piiSanitizer.js';
import {
  deriveWebhookIdempotencyKey,
  WebhookExportHistory,
  type WebhookExportHistoryEntry,
  type WebhookExportHistoryStatus,
} from './webhookExportHistory.js';
import type { WebhookExportSettings } from './webhookExportSettings.js';

export type WebhookExportOutcome = 'sent' | 'blocked' | 'failed' | 'skipped' | 'resent';

export interface WebhookExportSendResult {
  outcome: WebhookExportOutcome;
  reason: string;
  key: string | null;
}

export interface WebhookExportEngagement {
  scrollDepth?: number | undefined;
  visitDuration?: number | undefined;
}

/** Everything the sender needs; every seam is injectable for tests. */
export interface WebhookExportSendInput {
  record: WebhookExportRecord;
  settings: WebhookExportSettings;
  engagement?: WebhookExportEngagement | undefined;
  /** Privacy-headers verdict for the source page: excluded before send. */
  isPrivate: boolean;
}

export interface WebhookFetchResponse {
  ok: boolean;
  status: number;
}

export interface WebhookExportNotice {
  kind: 'sent' | 'blocked' | 'failed';
  /** Origin only — the full URL (possibly token-bearing) never hits UI. */
  origin: string;
  reason: string;
}

export interface WebhookExportSenderDeps {
  fetchFn: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<WebhookFetchResponse>;
  isHostPermitted: (url: string) => Promise<boolean>;
  maskText: (text: string) => Promise<string> | string;
  notify: (event: WebhookExportNotice) => void;
  now: () => number;
  history: WebhookExportHistory;
}

/** Machine-readable reasons; user text is resolved at the notice renderer. */
export const WEBHOOK_EXPORT_REASONS = {
  disabled: 'disabled',
  nonHttpsDestination: 'non-https-or-empty-destination',
  conditionMismatch: 'condition-mismatch',
  privateExcluded: 'private-excluded',
  duplicateSuppressed: 'duplicate-suppressed',
  undeclaredOrigin: 'undeclared-origin',
  transportError: 'transport-error',
  maskError: 'mask-error',
  delivered: 'delivered',
  redelivered: 'redelivered',
} as const;

function httpReason(status: number): string {
  return `http-${status}`;
}

/** Production fetch: no redirect following, 30s abort. Tests inject fetchFn. */
export function defaultWebhookFetch(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
): Promise<WebhookFetchResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  return globalThis
    .fetch(url, { method: init.method, headers: init.headers, body: init.body, redirect: 'error', signal: controller.signal })
    .then((response: Response) => ({ ok: response.ok, status: response.status }))
    .finally(() => clearTimeout(timer));
}

/** Production permission check: manifest host_permissions via chrome.permissions. */
export function defaultIsWebhookHostPermitted(url: string): Promise<boolean> {
  return getPermissionManager().isHostPermitted(url);
}

/** Production mask: the privacy pipeline's regex pass, applied at send time. */
export function defaultWebhookMaskText(text: string): Promise<string> {
  return sanitizeRegex(text).then((result) => result.text);
}

async function recordHistory(
  deps: WebhookExportSenderDeps,
  entry: {
    key: string;
    recordId: string;
    origin: string;
    status: WebhookExportHistoryStatus;
    reason: string;
    charCount: number;
  },
): Promise<void> {
  // Best-effort audit: a quota-exceeded store must never turn a delivered
  // verdict into a caller-visible throw (review finding).
  try {
    await deps.history.append({
      key: entry.key,
      recordId: entry.recordId,
      origin: entry.origin,
      status: entry.status,
      reason: entry.reason,
      charCount: entry.charCount,
      createdAt: deps.now(),
      resentCount: 0,
    });
  } catch {
    // History lost; the result below still carries the verdict.
  }
}

/** Best-effort read: an unreadable history suppresses nothing (fail-open to send). */
async function listHistory(deps: WebhookExportSenderDeps): Promise<WebhookExportHistoryEntry[]> {
  try {
    return await deps.history.list();
  } catch {
    return [];
  }
}

/** Best-effort resend bump: never throws past the caller. */
async function markResentQuietly(deps: WebhookExportSenderDeps, key: string): Promise<void> {
  try {
    await deps.history.markResent(key, deps.now());
  } catch {
    // History lost; the result below still carries the verdict.
  }
}

/** A throwing notifier must never break the send verdict. */
function safeNotify(deps: WebhookExportSenderDeps, event: WebhookExportNotice): void {
  try {
    deps.notify(event);
  } catch {
    // Notification lost; the result still carries the verdict.
  }
}

/**
 * Sends one record. Never throws: every failure maps to a result + history
 * row + notice. `force` is the explicit-resend path (dashboard resend
 * button): it re-POSTs with the SAME idempotency key so the receiver
 * dedupes, and the destination always comes from saved settings — the
 * caller cannot override it.
 */
export async function sendWebhookExport(
  input: WebhookExportSendInput,
  deps: WebhookExportSenderDeps,
  opts?: { force?: boolean | undefined },
): Promise<WebhookExportSendResult> {
  const settings: WebhookExportSettings = input.settings;
  if (!settings.enabled) {
    return { outcome: 'skipped', reason: WEBHOOK_EXPORT_REASONS.disabled, key: null };
  }
  if (!isWebhookUrlAllowed(settings.url)) {
    const attributable: string = webhookUrlOrigin(settings.url) ?? '';
    if (attributable !== '') {
      await recordHistory(deps, {
        key: `blocked-${input.record.id}-${deps.now()}`,
        recordId: input.record.id,
        origin: attributable,
        status: 'blocked',
        reason: WEBHOOK_EXPORT_REASONS.nonHttpsDestination,
        charCount: 0,
      });
      safeNotify(deps, { kind: 'blocked', origin: attributable, reason: WEBHOOK_EXPORT_REASONS.nonHttpsDestination });
    }
    return { outcome: 'blocked', reason: WEBHOOK_EXPORT_REASONS.nonHttpsDestination, key: null };
  }
  if (!matchesWebhookExportCondition(input.record, settings.condition, input.engagement)) {
    return { outcome: 'skipped', reason: WEBHOOK_EXPORT_REASONS.conditionMismatch, key: null };
  }
  if (input.isPrivate) {
    return { outcome: 'skipped', reason: WEBHOOK_EXPORT_REASONS.privateExcluded, key: null };
  }

  const origin: string = webhookUrlOrigin(settings.url) ?? '';
  let maskedSummary: string | undefined;
  try {
    maskedSummary =
      typeof input.record.summary === 'string' && input.record.summary !== ''
        ? await deps.maskText(input.record.summary)
        : undefined;
  } catch {
    // Fail closed: an unmaskable summary is never shipped raw.
    await recordHistory(deps, {
      key: `blocked-${input.record.id}-${deps.now()}`,
      recordId: input.record.id,
      origin,
      status: 'failed',
      reason: WEBHOOK_EXPORT_REASONS.maskError,
      charCount: 0,
    });
    safeNotify(deps, { kind: 'failed', origin, reason: WEBHOOK_EXPORT_REASONS.maskError });
    return { outcome: 'failed', reason: WEBHOOK_EXPORT_REASONS.maskError, key: null };
  }
  const payload = buildWebhookExportPayload({ ...input.record, summary: maskedSummary });
  if (payload === null) {
    return { outcome: 'skipped', reason: WEBHOOK_EXPORT_REASONS.nonHttpsDestination, key: null };
  }
  const canonical: string = JSON.stringify(payload);
  const key: string = deriveWebhookIdempotencyKey(input.record.id, canonical);

  if (opts?.force !== true) {
    const existing = deps.history.findByKey(await listHistory(deps), key);
    if (existing !== null && (existing.status === 'sent' || existing.status === 'resent')) {
      return { outcome: 'skipped', reason: WEBHOOK_EXPORT_REASONS.duplicateSuppressed, key };
    }
  }

  let permitted = false;
  try {
    permitted = await deps.isHostPermitted(settings.url);
  } catch {
    permitted = false;
  }
  if (!permitted) {
    await recordHistory(deps, {
      key,
      recordId: input.record.id,
      origin,
      status: 'blocked',
      reason: WEBHOOK_EXPORT_REASONS.undeclaredOrigin,
      charCount: payload.text.length,
    });
    safeNotify(deps, { kind: 'blocked', origin, reason: WEBHOOK_EXPORT_REASONS.undeclaredOrigin });
    return { outcome: 'blocked', reason: WEBHOOK_EXPORT_REASONS.undeclaredOrigin, key };
  }

  try {
    const response: WebhookFetchResponse = await deps.fetchFn(settings.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: canonical,
    });
    if (!response.ok) {
      const reason: string = httpReason(response.status);
      await recordHistory(deps, {
        key,
        recordId: input.record.id,
        origin,
        status: 'failed',
        reason,
        charCount: payload.text.length,
      });
      safeNotify(deps, { kind: 'failed', origin, reason });
      return { outcome: 'failed', reason, key };
    }
  } catch {
    await recordHistory(deps, {
      key,
      recordId: input.record.id,
      origin,
      status: 'failed',
      reason: WEBHOOK_EXPORT_REASONS.transportError,
      charCount: payload.text.length,
    });
    safeNotify(deps, { kind: 'failed', origin, reason: WEBHOOK_EXPORT_REASONS.transportError });
    return { outcome: 'failed', reason: WEBHOOK_EXPORT_REASONS.transportError, key };
  }

  if (opts?.force === true) {
    const prior = deps.history.findByKey(await listHistory(deps), key);
    if (prior !== null) {
      await markResentQuietly(deps, key);
    } else {
      await recordHistory(deps, {
        key,
        recordId: input.record.id,
        origin,
        status: 'sent',
        reason: WEBHOOK_EXPORT_REASONS.delivered,
        charCount: payload.text.length,
      });
    }
    safeNotify(deps, { kind: 'sent', origin, reason: WEBHOOK_EXPORT_REASONS.redelivered });
    return { outcome: 'resent', reason: WEBHOOK_EXPORT_REASONS.redelivered, key };
  }
  await recordHistory(deps, {
    key,
    recordId: input.record.id,
    origin,
    status: 'sent',
    reason: WEBHOOK_EXPORT_REASONS.delivered,
    charCount: payload.text.length,
  });
  safeNotify(deps, { kind: 'sent', origin, reason: WEBHOOK_EXPORT_REASONS.delivered });
  return { outcome: 'sent', reason: WEBHOOK_EXPORT_REASONS.delivered, key };
}
