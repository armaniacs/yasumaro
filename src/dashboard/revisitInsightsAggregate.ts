/**
 * revisitInsightsAggregate.ts
 * Pure aggregation for the "Revisits & Time Capsule" panel (PBI 2026-09-26-01).
 * No DOM and no chrome API: the panel fetches rows and renders whatever this
 * returns, so every threshold lives in REVISIT_CONFIG and every ordering rule
 * lives here rather than being re-derived at the call site.
 *
 * Four buckets over one row set:
 * - loops     — keys revisited after a long gap (a gap is the signal, so
 *               `middleCount === 0` is required: a site used every day is not
 *               a loop, it is a habit)
 * - ranking   — URLs visited on the most distinct days
 * - dormant   — keys that were frequent 2–4 months ago and are quiet now
 * - capsule   — the same local week one year (52 weeks) ago
 *
 * WHY: `now` is injected rather than read from the clock so a snapshot of
 * rows yields the same result on every call, and so tests can pin the week
 * boundary. `dayKey` buckets by LOCAL day while the recorder dedupes same-day
 * revisits by UTC day — the panel surfaces that mismatch as a note instead of
 * hiding it.
 */

import { DAY_MS, startOfLocalDay } from './components/periodFilter.js';
import {
  startOfLocalWeek,
  nextBucketStart,
  formatBucketDate,
} from './tagFrequencyTimeline.js';
import { parseTagsForDisplay } from '../utils/tagUtils.js';
import {
  sanitizeForMarkdownLinkText,
  sanitizeUrlForMarkdownTarget,
} from '../utils/markdownSanitizer.js';

export const REVISIT_CONFIG = {
  /** Covers the time-capsule week (364d + 7d) with margin. */
  fetchLookbackDays: 400,
  recentDays: 30,
  dormantFromDays: 90,
  loopMinRecentDays: 3,
  dormantWindowStartDays: 120,
  dormantWindowEndDays: 60,
  dormantMinCount: 3,
  /** 52 weeks: keeps the same weekday alignment. */
  capsuleOffsetDays: 364,
  capsuleTopN: 10,
  topN: 20,
  visitsPerItemMax: 10,
} as const;

export type RevisitConfig = typeof REVISIT_CONFIG;

export interface NameCount {
  name: string;
  count: number;
}

export interface RevisitInput {
  id: number;
  url: string;
  title?: string | null;
  domain?: string | null;
  tags?: string | null;
  created_at: number;
}

export type RevisitKeyKind = 'url' | 'domain' | 'tag';

export interface RevisitVisit {
  id: number;
  url: string;
  title: string | null;
  created_at: number;
}

export interface LoopItem {
  kind: RevisitKeyKind;
  key: string;
  recentDays: number;
  pastCount: number;
  visits: RevisitVisit[];
}

export interface RevisitRankItem {
  url: string;
  title: string | null;
  distinctDays: number;
  lastAt: number;
}

export interface DormantItem {
  kind: 'domain' | 'tag';
  key: string;
  windowCount: number;
  lastAt: number;
}

export interface TimeCapsule {
  rangeStart: number;
  rangeEnd: number;
  topTags: NameCount[];
  topDomains: NameCount[];
  visits: RevisitVisit[];
}

export interface RevisitInsights {
  loops: LoopItem[];
  ranking: RevisitRankItem[];
  dormant: DormantItem[];
  capsule: TimeCapsule;
}

/** Sort rank for a key kind; lower sorts first. */
const KIND_ORDER: Readonly<Record<RevisitKeyKind, number>> = {
  domain: 0,
  tag: 1,
  url: 2,
};

/** Keys are namespaced by kind so 'a.dev' as a domain cannot collide with a tag of the same name. */
function namespacedKey(kind: RevisitKeyKind, key: string): string {
  return `${kind}\u0000${key}`;
}

function dayKey(ts: number): string {
  return formatBucketDate(startOfLocalDay(ts));
}

interface KeyBucket {
  kind: RevisitKeyKind;
  key: string;
  rows: RevisitInput[];
}

