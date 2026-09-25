import type { RecordingData, RecordingResult, ContentResponse } from '../../messaging/types.js';
import type { TabData } from '../tabCache.js';
import type { Settings } from '../../utils/storage/types.js';
import { isSecureUrl, sanitizeUrlForLogging } from '../../utils/urlUtils.js';
import { setBadge } from '../badgePolicy.js';
import { ErrorCode } from '../../utils/logger/types.js';
import { logDebug, logWarn } from '../../utils/logger/api.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { getMessage } from '../../utils/i18n.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { encodeUrlSafeBase64 } from './urlNotificationHandlers.js';
import { resolveReasonLabel } from '../../utils/reasonLabel.js';
import { resolveNavTrailFields } from '../navTrail/navTrailTracker.js';
import { NotificationHelper } from '../notificationHelper.js';
import type { MessageSenderLike } from '../rateLimiter.js';
import type { RecordOptions } from '../pipeline/RecordingOrchestrator.js';
import { pickDefined } from '../../utils/objectUtils.js';
import { buildRecordRequest, pickRecordDiagnostics } from '../recordRequestBuilder.js';
import { visitRateLimiter } from '../visitRateLimiter.js';
import { validateUrl } from '../../utils/ssrfGuard.js';
import type { RegenerateCleanseMode } from '../../utils/aiSummaryCleaner/cleanseModeLadder.js';

import type {
  ValidVisitMessage,
  ManualRecordMessage,
  PreviewRecordMessage,
  SaveRecordMessage,
  RegenerateSummaryMessage,
} from '../messageTypes.js';

/** The recording surface the handlers need: one method, explicit settings. */
export interface RecordingRunner {
  record(data: RecordingData, opts?: RecordOptions): Promise<RecordingResult>;
}

// ============================================================================
// Deps interfaces
// ============================================================================

export interface ValidVisitHandlerDeps {
  isRecordingAllowed: () => Promise<boolean>;
  cacheTab: (tab: chrome.tabs.Tab) => void;
  updateCachedTab: (tabId: number, data: Partial<TabData>) => void;
  recordVisit: (data: RecordingData) => Promise<RecordingResult>;
  addBadgeTab: (tabId: number) => void;
  hasBadgeTab: (tabId: number) => boolean;
}

/**
 * Behaviour shared by the recording handlers (MANUAL_RECORD/PREVIEW_RECORD and
 * SAVE_RECORD). Kept to what the handlers actually invoke (deep-dig 子PBI 4):
 * adding a collaborator to one handler must not force it onto the other.
 */
export interface RecordingHandlerBaseDeps {
  isRecordingAllowed: () => Promise<boolean>;
  /**
   * Injected by the composition root. The handler never constructs the
   * orchestrator itself; a missing runner is a wiring error, not a fallback.
   */
  recordingPipeline: RecordingRunner;
  getSettings: () => Promise<Settings>;
  setUrlContent: (url: string, content: string) => Promise<void>;
}

export interface ManualRecordHandlerDeps extends RecordingHandlerBaseDeps {
  checkRateLimit: (sender: MessageSenderLike | undefined, settings: Record<string, unknown>) => Promise<{ allowed: boolean; error?: string }>;
  fetchContent: (url: string) => Promise<string>;
}

export interface SaveRecordHandlerDeps extends RecordingHandlerBaseDeps {}

/**
 * PBI 04: REGENERATE_SUMMARY deps — deliberately standalone (not the manual
 * base): the handler needs a rate-limit bucket and the re-extraction seam,
 * and never uses setUrlContent (no pending-queue insert on its path).
 */
export interface RegenerateSummaryHandlerDeps {
  isRecordingAllowed: () => Promise<boolean>;
  recordingPipeline: RecordingRunner;
  getSettings: () => Promise<Settings>;
  checkRateLimit: (
    sender: MessageSenderLike | undefined,
    settings: Record<string, unknown>,
    opts?: { bucket?: string },
  ) => Promise<{ allowed: boolean; error?: string }>;
  fetchExtracted: (url: string, cleanseMode: RegenerateCleanseMode) => Promise<ContentResponse>;
}

