/**
 * webhookExportStep.ts (PBI 2026-10-22-05, SW fire wiring)
 *
 * Save-tail sink: fires the minimal webhook export for a newly saved record.
 *
 * Position judgment (pipeline step in the save tail, not the save handler):
 * - The data the sender needs (the persisted post-cleansing summary, the
 *   merged tags, the engagement inputs) exists only on the pipeline context.
 *   The save handler sees only the raw message payload, so firing there would
 *   force an extra SQLite read-back of the row the pipeline just wrote.
 * - The save tail is the fan-out layer for delivery destinations (Obsidian,
 *   local markdown, SQLite, metadata); the webhook is one more destination
 *   that must run after the record is persisted, so it rides SAVE_FAN_OUT
 *   instead of a handler-local call after pipeline.record().
 * - The single order seam (RecordingOrchestrator.flowOrder) derives from
 *   SAVE_FAN_OUT, so a sink keeps the published order truthful.
 *
 * Recording safety (追加動作): the sender never throws (every failure maps to
 * a result + history row + notice), this step wraps the call in try/catch, and
 * the row is BEST_EFFORT in SAVE_FAN_OUT — a webhook failure can never break
 * the recording's success/failure. The send runs only when the opt-in setting
 * is enabled (default OFF): the sender's first gate returns 'skipped' before
 * any network, so disabled installs pay one chrome.storage.local read.
 *
 * Privacy verdict wiring: the real privacy-headers verdict rides the same
 * cache reader the privacyHeaders gate step uses (deps.privacyReader →
 * RecordingCacheInstance.getPrivacyInfoWithCache). The read is cache-only —
 * the cache never fetches headers — so the sink issues no extra network
 * request, and the raw verdict rides through unmodified: an ABSENT verdict
 * fails closed in the sender (privacy-verdict-absent). Export egresses to
 * outside the device, a different weight than the in-device record gate
 * where a missing verdict only weighs against recording — the gate's
 * null-coalescing (`?? false`) deliberately does NOT carry over to egress.
 * No second verdict is derived here.
 *
 * Idempotency wiring: the record identity is the page URL (data.url) — the
 * SQLite row id is not propagated to the context, and a per-run traceId
 * must never enter the idempotency key (it is unique per recording run, so
 * a traceId key would keep the duplicate suppression dead across
 * re-records). Same URL + same payload = same key (the history module
 * contract), so a re-record of an unchanged page is suppressed and a
 * content change derives a new key.
 */

import { LogType } from '../../../utils/logger/types.js';
import { addLog } from '../../../utils/logger/core.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { getMessageOr } from '../../../utils/i18n.js';
import { loadWebhookExportSettings } from '../../webhookExport/webhookExportSettings.js';
import {
  WebhookExportHistory,
} from '../../webhookExport/webhookExportHistory.js';
import {
  defaultIsWebhookHostPermitted,
  defaultWebhookFetch,
  defaultWebhookMaskText,
  sendWebhookExport,
  type WebhookExportNotice,
} from '../../webhookExport/webhookExportSender.js';
import { successOptions } from '../../notificationPolicy.js';
import { NotificationHelper } from '../../notificationHelper.js';
import type { RecordingContext, StepDeps } from '../types.js';

/**
 * Notice wording for the one notification write point. Keys are declared in
 * both locales; the literal fallback keeps the extension-pages UI honest when
 * a locale bundle is stale (same convention as the dashboard UI module).
 */
const WEBHOOK_NOTICE_KINDS: Record<WebhookExportNotice['kind'], { key: string; fallback: string }> = {
  sent: { key: 'webhookExportNoticeSent', fallback: 'Transferred to' },
  blocked: { key: 'webhookExportNoticeBlocked', fallback: 'Blocked (undeclared destination)' },
  failed: { key: 'webhookExportNoticeFailed', fallback: 'Transfer failed' },
};

/** Production notice: origin only — the full URL may carry a secret token. */
function webhookExportNotifier(event: WebhookExportNotice): void {
  const kind = WEBHOOK_NOTICE_KINDS[event.kind];
  NotificationHelper.show(
    successOptions({
      title: getMessageOr('webhookExportNoticeTitle', 'Webhook export'),
      message: `${getMessageOr(kind.key, kind.fallback)} ${event.origin} (${event.reason})`,
      iconUrl: NotificationHelper.getIconUrl(),
    }),
  );
}

/**
 * Save-tail sink execute. Never throws: the sender's own never-throw contract
 * covers its verdicts, this catch covers the wiring around it (settings read,
 * verdict read). The context is returned untouched — the recording result is
 * owned by the outcome policy, not by this sink.
 */
export const executeWebhookExport = async (
  context: RecordingContext,
  deps?: StepDeps
): Promise<RecordingContext> => {
  const { data } = context;
  try {
    const settings = await loadWebhookExportSettings();
    // Real privacy verdict, same source the privacyHeaders gate step reads.
    // Cache-only: a miss returns null, never a header fetch.
    const privacy = deps?.privacyReader ? await deps.privacyReader(data.url) : null;
    await sendWebhookExport(
      {
        record: {
          // The SQLite row id is not propagated to the context; the page URL
          // is the stable record identity — same URL + same payload = same
          // key (the history module contract). A traceId must never enter
          // the key: it is unique per recording run, so a per-run key would
          // keep the duplicate suppression dead across re-records.
          id: data.url,
          title: data.title,
          url: data.url,
          summary: context.privacyResult?.summary,
          tags: context.privacyResult?.tags,
        },
        settings,
        engagement: {
          scrollDepth: data.scrollRatioPercent,
          visitDuration: data.visitDurationSeconds,
        },
        // Raw pass-through: an absent verdict (no cache entry — force/
        // whitelist bypass, non-text page, TTL expiry) fails closed in the
        // sender (privacy-verdict-absent): unknown never ships off-device.
        isPrivate: privacy?.isPrivate,
      },
      {
        fetchFn: defaultWebhookFetch,
        isHostPermitted: defaultIsWebhookHostPermitted,
        maskText: defaultWebhookMaskText,
        notify: webhookExportNotifier,
        now: () => Date.now(),
        history: new WebhookExportHistory(),
      },
    );
  } catch (error: unknown) {
    addLog(LogType.WARN, 'webhookExportStep: export not sent', {
      error: errorMessage(error),
      url: data.url,
      traceId: context.traceId,
    });
  }
  return context;
};
