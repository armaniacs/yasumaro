// @layer 1 — SettingsCache (30s TTL, part of RecordingCache deep module)
/**
 * SettingsCache — typed cache for Settings with 30s TTL.
 * Extracted from RecordingCacheInstance (433l) to give each TTL its own locality.
 */

import type { Settings } from '../../utils/storage/types.js';
import type { SettingsReader } from '../../utils/storage/SettingsRepository.js';
import { settingsRepository } from '../../utils/storage/SettingsRepository.js';
import { addLog, LogType } from '../../utils/logger.js';

export const SETTINGS_CACHE_TTL = 30 * 1000;

export class SettingsCache {
  private cache: Settings | null = null;
  private timestamp: number | null = null;
  private version = 0;

  constructor(private readonly repo: SettingsReader = settingsRepository) {}

  async get(): Promise<Settings> {
    const now = Date.now();
    if (this.cache && this.timestamp && now - this.timestamp < SETTINGS_CACHE_TTL) {
      addLog(LogType.DEBUG, 'Settings cache hit', { age: `${now - this.timestamp}ms` });
      return this.cache;
    }
    return this.fetchAndCache(now);
  }

  private async fetchAndCache(now: number): Promise<Settings> {
    const settings = await this.repo.getAll();
    this.cache = settings;
    this.timestamp = now;
    this.version++;
    addLog(LogType.DEBUG, 'Settings cache updated', { cacheVersion: this.version });
    return settings;
  }

  invalidate(): void {
    addLog(LogType.DEBUG, 'Settings cache invalidated');
    this.cache = null;
    this.timestamp = null;
    this.version++;
  }

  getState(): { cache: Settings | null; timestamp: number | null; version: number } {
    return { cache: this.cache, timestamp: this.timestamp, version: this.version };
  }

  setState(cache: Settings | null, timestamp: number | null, version: number): void {
    this.cache = cache;
    this.timestamp = timestamp;
    this.version = version;
  }

  isStale(now: number): boolean {
    return !this.cache || !this.timestamp || now - this.timestamp >= SETTINGS_CACHE_TTL;
  }
}