/**
 * Gate rejections the handler may re-offer as an explicit force retry
 * (Ask Q1C: force stays off by default; only these are force-bypassable —
 * PERMISSION_REQUIRED/INVALID_URL are not, because force does not bypass
 * decidePermission/validateUrl).
 */
const FORCE_OFFERABLE_ERRORS: ReadonlySet<string> = new Set([
  'DOMAIN_BLOCKED',
  'DOMAIN_NOT_TRUSTED',
  'PRIVATE_PAGE_DETECTED',
]);

// ============================================================================
// Factory functions
// ============================================================================

// ----------------------------------------------------------------------------
// VALID_VISIT per-URL rate limiting
//
// Delegates to the VisitRateLimiter instance (see ../visitRateLimiter.ts).
// The instance keeps the flood guard injectable and testable in isolation
// instead of a raw module-level Map here.
// ----------------------------------------------------------------------------

/** Exported for unit tests; used internally by the VALID_VISIT handler. */
export function isRateLimitedVisit(url: string): boolean {
    return visitRateLimiter.isRateLimited(url);
}

/** Clear all tracked rate-limit entries (used by tests). */
export function resetVisitRateLimiter(): void {
    visitRateLimiter.reset();
}

export function createValidVisitHandler(deps: ValidVisitHandlerDeps) {
  return async (
    message: ValidVisitMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    if (!sender.tab) {
      sendResponse({ success: false, error: 'Invalid sender' });
      return;
    }

    if (sender.tab.url && isRateLimitedVisit(sender.tab.url)) {
      sendResponse({ success: false, reason: 'rate_limited' });
      return;
    }

    if (!(await deps.isRecordingAllowed())) {
      sendResponse({ success: false, reason: 'privacy_consent_required' });
      return;
    }

    deps.cacheTab(sender.tab);

    // PBI 03: the opt-in navigation trail. Resolved here, at the only surface
    // that knows which tab the record came from, and passed through the normal
    // request builder. With the feature off this resolves to {} and nothing is
    // stored, so no other surface has to remember the gate.
    const navFields = sender.tab?.id !== undefined && sender.tab.url
      ? await resolveNavTrailFields(sender.tab.id, sender.tab.url)
      : {};

    const result = await deps.recordVisit(buildRecordRequest('valid-visit', {
      title: sender.tab.title || '',
      url: sender.tab.url || '',
      content: message.payload?.content || '',
      ...pickRecordDiagnostics(message.payload),
      ...navFields,
    }));

    if (sender.tab.id) {
      deps.updateCachedTab(sender.tab.id, {
        title: sender.tab.title || '',
        url: sender.tab.url || '',
        content: message.payload?.content || '',
        isValidVisit: true,
      });
    }

    if (result.success && !result.skipped && sender.tab.id) {
      const savedTabId = sender.tab.id;
      deps.addBadgeTab(savedTabId);
      // PBI 2026-09-12-07: badge display lives in the shared BadgePolicy seam.
      await setBadge({ kind: 'recorded' }, savedTabId);
    }

    if (result.confirmationRequired) {
      const url = sender.tab.url || '';
      const title = sender.tab.title || url;
      const reason = result.reason || 'cache-control';
      // PBI 2026-09-12-34: canonical-first resolution via the shared
      // ReasonLabel table (the legacy-only key missed for cache-control /
      // set-cookie — the locales ship canonical keys only for those).
      const reasonLabel = resolveReasonLabel(reason, getMessage);
      try {
        const notificationId = await encodeUrlSafeBase64(url);
        NotificationHelper.notifyPrivacyConfirm(notificationId, title, reasonLabel);
      } catch (error) {
        await logWarn(
          'Failed to encode URL for notification',
          { error: errorMessage(error) },
          ErrorCode.CRYPTO_HMAC_FAILURE,
          'service-worker',
        );
      }
    }

    sendResponse(result);
  };
}

/** SPA host whose client render defeats server-side content fetch — skip the fetch when forced (was an inline literal). */
const GOOGLE_SITES_HOST = 'sites.google.com';

