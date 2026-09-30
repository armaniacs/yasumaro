/**
 * providerBreaker.ts — cross-request circuit breaker for AI providers.
 *
 * PBI 27-03 (policy: PBI 15, `dev-docs/archived/plans/2026-09-27-pbi15-ai-provider-circuit-breaker-policy.md`
 * §3-§5). The numbers below ARE the parameter table — change them only
 * together with the table.
 *
 * Design (from the report):
 * - Skip decision is lazy: `openUntil` timestamp vs now. No timers, no alarms,
 *   no module-global state beyond the in-process serialization chains (which
 *   are locks, not the SSOT — the store is).
 * - Input is `FailureMetadata.kind` only. A result without `failure` is not a
 *   breaker input at all.
 * - Fail-open everywhere: malformed entries read as absent, store errors are
 *   swallowed, and callers fall back to trying every slot.
 * - Keys never contain secrets: `${provider}::${model}` only.
 */

import { SESSION_KEYS, type SessionStorePort } from '../sessionStore.js';
import { FailureKind, type FailureKindValue, type FailureMetadata } from '../../utils/failureTaxonomy.js';

/** Consecutive breaker failures that open the default cooldown (policy §4). */
export const BREAKER_FAILURE_THRESHOLD = 3;
/** Default cooldown (policy §4). */
export const BREAKER_COOLDOWN_MS = 5 * 60 * 1000;
/** Auth failures cool down longer — a dead credential does not heal (policy §4). */
export const BREAKER_AUTH_COOLDOWN_MS = 15 * 60 * 1000;
/** 429 answers mean "back off" — honor it longer than the default (policy §4). */
export const BREAKER_RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1000;

/** Storage key for the breaker state (SESSION_KEYS member). */
export const BREAKER_STATE_KEY = SESSION_KEYS.AI_PROVIDER_BREAKER;

export interface ProviderBreakerEntry {
  failures: number;
  openedAt?: number | undefined;
  openUntil?: number | undefined;
  openedBy?: FailureKindValue | undefined;
}

export type ProviderBreakerState = Record<string, ProviderBreakerEntry | undefined>;

/** State key for one provider × model slot. Never embeds secrets. */
export function breakerKey(provider: string, model?: string): string {
  return `${provider}::${model ?? 'default'}`;
}

/**
 * Failure class matrix (policy §3): which taxonomy kinds feed the breaker.
 * `configuration` and `csp` are user-fixable settings states, not provider
 * health — cooling them down would trap a fixed setup. Results without a
 * `failure` never reach this function (callers check first).
 */
export function breakerInputFor(failure: FailureMetadata): 'count' | 'ignore' {
  switch (failure.kind) {
    case FailureKind.NETWORK:
    case FailureKind.TIMEOUT:
    case FailureKind.HTTP:
    case FailureKind.AUTH:
    case FailureKind.RATE_LIMIT:
      return 'count';
    case FailureKind.CONFIGURATION:
    case FailureKind.CSP:
      return 'ignore';
  }
}

/** Per-kind cooldown (policy §4). */
export function cooldownFor(kind: FailureKindValue): number {
  switch (kind) {
    case FailureKind.AUTH:
      return BREAKER_AUTH_COOLDOWN_MS;
    case FailureKind.RATE_LIMIT:
      return BREAKER_RATE_LIMIT_COOLDOWN_MS;
    default:
      return BREAKER_COOLDOWN_MS;
  }
}

/** Kinds that open the cooldown on the very first failure (policy §4). */
function opensImmediately(kind: FailureKindValue): boolean {
  return kind === FailureKind.AUTH || kind === FailureKind.RATE_LIMIT;
}

export type BreakerOutcome =
  | { type: 'success' }
  | { type: 'failure'; failure: FailureMetadata };

/**
 * Pure entry transition. Success deletes the entry (reset). Ignored kinds
 * leave it untouched. Counted failures increment and open the cooldown at
 * the threshold — or immediately for auth/rate_limit. A failure recorded
 * after expiry reopens from now.
 */
export function nextEntry(
  current: ProviderBreakerEntry | undefined,
  outcome: BreakerOutcome,
  now: number,
): ProviderBreakerEntry | undefined {
  if (outcome.type === 'success') {
    return undefined;
  }
  if (breakerInputFor(outcome.failure) === 'ignore') {
    return current;
  }
  const kind = outcome.failure.kind;
  const failures = (current?.failures ?? 0) + 1;
  if (opensImmediately(kind) || failures >= BREAKER_FAILURE_THRESHOLD) {
    return { failures, openedAt: now, openUntil: now + cooldownFor(kind), openedBy: kind };
  }
  return { failures };
}

/** Lazy half-open: attempt when there is no entry, no open cooldown, or the cooldown has expired (probe). */
export function shouldAttemptEntry(entry: ProviderBreakerEntry | undefined, now: number): boolean {
  if (entry === undefined || entry.openUntil === undefined) {
    return true;
  }
  return now >= entry.openUntil;
}

function isValidEntry(value: unknown): value is ProviderBreakerEntry {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.failures === 'number' &&
    Number.isFinite(entry.failures) &&
    entry.failures >= 0 &&
    (entry.openedAt === undefined || typeof entry.openedAt === 'number') &&
    (entry.openUntil === undefined || typeof entry.openUntil === 'number') &&
    (entry.openedBy === undefined || typeof entry.openedBy === 'string')
  );
}

