// @layer 1 — UrlCache (60s TTL, part of RecordingCache deep module)

import { LogType } from '../../utils/logger/types.js';
import { addLog } from '../../utils/logger/core.js';

export const URL_CACHE_TTL = 60 * 1000;

export class UrlCache {
  private cache: Map<string, number> | null = null;
  private timestamp: number | null = null;

  invalidate(): void {
    addLog(LogType.DEBUG, 'URL cache invalidated');
    this.cache = null;
    this.timestamp = null;
  }

  isStale(now: number): boolean {
    return !this.cache || !this.timestamp || now - this.timestamp >= URL_CACHE_TTL;
  }

  getState(): { cache: Map<string, number> | null; timestamp: number | null } {
    return { cache: this.cache, timestamp: this.timestamp };
  }

  setState(cache: Map<string, number> | null, timestamp: number | null): void {
    this.cache = cache;
    this.timestamp = timestamp;
  }
}
