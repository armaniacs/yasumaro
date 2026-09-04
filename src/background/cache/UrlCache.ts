// @layer 1 — UrlCache (60s TTL, part of RecordingCache deep module)

import { getSavedUrlsWithTimestamps } from '../../utils/storage/savedUrlRepository.js';
import { addLog, LogType } from '../../utils/logger.js';

export const URL_CACHE_TTL = 60 * 1000;

export class UrlCache {
  private cache: Map<string, number> | null = null;
  private timestamp: number | null = null;

  async get(): Promise<Map<string, number>> {
    const now = Date.now();
    if (this.cache && this.timestamp && now - this.timestamp < URL_CACHE_TTL) {
      addLog(LogType.DEBUG, 'URL cache hit', { count: this.cache.size, age: `${now - this.timestamp}ms` });
      return this.cache;
    }
    const urlMap = await getSavedUrlsWithTimestamps();
    this.cache = new Map(urlMap);
    this.timestamp = now;
    addLog(LogType.DEBUG, 'URL cache updated', { count: urlMap.size });
    return urlMap;
  }

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
