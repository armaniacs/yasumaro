import { SessionStore, SESSION_KEYS } from './sessionStore.js';
import { RATE_LIMITS } from '../constants/appConstants.js';
import { StorageKeys } from '../utils/storage.js';
import { logWarn } from '../utils/logger.js';

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

export function originFromSender(sender: MessageSenderLike | undefined): string {
  if (!sender?.url) return 'unknown';
  try {
    return new URL(sender.url).origin;
  } catch {
    return 'unknown';
  }
}

export class RateLimiter {
  private state = new Map<string, RateLimitEntry>();
  private sessionStore: SessionStore;

  constructor(sessionStore: SessionStore) {
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
    settings: Record<string, unknown>
  ): Promise<RateLimitResult> {
    const senderKey = `origin:${originFromSender(sender)}`;
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

  /** @deprecated Use removeOrigin instead. Kept for backwards compatibility. */
  removeTab(_tabId: number): void {
    logWarn('RateLimiter.removeTab called but is deprecated; use removeOrigin', {}, undefined, 'service-worker');
  }

  clear(): void {
    this.state.clear();
  }

  private persist(): void {
    this.sessionStore.set(SESSION_KEYS.SKIP_AI_RATE_LIMITER, SessionStore.mapToEntries(this.state));
  }
}