interface LoopStats {
  recentDays: Set<string>;
  middleCount: number;
  pastCount: number;
}

function compareStrings(a: string, b: string): number {
  // WHY: code-unit comparison, not localeCompare — the order must not shift
  // with the browser's locale, or a sorted table re-orders itself for the user.
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function toVisit(row: RevisitInput): RevisitVisit {
  return { id: row.id, url: row.url, title: row.title ?? null, created_at: row.created_at };
}

function newestFirst(a: RevisitInput, b: RevisitInput): number {
  if (a.created_at !== b.created_at) return b.created_at - a.created_at;
  return b.id - a.id;
}

function countNames(names: readonly string[]): NameCount[] {
  const counts = new Map<string, number>();
  for (const name of names) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const list: NameCount[] = [];
  for (const [name, count] of counts) list.push({ name, count });
  list.sort((a, b) => (b.count !== a.count ? b.count - a.count : compareStrings(a.name, b.name)));
  return list;
}

export function aggregateRevisitInsights(
  rows: readonly RevisitInput[],
  now: number,
  config: RevisitConfig = REVISIT_CONFIG,
): RevisitInsights {
  const recentStart = now - config.recentDays * DAY_MS;
  const dormantBoundary = now - config.dormantFromDays * DAY_MS;
  const dormantWindowStart = now - config.dormantWindowStartDays * DAY_MS;
  const dormantWindowEnd = now - config.dormantWindowEndDays * DAY_MS;
  const rangeStart = startOfLocalWeek(now - config.capsuleOffsetDays * DAY_MS);
  const rangeEnd = nextBucketStart(rangeStart, 'week');

  const buckets = new Map<string, KeyBucket>();
  const urlDays = new Map<string, { days: Set<string>; lastAt: number; lastTitle: string | null }>();

  function bucketFor(kind: RevisitKeyKind, key: string): KeyBucket {
    const id = namespacedKey(kind, key);
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = { kind, key, rows: [] };
      buckets.set(id, bucket);
    }
    return bucket;
  }

  for (const row of rows) {
    if (typeof row.url === 'string' && row.url.length > 0) {
      bucketFor('url', row.url).rows.push(row);

      let stat = urlDays.get(row.url);
      if (!stat) {
        stat = { days: new Set<string>(), lastAt: 0, lastTitle: null };
        urlDays.set(row.url, stat);
      }
      stat.days.add(dayKey(row.created_at));
      if (row.created_at >= stat.lastAt) {
        stat.lastAt = row.created_at;
        stat.lastTitle = row.title ?? null;
      }
    }

    const domain = row.domain?.trim().toLowerCase() ?? '';
    if (domain.length > 0) {
      bucketFor('domain', domain).rows.push(row);
    }

    for (const tag of parseTagsForDisplay(row.tags)) {
      bucketFor('tag', tag).rows.push(row);
    }
  }

  // ── loops ────────────────────────────────────────────────────────────────
  const loops: LoopItem[] = [];
  for (const bucket of buckets.values()) {
    const stats: LoopStats = { recentDays: new Set<string>(), middleCount: 0, pastCount: 0 };
    for (const row of bucket.rows) {
      if (row.created_at >= recentStart) {
        stats.recentDays.add(dayKey(row.created_at));
      } else if (row.created_at >= dormantBoundary) {
        stats.middleCount += 1;
      } else {
        stats.pastCount += 1;
      }
    }
    const recentDays = stats.recentDays.size;
    // WHY: a key that kept showing up in the middle window was never dormant,
    // so it is a habit rather than a "picked back up after a gap" loop. URL
    // keys get a lower bar because a single deep page is a real re-research,
    // while a domain needs repeated distinct days to be a theme.
    const qualifies =
      bucket.kind === 'url'
        ? recentDays >= 1 && stats.pastCount >= 1 && stats.middleCount === 0
        : recentDays >= config.loopMinRecentDays && stats.pastCount >= 1 && stats.middleCount === 0;
    if (!qualifies) continue;

    const sorted = [...bucket.rows].sort(newestFirst);
    loops.push({
      kind: bucket.kind,
      key: bucket.key,
      recentDays,
      pastCount: stats.pastCount,
      visits: sorted.slice(0, config.visitsPerItemMax).map(toVisit),
    });
  }
  loops.sort((a, b) => {
    if (a.recentDays !== b.recentDays) return b.recentDays - a.recentDays;
    if (a.pastCount !== b.pastCount) return b.pastCount - a.pastCount;
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return compareStrings(a.key, b.key);
  });

  // ── ranking ──────────────────────────────────────────────────────────────
  const ranking: RevisitRankItem[] = [];
  for (const [url, stat] of urlDays) {
    if (stat.days.size < 2) continue;
    ranking.push({ url, title: stat.lastTitle, distinctDays: stat.days.size, lastAt: stat.lastAt });
  }
  ranking.sort((a, b) => {
    if (a.distinctDays !== b.distinctDays) return b.distinctDays - a.distinctDays;
    if (a.lastAt !== b.lastAt) return b.lastAt - a.lastAt;
    return compareStrings(a.url, b.url);
  });

  // ── dormant ──────────────────────────────────────────────────────────────
  const dormant: DormantItem[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.kind === 'url') continue;
    let windowCount = 0;
    let lastAt = 0;
    let touchedRecently = false;
    for (const row of bucket.rows) {
      if (row.created_at >= recentStart) touchedRecently = true;
      if (row.created_at >= dormantWindowStart && row.created_at < dormantWindowEnd) windowCount += 1;
      if (row.created_at > lastAt) lastAt = row.created_at;
    }
    // WHY: a key with any recent row is not dormant even if the window was
    // busy — "frequent then quiet" requires the quiet to be current.
    if (touchedRecently || windowCount < config.dormantMinCount) continue;
    dormant.push({
      kind: bucket.kind,
      key: bucket.key,
      windowCount,
      lastAt,
    });
  }
  dormant.sort((a, b) => {
    if (a.windowCount !== b.windowCount) return b.windowCount - a.windowCount;
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return compareStrings(a.key, b.key);
  });

  // ── capsule ──────────────────────────────────────────────────────────────
  const capsuleRows: RevisitInput[] = [];
  const capsuleTags: string[] = [];
  const capsuleDomains: string[] = [];
  for (const row of rows) {
    if (row.created_at < rangeStart || row.created_at >= rangeEnd) continue;
    capsuleRows.push(row);
    for (const tag of parseTagsForDisplay(row.tags)) capsuleTags.push(tag);
    const domain = row.domain?.trim().toLowerCase() ?? '';
    if (domain.length > 0) capsuleDomains.push(domain);
  }
  capsuleRows.sort(newestFirst);

  return {
    loops: loops.slice(0, config.topN),
    ranking: ranking.slice(0, config.topN),
    dormant: dormant.slice(0, config.topN),
    capsule: {
      rangeStart,
      rangeEnd,
      topTags: countNames(capsuleTags).slice(0, config.capsuleTopN),
      topDomains: countNames(capsuleDomains).slice(0, config.capsuleTopN),
      visits: capsuleRows.slice(0, config.capsuleTopN).map(toVisit),
    },
  };
}

/**
 * Renders a loop item's visits as a Markdown section, ready to paste into a
 * note. Link text and target are sanitized separately: a title containing
 * `[]()` must not break out of the link syntax, and a non-http(s) URL must
 * never become a live link (a recorded row is data, not a trusted target).
 */
export function formatLoopVisitsMarkdown(item: LoopItem): string {
  const lines: string[] = [`## ${sanitizeForMarkdownLinkText(item.key)}`, ''];
  for (const visit of item.visits) {
    const date = formatBucketDate(startOfLocalDay(visit.created_at));
    const label = sanitizeForMarkdownLinkText(visit.title || visit.url);
    const target = sanitizeUrlForMarkdownTarget(visit.url);
    lines.push(`- ${date} [${label}](${target})`);
  }
  return `${lines.join('\n')}\n`;
}
