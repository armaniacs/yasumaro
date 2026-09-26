// @layer 0 — Foundation: structured failure taxonomy (SSOT)
/**
 * Single source of truth for "why did this recording step fail".
 *
 * Two concerns used to live in one string: the classification a retry decision
 * must read, and the sanitized sentence a user reads. Only the first belongs in
 * control flow. This module therefore owns the seven failure kinds, the
 * per-kind retry eligibility, and the one normalization that turns a thrown
 * Error or a result summary into structured metadata. `message` is never read
 * as a signal except in the explicitly-marked compatibility helpers at the
 * bottom, which exist only for carriers that predate this contract.
 *
 * Layer 0 (pure, no imports, no `chrome`) so every boundary — fetch transport,
 * Obsidian, AI providers, the recording pipeline — can depend on it without a
 * utils -> background edge, and so the two retry predicates (fetchWithRetry and
 * the AI summary flow) stop carrying their own copies of the same tables.
 *
 * Secret discipline: `FailureMetadata` may hold an HTTP status, a method, and a
 * cause *name*. It never holds a message, a response body, an API key, or an
 * Error object — an Error's message is exactly where those end up.
 */

/** The seven failure kinds. Declared here and nowhere else. */
export const FailureKind = {
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  HTTP: 'http',
  AUTH: 'auth',
  RATE_LIMIT: 'rate_limit',
  CONFIGURATION: 'configuration',
  CSP: 'csp',
} as const;

export type FailureKindValue = (typeof FailureKind)[keyof typeof FailureKind];

/** All kinds, derived from the declaration so the list cannot drift. */
export const FAILURE_KINDS: readonly FailureKindValue[] = Object.freeze(
  Object.values(FailureKind) as FailureKindValue[],
);

/**
 * Diagnostic detail about *what* broke, normalized to the point where it cannot
 * leak. A cause's name is kept (AbortError vs TypeError is the diagnostic that
 * matters); its message is not.
 */
export interface FailureCause {
  name: string;
}

/** Structured, sanitized description of a failure. Carried, never displayed. */
export interface FailureMetadata {
  kind: FailureKindValue;
  /** HTTP status, when the failure came from a response. */
  status?: number;
  /** HTTP method of the request that failed. */
  method?: string;
  cause?: FailureCause;
}

export interface FailureRetryProfile {
  /** A further attempt can plausibly succeed without operator action. */
  immediateRetry: boolean;
  /** Eligible for the delayed offline recovery queue. */
  offlineRecovery: boolean;
  /** The same request may be sent again inside one attempt chain. */
  sameRequestResend: boolean;
}

/**
 * Per-kind retry contract. `http` is retryable in principle but never enters
 * offline recovery, and `rate_limit` is closed off entirely: retrying a 429 only
 * deepens the throttling (docs/EXTERNAL_API_RELIABILITY_GUIDELINE.md §2).
 */
export const FAILURE_RETRY_PROFILE: Readonly<Record<FailureKindValue, FailureRetryProfile>> = {
  network: { immediateRetry: true, offlineRecovery: true, sameRequestResend: true },
  timeout: { immediateRetry: true, offlineRecovery: true, sameRequestResend: true },
  http: { immediateRetry: true, offlineRecovery: false, sameRequestResend: true },
  auth: { immediateRetry: false, offlineRecovery: false, sameRequestResend: false },
  rate_limit: { immediateRetry: false, offlineRecovery: false, sameRequestResend: false },
  configuration: { immediateRetry: false, offlineRecovery: false, sameRequestResend: false },
  csp: { immediateRetry: false, offlineRecovery: false, sameRequestResend: false },
};

/** Kinds eligible for the delayed offline recovery queue (derived, not restated). */
export const OFFLINE_RECOVERY_KINDS: readonly FailureKindValue[] = Object.freeze(
  FAILURE_KINDS.filter((kind) => FAILURE_RETRY_PROFILE[kind].offlineRecovery),
);

/**
 * Methods whose request may already have been processed server-side. Re-sending
 * them risks a duplicate write, so a 5xx on one of these must not be retried
 * inside the same request.
 */
export const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function allowsImmediateRetry(kind: FailureKindValue): boolean {
  return FAILURE_RETRY_PROFILE[kind].immediateRetry;
}

export function allowsOfflineRecovery(kind: FailureKindValue): boolean {
  return FAILURE_RETRY_PROFILE[kind].offlineRecovery;
}

export function allowsOfflineRecoveryFor(failure: FailureMetadata | null | undefined): boolean {
  return failure != null && allowsOfflineRecovery(failure.kind);
}

/**
 * Whether the same request may be sent again. Unsafe methods are refused for
 * every retryable kind, so a 5xx on a PUT is never re-sent in place.
 */
export function canResendSameRequest(kind: FailureKindValue, method?: string): boolean {
  if (!FAILURE_RETRY_PROFILE[kind].sameRequestResend) {
    return false;
  }
  if (method === undefined || method.length === 0) {
    return true;
  }
  return !UNSAFE_METHODS.has(method.toUpperCase());
}

/**
 * HTTP status to kind. 401/403 are authentication, 429 is rate limiting, and
 * everything else is a plain HTTP fault — 429 is deliberately closed onto
 * `rate_limit` so no caller has to re-derive its retry eligibility.
 */
export function classifyHttpStatus(status: number): FailureKindValue {
  if (status === 401 || status === 403) return FailureKind.AUTH;
  if (status === 429) return FailureKind.RATE_LIMIT;
  return FailureKind.HTTP;
}

/** Server faults are the only HTTP statuses a resend can improve on. */
export function isTransientHttpStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

