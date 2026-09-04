// @layer 1 — PrivacyCache (5m TTL, part of RecordingCache deep module)

import { addLog, LogType } from '../../utils/logger.js';
import type { PrivacyInfo } from '../../utils/privacyChecker.js';
import { isPrivacyInfo } from '../../utils/privacyChecker.js';

export const PRIVACY_CACHE_TTL = 5 * 60 * 1000;

function normalizeUrlForCache(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    let normalized = parsed.toString();
    if (normalized.endsWith('/') && parsed.pathname !== '/') normalized = normalized.slice(0, -1);
    return normalized;
  } catch {
    return url;
  }
}

export class PrivacyCache {
  private cache: Map<string, PrivacyInfo> | null = null;
  private timestamp: number | null = null;

  get(): Map<string, PrivacyInfo> | null {
    return this.cache;
  }

  setEntry(url: string, info: PrivacyInfo): void {
    if (!this.cache) {
      this.cache = new Map();
      this.timestamp = Date.now();
    }
    this.cache.set(url, info);
  }

  size(): number {
    return this.cache?.size ?? 0;
  }

  isInitialized(): boolean {
    return this.cache !== null;
  }

  invalidate(): void {
    this.cache = null;
    this.timestamp = null;
  }

  isStale(now: number): boolean {
    return !this.cache || !this.timestamp || now - this.timestamp >= PRIVACY_CACHE_TTL;
  }

  async getWithFallback(url: string): Promise<PrivacyInfo | null> {
    const now = Date.now();
    const normalizedUrl = normalizeUrlForCache(url);

    if (this.cache) {
      const cached = this.cache.get(normalizedUrl);
      if (cached && now - cached.timestamp < PRIVACY_CACHE_TTL) {
        addLog(LogType.DEBUG, 'Privacy cache hit', { url });
        return cached;
      }
    }

    if (chrome.storage.session) {
      try {
        const sessionKey = 'privacyCache_' + normalizedUrl;
        const result = await chrome.storage.session.get(sessionKey);
        const cached = isPrivacyInfo(result[sessionKey]) ? result[sessionKey] : undefined;
        if (cached) {
          if (now - cached.timestamp >= PRIVACY_CACHE_TTL) {
            await chrome.storage.session.remove(sessionKey);
            addLog(LogType.DEBUG, 'Privacy cache session entry expired, evicted', { url });
          } else {
            if (!this.cache) {
              this.cache = new Map();
              this.timestamp = Date.now();
            }
            this.cache.set(normalizedUrl, cached);
            addLog(LogType.DEBUG, 'Privacy cache restored from session storage', { url });
            return cached;
          }
        }
      } catch {
        // non-fatal
      }
    }

    addLog(LogType.DEBUG, 'Privacy check skipped: no header data', { url });
    return null;
  }

  getState(): { cache: Map<string, PrivacyInfo> | null; timestamp: number | null } {
    return { cache: this.cache, timestamp: this.timestamp };
  }

  setState(cache: Map<string, PrivacyInfo> | null, timestamp: number | null): void {
    this.cache = cache;
    this.timestamp = timestamp;
  }

  async clearSession(): Promise<void> {
    if (chrome.storage.session) {
      try {
        const all = await chrome.storage.session.get(null);
        const privacyKeys = Object.keys(all).filter((k) => k.startsWith('privacyCache_'));
        if (privacyKeys.length > 0) await chrome.storage.session.remove(privacyKeys);
      } catch {}
    }
  }
}