export function createManualRecordHandler(deps: ManualRecordHandlerDeps) {
  return async (
    message: ManualRecordMessage | PreviewRecordMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    // VULN-004: MANUAL_RECORD/PREVIEW_RECORD are extension-page operations.
    // Enforced by the registry's 'extension-only' trust level.
    if (!(await deps.isRecordingAllowed())) {
      sendResponse({ success: false, reason: 'privacy_consent_required' });
      return;
    }

    let content = message.payload.content;
    const skipAi = message.type === 'MANUAL_RECORD' ? message.payload.skipAi : false;
    const settings = await deps.getSettings();

    if (!isSecureUrl(message.payload.url)) {
      await logWarn(
        'Blocked MANUAL_RECORD with insecure URL',
        { url: message.payload.url, type: message.type },
        undefined,
        'service-worker',
      );
      sendResponse({ success: false, error: 'Insecure URL protocol not allowed' });
      return;
    }

    const senderLike: MessageSenderLike = {
      ...pickDefined({
        url: sender.url,
        tab: sender.tab ? pickDefined({ id: sender.tab.id }) : undefined,
      }),
    };
    const rateLimitResult = await deps.checkRateLimit(senderLike, settings);
    if (!rateLimitResult.allowed) {
      sendResponse({ success: false, error: rateLimitResult.error });
      return;
    }

    const autoContentFetchEnabled = settings[StorageKeys.AUTO_CONTENT_FETCH_ENABLED] as boolean;
    const sanitizedUrl = sanitizeUrlForLogging(message.payload.url);

    const isGoogleSites = message.payload.url.includes(GOOGLE_SITES_HOST);
    if (!content && !skipAi) {
      if (isGoogleSites && message.payload.force) {
        await logDebug('Google Sites detected with force flag, skipping content fetch', { url: sanitizedUrl }, 'service-worker');
      } else {
        if (!autoContentFetchEnabled && !message.payload.force) {
          await logDebug(
            'Content fetch disabled (AUTO_CONTENT_FETCH_ENABLED=false)',
            { url: sanitizedUrl },
            'service-worker',
          );
          sendResponse({
            success: true,
            warning: 'Content fetch is disabled. Enable it in settings or provide content directly.',
          });
          return;
        }

        content = await deps.fetchContent(message.payload.url);
      }
    }

    const pipeline = deps.recordingPipeline;

    // PBI 2026-09-12-04: field whitelist + source policy live in the shared
    // builder (was a hand-spread literal duplicated with SAVE_RECORD).
    const result = await pipeline.record(buildRecordRequest('manual', {
      title: message.payload.title,
      url: message.payload.url,
      content,
      ...pickRecordDiagnostics(message.payload),
      skipAi,
      previewOnly: message.type === 'PREVIEW_RECORD',
      force: message.payload.force,
    }), { settings });

    if (result.success) {
      await deps.setUrlContent(message.payload.url, content);
    }

    sendResponse(result);
  };
}

export function createSaveRecordHandler(deps: SaveRecordHandlerDeps) {
  return async (
    message: SaveRecordMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    // VULN-004: SAVE_RECORD is an extension-page operation.
    // Enforced by the registry's 'extension-only' trust level.
    if (!(await deps.isRecordingAllowed())) {
      sendResponse({ success: false, reason: 'privacy_consent_required' });
      return;
    }

    // VULN-004 fix: validate URL scheme before processing (same as MANUAL_RECORD)
    if (!isSecureUrl(message.payload.url)) {
      await logWarn(
        'Blocked SAVE_RECORD with insecure URL',
        { url: message.payload.url },
        undefined,
        'service-worker',
      );
      sendResponse({ success: false, error: 'Insecure URL protocol not allowed' });
      return;
    }

    const settings = await deps.getSettings();

    const pipeline = deps.recordingPipeline;

    const result = await pipeline.record(buildRecordRequest('save', {
      title: message.payload.title,
      url: message.payload.url,
      content: message.payload.content,
      force: message.payload.force,
      // maskedCount is never forwarded: owned by pickRecordDiagnostics (VULN-007).
      ...pickRecordDiagnostics(message.payload),
    }), { settings });

    if (result.success && message.payload.content) {
      await deps.setUrlContent(message.payload.url, message.payload.content);
    }

    sendResponse(result);
  };
}