function readErrorName(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const name = (value as { name?: unknown }).name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

/** Reduce a cause to its name. A message is never copied, so it cannot leak. */
function normalizeCause(cause: unknown): FailureCause | undefined {
  const name = readErrorName(cause);
  return name === undefined ? undefined : { name };
}

export interface FailureOptions {
  status?: number | undefined;
  method?: string | undefined;
  cause?: unknown;
}

export function createFailure(kind: FailureKindValue, options: FailureOptions = {}): FailureMetadata {
  const failure: FailureMetadata = { kind };
  if (typeof options.status === 'number') {
    failure.status = options.status;
  }
  if (typeof options.method === 'string' && options.method.length > 0) {
    failure.method = options.method.toUpperCase();
  }
  const cause = normalizeCause(options.cause);
  if (cause !== undefined) {
    failure.cause = cause;
  }
  return failure;
}

export function failureFromHttpStatus(status: number, method?: string): FailureMetadata {
  return createFailure(classifyHttpStatus(status), { status, method });
}

/** Property name carrying `FailureMetadata` on thrown Errors and result summaries alike. */
export const FAILURE_KEY = 'failure';

function isFailureKindValue(value: string): value is FailureKindValue {
  return (FAILURE_KINDS as readonly string[]).includes(value);
}

export function isFailureMetadata(value: unknown): value is FailureMetadata {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === 'string' && isFailureKindValue(kind);
}

/** Attach metadata to a plain result object (never to an Error — use tagFailure). */
export function withFailure<T extends object>(
  carrier: T,
  failure: FailureMetadata,
): T & { failure: FailureMetadata } {
  return { ...carrier, [FAILURE_KEY]: failure } as T & { failure: FailureMetadata };
}

/**
 * Attach metadata to a thrown Error. The message is left untouched: it is the
 * sanitized user-facing sentence, and this contract only adds a side channel.
 */
export function tagFailure<E extends Error>(error: E, failure: FailureMetadata): E {
  (error as unknown as Record<string, unknown>)[FAILURE_KEY] = failure;
  return error;
}

export function readFailure(carrier: unknown): FailureMetadata | null {
  if (typeof carrier !== 'object' || carrier === null) return null;
  const value = (carrier as Record<string, unknown>)[FAILURE_KEY];
  return isFailureMetadata(value) ? value : null;
}

const ABORT_ERROR_NAME = 'AbortError';
const NETWORK_ERROR_NAME = 'NetworkError';
const MAX_CAUSE_DEPTH = 8;

/**
 * The single normalization both failure carriers pass through, so the executor
 * can ask one question ("which kind?") without knowing whether the failure
 * arrived as a thrown Error or as a result summary.
 *
 * Reads structure only: explicit `failure` metadata, the `AbortError` name the
 * transport sets, the `NetworkError` name, and the `cause` chain. Message
 * substrings are not a signal here by design — the compatibility scan for
 * message-only inputs belongs to the consumer that still has to accept them,
 * never to the contract.
 */
export function resolveFailure(carrier: unknown): FailureMetadata | null {
  let current: unknown = carrier;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    const tagged = readFailure(current);
    if (tagged) {
      return tagged;
    }
    const name = readErrorName(current);
    if (name === ABORT_ERROR_NAME) {
      return createFailure(FailureKind.TIMEOUT, { cause: current });
    }
    if (name === NETWORK_ERROR_NAME) {
      return createFailure(FailureKind.NETWORK, { cause: current });
    }
    if (typeof current !== 'object' || current === null) {
      return null;
    }
    const cause = (current as { cause?: unknown }).cause;
    if (cause === undefined || cause === null) {
      return null;
    }
    current = cause;
  }
  return null;
}

// ─── Compatibility (message-only inputs) ───────────────────────────────────

/**
 * Transport markers for failures that carry no structured kind. Compatibility
 * only: every current boundary attaches `FailureMetadata`, so this list is
 * reachable just from callers that hand us a hand-built Error. It must never
 * become a string a new boundary is asked to produce.
 */
const LEGACY_TRANSPORT_MARKERS = ['networkerror', 'fetch failed', 'timed out'] as const;

/**
 * Immediate-retry decision for a failure that arrived without a response.
 * HTTP statuses are decided from the response, not from here — a thrown
 * "HTTP 400" carries kind `http` and must not re-open the request.
 */
export function shouldRetryTransportFailure(carrier: unknown, attempt: number): boolean {
  const failure = resolveFailure(carrier);
  if (failure) {
    if (failure.kind === FailureKind.TIMEOUT) {
      // A timeout leaves the request in an unknown state: one resend probes
      // whether it was merely the slow path.
      return attempt <= 1;
    }
    return failure.kind === FailureKind.NETWORK;
  }
  const name = readErrorName(carrier);
  const message = typeof carrier === 'object' && carrier !== null
    ? String((carrier as { message?: unknown }).message ?? '')
    : '';
  const text = `${name ?? ''} ${message}`.toLowerCase();
  if (name === ABORT_ERROR_NAME || text.includes('timed out')) {
    return attempt <= 1;
  }
  return LEGACY_TRANSPORT_MARKERS.some((marker) => text.includes(marker));
}

/**
 * Immediate-retry decision when the response is already known. Non-transient
 * statuses (including 401/403/429) are terminal, and a transient one is only
 * re-sent when the method is safe.
 */
export function shouldRetryHttpResponse(status: number, method: string = 'GET'): boolean {
  const kind = classifyHttpStatus(status);
  if (!isTransientHttpStatus(status) || !allowsImmediateRetry(kind)) {
    return false;
  }
  return canResendSameRequest(kind, method);
}
