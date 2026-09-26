/**
 * sessionPathAggregate.ts
 * Navigation-path recovery for the Research Sessions panel (PBI 2026-09-26-04).
 *
 * Pure aggregation: from the opt-in trail columns (PBI 2026-09-26-03) it
 * rebuilds which page led to which inside a session, and which tags take the
 * most pages to settle. The recording path is untouched — everything here
 * reads rows that already exist.
 *
 * WHY a parent is "the most recent earlier record in the same session with a
 * matching referrer": the referrer column stores a URL, not an id, so the tree
 * can only be recovered by matching URLs. Preferring the most recent match is
 * what makes a repeat visit hang off its latest predecessor rather than its
 * first.
 *
 * WHY the last record counts as the resolution: a session is one burst of
 * activity, so its final page is where the burst ended. This is a heuristic,
 * not a measurement of "understanding" — the guide says so.
 */

import { normalizeNavUrl } from '../utils/navUrl.js';
import { parseTagsForDisplay } from '../utils/tagUtils.js';
import {
  sessionDurationMinutes,
  type ResearchSession,
  type SessionInput,
} from './researchSessionAggregate.js';

export interface SessionTreeNode {
  record: SessionInput;
  children: SessionTreeNode[];
}

export interface SearchToGoalRow {
  tag: string;
  sessions: number;
  avgPages: number;
  avgMinutes: number;
}

/** One session is an anecdote; two is a pattern worth naming. */
export const SEARCH_TO_GOAL_MIN_SESSIONS = 2;

/** Bucket for sessions whose last page carries no tag. */
export const UNTAGGED_KEY = '';

export function hasNavTrail(session: ResearchSession): boolean {
  return session.records.some(
    (record) => typeof record.nav_source_url === 'string' && record.nav_source_url.length > 0,
  );
}

export function buildSessionTree(session: ResearchSession): SessionTreeNode[] {
  const roots: SessionTreeNode[] = [];
  // Latest node per normalized URL, so a repeat visit parents onto its most
  // recent predecessor rather than its first.
  const lastNodeByUrl = new Map<string, SessionTreeNode>();

  for (const record of session.records) {
    const node: SessionTreeNode = { record, children: [] };

    const source = record.nav_source_url ? normalizeNavUrl(record.nav_source_url) : null;
    const parent = source !== null ? lastNodeByUrl.get(source) : undefined;
    if (parent !== undefined) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }

    const self = normalizeNavUrl(record.url);
    if (self !== null) {
      lastNodeByUrl.set(self, node);
    }
  }

  return roots;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function computeSearchToGoal(
  sessions: readonly ResearchSession[],
): SearchToGoalRow[] {
  interface Accumulator {
    sessions: number;
    pagesSum: number;
    minutesSum: number;
  }
  const byTag = new Map<string, Accumulator>();

  for (const session of sessions) {
    const first = session.records[0];
    // Only a session that began at a search engine has a "search → goal" shape.
    if (!first || !first.search_query) {
      continue;
    }
    const last = session.records[session.records.length - 1]!;
    const pages = session.records.length;
    const minutes = sessionDurationMinutes(session.durationMs);

    const tags = parseTagsForDisplay(last.tags);
    // A multi-tagged resolution page credits the session to each of its tags;
    // an untagged one needs its own bucket rather than being dropped.
    const keys = tags.length > 0 ? tags : [UNTAGGED_KEY];

    for (const tag of keys) {
      const acc = byTag.get(tag) ?? { sessions: 0, pagesSum: 0, minutesSum: 0 };
      acc.sessions += 1;
      acc.pagesSum += pages;
      acc.minutesSum += minutes;
      byTag.set(tag, acc);
    }
  }

  const rows: SearchToGoalRow[] = [];
  for (const [tag, acc] of byTag) {
    if (acc.sessions < SEARCH_TO_GOAL_MIN_SESSIONS) {
      continue;
    }
    rows.push({
      tag,
      sessions: acc.sessions,
      avgPages: Math.round((acc.pagesSum / acc.sessions) * 10) / 10,
      avgMinutes: Math.round(acc.minutesSum / acc.sessions),
    });
  }

  rows.sort((a, b) => {
    if (a.avgPages !== b.avgPages) return b.avgPages - a.avgPages;
    if (a.sessions !== b.sessions) return b.sessions - a.sessions;
    return compareStrings(a.tag, b.tag);
  });

  return rows;
}