/** Drop malformed entries; the store may hold anything. Fail-open. */
function sanitizeState(state: unknown): ProviderBreakerState {
  if (state === null || typeof state !== 'object') {
    return {};
  }
  const clean: ProviderBreakerState = {};
  for (const [key, value] of Object.entries(state as Record<string, unknown>)) {
    if (isValidEntry(value)) {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Why a slot is not being attempted right now, so a suppressed call can report
 * the real cause instead of reusing an unrelated failure kind.
 */
export interface ProviderCooldown {
  /** The failure kind that opened the breaker for this slot. */
  kind: FailureKindValue;
  /** Epoch ms at which the slot becomes attemptable again. */
  openUntil: number;
}

/** Minimal surface RemoteAIService needs; also the test seam. */
export interface ProviderBreakerLike {
  shouldAttempt(provider: string, model?: string): Promise<boolean>;
  /** The open cooldown for this slot, or null when it is attemptable. */
  cooldown(provider: string, model?: string): Promise<ProviderCooldown | null>;
  recordSuccess(provider: string, model?: string): Promise<void>;
  recordFailure(provider: string, model: string | undefined, failure: FailureMetadata): Promise<void>;
  /** Drop every entry (PBI 27-08). One wholesale form — never a per-slot delete. */
  clearAll(): Promise<void>;
}

/** Default when no breaker is wired: try everything, remember nothing. */
export const disabledBreaker: ProviderBreakerLike = {
  shouldAttempt: async () => true,
  cooldown: async () => null,
  recordSuccess: async () => {},
  recordFailure: async () => {},
  clearAll: async () => {},
};

export class ProviderBreaker implements ProviderBreakerLike {
  /**
   * In-process serialization. The whole breaker state lives under ONE store
   * key, so every mutation is a read-modify-write of that same map: serializing
   * per breaker key would let two slots for different providers interleave
   * between the read and the write and drop each other's entry. One chain for
   * all mutations, and the SSOT stays in the store, so a SW restart loses
   * nothing but in-flight ordering (which a fresh process rebuilds on demand).
   */
  private readonly chain: { tail: Promise<void> } = { tail: Promise.resolve() };

  constructor(private readonly store: SessionStorePort) {}

  private async mutate(fn: (state: ProviderBreakerState) => ProviderBreakerState): Promise<void> {
    const previous = this.chain.tail;
    const next = previous.then(() => this.applyMutation(fn)).catch(() => {});
    this.chain.tail = next;
    await next;
  }

  private async applyMutation(fn: (state: ProviderBreakerState) => ProviderBreakerState): Promise<void> {
    // Fail-open: a dead session store must never stop summaries. The caller
    // then behaves as if the breaker had no entry (try everything).
    try {
      const raw = await this.store.get<ProviderBreakerState>(BREAKER_STATE_KEY);
      const state = sanitizeState(raw);
      const next = fn(state);
      // Returning the input object unchanged means "nothing to record" — the
      // identity is the no-op signal, so no storage write is spent on it.
      if (next === state) {
        return;
      }
      await this.store.set(BREAKER_STATE_KEY, next, { flushImmediately: true });
    } catch {
      // Swallowed on purpose — see above.
    }
  }

  async shouldAttempt(provider: string, model?: string, now: number = Date.now()): Promise<boolean> {
    try {
      const raw = await this.store.get<ProviderBreakerState>(BREAKER_STATE_KEY);
      return shouldAttemptEntry(sanitizeState(raw)[breakerKey(provider, model)], now);
    } catch {
      return true;
    }
  }

  async cooldown(provider: string, model?: string, now: number = Date.now()): Promise<ProviderCooldown | null> {
    try {
      const raw = await this.store.get<ProviderBreakerState>(BREAKER_STATE_KEY);
      const entry = sanitizeState(raw)[breakerKey(provider, model)];
      if (entry?.openUntil === undefined || now >= entry.openUntil) {
        return null;
      }
      return { kind: entry.openedBy ?? FailureKind.HTTP, openUntil: entry.openUntil };
    } catch {
      return null;
    }
  }

  async recordSuccess(provider: string, model?: string): Promise<void> {
    const key = breakerKey(provider, model);
    await this.mutate((state) => {
      if (state[key] === undefined) {
        return state;
      }
      const next = { ...state };
      delete next[key];
      return next;
    });
  }

  async recordFailure(provider: string, model: string | undefined, failure: FailureMetadata): Promise<void> {
    const key = breakerKey(provider, model);
    await this.mutate((state) => {
      const next = nextEntry(state[key], { type: 'failure', failure }, Date.now());
      if (next === undefined) {
        if (state[key] === undefined) {
          return state;
        }
        const cleared = { ...state };
        delete cleared[key];
        return cleared;
      }
      // Ignored kinds return the identical entry — no write needed.
      if (next === state[key]) {
        return state;
      }
      return { ...state, [key]: next };
    });
  }

  /**
   * PBI 27-08: the manual reset. A cooldown is a guess about a provider that
   * has not been looked at since it tripped, so one successful connection test
   * invalidates every one of them at once — partial deletion would leave a
   * stale entry to suppress a slot the user never tested. It rides the shared
   * chain for the same reason the other mutations do, and it swallows store
   * errors so a reset can never turn a working summary into an error.
   */
  async clearAll(): Promise<void> {
    await this.mutate((state) => (Object.keys(state).length === 0 ? state : {}));
  }
}