// ============================================================================
// REGENERATE_SUMMARY (PBI 2026-09-22-04)
// ============================================================================

export function createRegenerateSummaryHandler(deps: RegenerateSummaryHandlerDeps) {
  // Handler-local in-flight guard (binding: SW の handler-local Set・永続化しない).
  const inFlight = new Set<number>();

  return async (
    message: RegenerateSummaryMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    const { id, url, title, cleanseMode, force } = message.payload;

    try {
      // CRITICAL: claim the slot SYNCHRONOUSLY, before any await. Two rapid
      // dispatches would otherwise both pass a has()-check that sits across
      // await boundaries (check-then-act race) and double-call the AI —
      // binding: 2件目以降は無視（AI呼び出しは1回だけ）.
      if (inFlight.has(id)) {
        sendResponse({ success: false, error: 'in_flight' });
        return;
      }
      inFlight.add(id);

      try {
        if (!(await deps.isRecordingAllowed())) {
          sendResponse({ success: false, error: 'privacy_consent_required' });
          return;
        }

        const settings = await deps.getSettings();
        const senderLike: MessageSenderLike = {
          ...pickDefined({
            url: sender.url,
            tab: sender.tab ? pickDefined({ id: sender.tab.id }) : undefined,
          }),
        };
        const rate = await deps.checkRateLimit(senderLike, settings, { bucket: 'regenerate' });
        if (!rate.allowed) {
          sendResponse({ success: false, error: rate.error ?? 'rate_limited', reason: 'rate_limited' });
          return;
        }

        try {
          validateUrl(url, { requireValidProtocol: true, blockLocalhost: true });
        } catch {
          sendResponse({ success: false, error: 'invalid_url' });
          return;
        }

        let extracted: ContentResponse;
        try {
          extracted = await deps.fetchExtracted(url, cleanseMode);
        } catch (e: unknown) {
          sendResponse({ success: false, error: `fetch_failed: ${errorMessage(e)}` });
          return;
        }

        const data = buildRecordRequest('regenerate', {
          title,
          url,
          content: extracted.content,
          // Ask Q1C: force is caller-explicit only (policy default is off).
          ...(force === true ? { force: true } : {}),
          targetEntryId: id,
          ...pickRecordDiagnostics(extracted),
        });

        const result = await deps.recordingPipeline.record(data, { settings });

        // Gate rejection on the non-force path → offer the explicit force retry
        // (Ask Q1C). PERMISSION_REQUIRED / INVALID_URL are intentionally absent:
        // force does not bypass decidePermission / validateUrl. When the caller
        // ALREADY forced and the gate still rejected, re-offering force is
        // noise — the pipeline result passes through unchanged.
        if (
          !result.success &&
          !result.skipped &&
          force !== true &&
          result.error !== undefined &&
          FORCE_OFFERABLE_ERRORS.has(result.error)
        ) {
          sendResponse({ ...result, needsForce: true });
          return;
        }
        // PBI 2026-09-22-04 follow-up: the pipeline reports success even when
        // the AI produced only an error string (buildResult is unconditional).
        // Never persist that as a regenerated summary — surface the AI
        // failure and leave the existing row untouched.
        if (result.aiSucceeded === false) {
          sendResponse({
            success: false,
            error: 'ai_failed',
            ...(result.attemptedProviders !== undefined
              ? { providersTried: result.attemptedProviders }
              : {}),
            ...(result.slotFailures !== undefined
              ? { slotFailures: result.slotFailures }
              : {}),
          });
          return;
        }
        sendResponse(result);
      } finally {
        inFlight.delete(id);
      }
    } catch (e: unknown) {
      sendResponse({ success: false, error: errorMessage(e) });
    }
  };
}
