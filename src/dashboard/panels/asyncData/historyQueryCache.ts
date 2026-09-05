import type { UnifiedHistoryQueryData } from './sqliteHistoryQuery.js';

export interface QueryCacheKeyParams {
  sortBy: string;
  sortDir: string;
  page: number;
  search?: string | undefined;
  since?: number | undefined;
  until?: number | undefined;
  tagFilter?: string | null | undefined;
  tagInitiated?: boolean | undefined;
}

export class QueryCache {
  private readonly cap: number;
  private readonly entries = new Map<string, UnifiedHistoryQueryData>();

  constructor(cap = 20) {
    this.cap = cap;
  }

  static buildKey(params: QueryCacheKeyParams): string {
    const s = params.search !== undefined && params.search !== '' ? params.search : '';
    const t = params.tagFilter != null && params.tagFilter !== '' ? params.tagFilter : '';
    const since = params.since !== undefined ? String(params.since) : '';
    const until = params.until !== undefined ? String(params.until) : '';
    // tagInitiated is forwarded to the query and triggers a side effect
    // (onNavigateIn(tag)) — same filter with/without it must not share a key.
    const ti = params.tagInitiated ? '1' : '0';
    return JSON.stringify([params.sortBy, params.sortDir, params.page, s, since, until, t, ti]);
  }

  get(key: string): UnifiedHistoryQueryData | undefined {
    const cached = this.entries.get(key);
    if (cached === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, cached);
    return { ...cached, rows: [...cached.rows] };
  }

  set(key: string, value: UnifiedHistoryQueryData): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.cap) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
