import { SessionStore, SESSION_KEYS, type SessionStorePort } from './sessionStore.js';
import { RATE_LIMITS } from '../constants/appConstants.js';
import { StorageKeys } from '../utils/storage/types.js';
import { logWarn } from '../utils/logger/api.js';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface RateLimitResult {
  allowed: boolean;
  error?: string;
}

export interface MessageSenderLike {
  url?: string;
  tab?: { id?: number };
}

function originFromSender(sender: MessageSenderLike | undefined): string {
  if (!sender?.url) return 'unknown';
  try {
    return new URL(sender.url).origin;
  } catch {
    return 'unknown';
  }
}

export class RateLimiter {
  private state = new Map<string, RateLimitEntry>();
  private sessionStore: SessionStorePort;

  constructor(sessionStore: SessionStorePort) {
    this.sessionStore = sessionStore;
  }

  async initialize(): Promise<void> {
    const entries = await this.sessionStore.get<[string, RateLimitEntry][]>(SESSION_KEYS.SKIP_AI_RATE_LIMITER);
    if (entries) {
      const now = Date.now();
      for (const [key, val] of entries) {
        if (now < val.resetTime) {
          this.state.set(key, val);
        }
      }
    }
  }

  async reload(): Promise<void> {
    const entries = await this.sessionStore.get<[string, RateLimitEntry][]>(SESSION_KEYS.SKIP_AI_RATE_LIMITER);
    if (entries) {
      const now = Date.now();
      this.state.clear();
      for (const [key, val] of entries) {
        if (now < val.resetTime) {
          this.state.set(key, val);
        }
      }
    }
  }

  async check(
    sender: MessageSenderLike | undefined,
    settings: Record<string, unknown>,
    // PBI 04: optional counter bucket — regenerate keeps its own bucket so
    // dashboard bursts never starve popup manual records (Ask N3-B). The
    // default path (no bucket) keeps the legacy `origin:…` key byte-exact.
    opts?: { bucket?: string },
  ): Promise<RateLimitResult> {
    const senderKey = opts?.bucket
      ? `${opts.bucket}:origin:${originFromSender(sender)}`
      : `origin:${originFromSender(sender)}`;
    const now = Date.now();
    const limiterState = this.state.get(senderKey);
    const rateLimitMax = (settings[StorageKeys.SKIP_AI_RATE_LIMIT_MAX] as number) ?? RATE_LIMITS.SKIP_AI_MAX;
    const rateLimitWindow = (settings[StorageKeys.SKIP_AI_RATE_LIMIT_WINDOW_MS] as number) ?? RATE_LIMITS.SKIP_AI_WINDOW_MS;

    if (limiterState) {
      if (now > limiterState.resetTime) {
        this.state.set(senderKey, { count: 1, resetTime: now + rateLimitWindow });
        this.persist();
      } else if (limiterState.count >= rateLimitMax) {
        await logWarn(
          'Rate limit exceeded for skipAi operation',
          { sender: senderKey, limit: rateLimitMax },
          undefined,
          'service-worker'
        );
        return { allowed: false, error: 'Rate limit exceeded. Please try again later.' };
      } else {
        limiterState.count++;
      }
      this.persist();
    } else {
      this.state.set(senderKey, { count: 1, resetTime: now + rateLimitWindow });
      this.persist();
    }

    return { allowed: true };
  }

  removeOrigin(origin: string): void {
    this.state.delete(`origin:${origin}`);
    this.persist();
  }

  /** @deprecated Use removeOrigin instead. Kept for backwards compatibility.
   * Sunset: remove in next major (re-evaluate 2026-12-31). */
  removeTab(_tabId: number): void {
    logWarn('RateLimiter.removeTab called but is deprecated; use removeOrigin', {}, undefined, 'service-worker');
  }

  clear(): void {
    this.state.clear();
  }

  private persist(): void {
    // flushImmediately: rate-limit state must survive a service-worker
    // termination, otherwise a restart would silently reset the skip-AI limit.
    this.sessionStore.set(
      SESSION_KEYS.SKIP_AI_RATE_LIMITER,
      SessionStore.mapToEntries(this.state),
      { flushImmediately: true }
    );
  }
}
