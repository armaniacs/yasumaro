// @layer 0 — Foundation: HTTP status → user-facing failure message table
/**
 * Single table mapping an HTTP status to the user-facing failure message, plus
 * the two envelope builders the AI provider flows wrap it in.
 *
 * The three connection-test call sites historically diverged in wording for the
 * same status, so the table carries legacy-compat presets keyed by conventional
 * domain labels ('Obsidian', 'GitHub'); every other label uses the generic
 * provider-style template. Callers delegate only the statuses they currently
 * distinguish — unifying the wording itself is a separate product decision and
 * out of scope for the SSOT refactor, so these presets must stay byte-identical.
 *
 * The fetch-throw path (`mapHttpFetchFailure` below) historically
 * carried its own copy of this table with different wording (e.g. 401 is
 * `Invalid API key...` here vs `Authentication failed...` on the connection
 * path). That copy now lives behind `variant: 'parse'` so both tables share one
 * definition site without unifying the wording itself — the parse preset must
 * also stay byte-identical to the pre-migration parse wording. The parse preset
 * intentionally ignores the Obsidian/GitHub domain presets: the parse path
 * never branched on them, so every label uses the generic template.
 *
 * WHY the envelopes live here rather than in a provider: the status table, the
 * timeout signal and the structured kind that travels beside a sentence are one
 * decision. Split across the provider base, a custom provider could pick a
 * sentence from this table and attach a kind from somewhere else, and the two
 * would disagree exactly where the breaker branches.
 */

import { errorMessage } from './errorUtils.js';
import { pickDefined } from './objectUtils.js';
import {
  FailureKind,
  createFailure,
  failureFromHttpStatus,
  resolveFailure,
  withFailure,
  type FailureMetadata,
} from './failureTaxonomy.js';

/** Known legacy-compat presets; any other label uses the generic template. */
export type HttpFailureDomain = 'Obsidian' | 'GitHub' | (string & {});

export function describeHttpFailure(
  status: number,
  domainLabel: HttpFailureDomain,
  variant: 'connection' | 'parse' = 'connection',
): string {
  if (variant === 'parse') {
    if (status === 401 || status === 403) {
      return `Invalid API key (${status}). Check your ${domainLabel} API key settings.`;
    }
    if (status === 404) {
      return 'Model or endpoint not found (404). Check your Base URL.';
    }
    if (status === 429) {
      return 'Rate limit exceeded (429). Please try again later.';
    }
    return `${domainLabel} API server error (${status}). Please try again later.`;
  }
  if (status === 401 || status === 403) {
    if (domainLabel === 'Obsidian') {
      return `Authentication failed (${status}). Check your API key.`;
    }
    if (domainLabel === 'GitHub') {
      return 'Invalid GitHub PAT (unauthorized)';
    }
    return `Authentication failed (${status}). Check your ${domainLabel} API key.`;
  }
  if (status === 404) {
    if (domainLabel === 'Obsidian') {
      return 'Endpoint not found (404). Is Local REST API plugin enabled?';
    }
    if (domainLabel === 'GitHub') {
      return 'GitHub API error: 404';
    }
    return 'Endpoint not found (404). Check your Base URL.';
  }
  if (domainLabel === 'GitHub') {
    return `GitHub API error: ${status}`;
  }
  if (status === 429) {
    return 'Rate limit exceeded (429). Please try again later.';
  }
  return `${domainLabel} API Error: ${status}`;
}

/**
 * Timeout signal for the whole AI boundary, shared by the summary flow and the
 * connection-test mapping.
 *
 * WHY a text sniff at all when `resolveFailure` already classifies an
 * `AbortError` by name: the two call sites receive different carriers. The
 * transport hands the summary flow a real Error (always named), but the
 * connection-test mapping is also called with a bare message by callers that
 * have nothing but a string. The two used to disagree — the summary flow
 * matched `AbortError`/`timed out` while the parse path also matched
 * `timeout` — so the same word could produce two different sentences depending
 * on which flow saw it. One predicate, one sentence.
 *
 * This is a compatibility read, not a control-flow signal: the retry decision
 * reads the structured kind only (see `shouldRetryTransportFailure`).
 */
export function isHttpTimeoutFailure(errorName: string | undefined, message: string): boolean {
  return (
    errorName === 'AbortError' ||
    message.includes('timed out') ||
    message.includes('timeout')
  );
}

/** Diagnostic bag of a connection-test failure. Merged with the test's own debug fields. */
export interface HttpFailureDebug {
  /** HTTP status code if applicable. */
  statusCode?: number;
  /** Error message if the test failed. */
  error?: string;
  /** Structured failure, never carrying key material or a response body. */
  failure?: FailureMetadata;
}

/** A failed connection test, before the caller spreads its own debug fields over it. */
export interface HttpFailureResult {
  success: false;
  message: string;
  debug: HttpFailureDebug;
}

/**
 * A response the transport returned as not-ok (the connection-test flow sees
 * these; the summary flow's transport throws instead).
 */
export function mapHttpConnectionFailure(
  statusCode: number,
  providerLabel: HttpFailureDomain,
): HttpFailureResult {
  return {
    success: false,
    message: describeHttpFailure(statusCode, providerLabel),
    debug: { statusCode, failure: failureFromHttpStatus(statusCode) },
  };
}

/**
 * A request that threw before producing a response.
 *
 * `failure` is the already-structured metadata when the caller has it — its
 * kind is authoritative, because a caller that resolved the kind structurally
 * knows more than a message scan can recover.
 */
export function mapHttpFetchFailure(
  message: string,
  providerLabel: HttpFailureDomain,
  errorName?: string,
  failure?: FailureMetadata | null,
): HttpFailureResult {
  if (isHttpTimeoutFailure(errorName, message)) {
    return {
      success: false,
      message: 'Connection timed out. Check your network or increase timeout.',
      debug: { error: message, failure: failure ?? createFailure(FailureKind.TIMEOUT) },
    };
  }

  const statusCode = parseHttpStatusFromMessage(message);

  // Status wording lives in describeHttpFailure's parse preset (SSOT); the
  // branch set below mirrors the pre-migration table exactly so the wording
  // stays byte-identical. Unifying it with the connection preset is a separate
  // product decision.
  if (
    statusCode === 401 || statusCode === 403 || statusCode === 404 ||
    statusCode === 429 || statusCode >= 500
  ) {
    return {
      success: false,
      message: describeHttpFailure(statusCode, providerLabel, 'parse'),
      debug: { error: message, statusCode, failure: failure ?? failureFromHttpStatus(statusCode) },
    };
  }
  if (message.includes('Failed to fetch')) {
    return {
      success: false,
      message: 'Cannot connect. Check your Base URL and network.',
      debug: { error: message, failure: failure ?? createFailure(FailureKind.NETWORK) },
    };
  }
  return {
    success: false,
    message: `Connection error: ${message}`,
    debug: {
      error: message,
      ...pickDefined({ statusCode: statusCode || undefined }),
      ...(failure ? { failure } : {}),
    },
  };
}

/** The `HTTP <code>:` prefix fetchWithRetry puts on the Error it throws. */
function parseHttpStatusFromMessage(message: string): number {
  const matched = message.match(/HTTP\s+(\d+):/);
  return matched?.[1] ? parseInt(matched[1], 10) : 0;
}

/** The summary sentence for a request that never produced a summary. */
export const SUMMARY_FAILURE_MESSAGE =
  'Error: Failed to generate summary. Please try again or check your settings.';

/** The summary sentence for a request that timed out. */
export const SUMMARY_TIMEOUT_MESSAGE =
  'Error: AI request timed out. Please check your connection.';

/**
 * Longest diagnostic detail carried in `error`. The detail is surfaced per slot
 * and rendered in the regenerate trail, so a provider echoing a whole response
 * body must not ride along into the UI.
 */
export const SUMMARY_FAILURE_DETAIL_LIMIT = 300;

/** A failed summary, as the summary flow returns it. */
export interface SummaryFailureResult {
  success: false;
  summary: string;
  /** Technical detail for the per-slot diagnostic channel; never user-facing. */
  error: string;
  failure?: FailureMetadata;
}

/**
 * The one mapping from a thrown summary request to a user-facing sentence.
 *
 * The summary is persisted as Obsidian page content, so it stays generic; the
 * detail rides in `error` and the classification in `failure`, the structured
 * channel the breaker and the retry policy read. Both AI flows classify through
 * `isHttpTimeoutFailure`, so the same thrown error cannot produce a timeout
 * sentence on one and a generic sentence on the other.
 */
export function describeSummaryRequestFailure(error: unknown): SummaryFailureResult {
  const message = errorMessage(error);
  const errorName = error instanceof Error ? error.name : undefined;
  const detail = message.substring(0, SUMMARY_FAILURE_DETAIL_LIMIT);
  const failure = resolveFailure(error);

  if (isHttpTimeoutFailure(errorName, message)) {
    const result = { success: false as const, summary: SUMMARY_TIMEOUT_MESSAGE, error: detail };
    return withFailure(result, failure ?? createFailure(FailureKind.TIMEOUT));
  }
  const result = { success: false as const, summary: SUMMARY_FAILURE_MESSAGE, error: detail };
  return failure ? withFailure(result, failure) : result;
}
