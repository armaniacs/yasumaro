/**
 * sessionTimelinePanel.ts
 *
 * Session-restoration playback view (PBI 2026-10-22-04, box (a)).
 * Turns stored rows into a playable trail: private判定 rows are dropped
 * here (the aggregate module never re-admits them; this panel is the
 * caller-side filter the aggregate contract requires), the survivors are
 * mapped to SessionTimelineRecords, and the render reaches both the
 * original record (via the onOpenRecord hook, wired by the registry owner
 * to the history panel) and the original URL (via a real anchor).
 *
 * MV3 CSP: values go in through textContent / setAttribute. innerHTML is
 * never used. Non-http(s) URLs render as plain text, never as anchors.
 */

import {
  buildReminderCandidates,
  buildSessionTimelines,
  type ReminderCandidate,
  type SessionTimeline,
  type SessionTimelineRecord,
} from './sessionTimelineAggregate.js';
import type { BrowsingLogEntry } from '../utils/sqlite-types.js';
import { isSecureUrl } from '../utils/urlUtils.js';

/** Rows the playback must never show (PBI contract: caller-side exclusion). */
export function isPlaybackExcluded(entry: BrowsingLogEntry): boolean {
  return (entry.masked_count ?? 0) > 0;
}

/**
 * Null-safe row mapping. SQLite NULLs stay absent (undefined) so the
 * aggregate keeps its fail-closed behavior on missing scalars.
 */
export function toSessionTimelineRecord(entry: BrowsingLogEntry): SessionTimelineRecord {
  return {
    id: entry.id,
    title: entry.title ?? entry.url,
    url: entry.url,
    createdAt: entry.created_at,
    domain: entry.domain ?? '',
    ...(entry.visit_duration !== null && entry.visit_duration !== undefined
      ? { visitDuration: entry.visit_duration }
      : {}),
    ...(entry.scroll_ratio !== null && entry.scroll_ratio !== undefined
      ? { scrollRatio: entry.scroll_ratio }
      : {}),
    ...(entry.nav_source_url !== null && entry.nav_source_url !== undefined
      ? { navSourceUrl: entry.nav_source_url }
      : {}),
    ...(entry.search_query !== null && entry.search_query !== undefined
      ? { searchQuery: entry.search_query }
      : {}),
  };
}

/** The playable model: sessions plus the unread reminder candidates. */
export interface PlaybackModel {
  sessions: SessionTimeline[];
  candidates: ReminderCandidate[];
}

/** Builds the playable model from raw rows (exclusion + mapping + aggregate). */
export function buildPlaybackModel(entries: BrowsingLogEntry[]): PlaybackModel {
  const records = entries.filter((entry) => !isPlaybackExcluded(entry)).map(toSessionTimelineRecord);
  return {
    sessions: buildSessionTimelines(records),
    candidates: buildReminderCandidates(records),
  };
}

/** Owner-supplied wiring: opening the original stored record. */
export interface PlaybackHooks {
  onOpenRecord: (recordId: number) => void;
}

/** Display strings. Injectable so tests pin behavior without i18n. */
export interface PlaybackLabels {
  emptySessions: string;
  openRecord: string;
  fromSource: string;
  /**
   * Heading template with `{index}` / `{basis}` / `{count}` placeholders
   * (R-06 残: the fixed-English heading is i18n keyed; the substitution is
   * the pure helper below, so jsdom tests pin it without i18n).
   */
  sessionHeading: string;
  /** Localized labels for the two trail bases (the aggregate's raw names). */
  basisSearchQuery: string;
  basisNavSourceUrl: string;
}

const DEFAULT_LABELS: PlaybackLabels = {
  emptySessions: 'No sessions yet. Visit pages from one search or one link to build a trail.',
  openRecord: 'Open record',
  fromSource: 'From',
  sessionHeading: 'Session {index} ({basis}, {count} pages)',
  basisSearchQuery: 'search query',
  basisNavSourceUrl: 'link source',
};

/**
 * Pure placeholder substitution for the session heading (no i18n / DOM
 * dependency): every `{name}` in the template is replaced; unknown
 * placeholders stay verbatim so a locale's typo cannot crash the render.
 */
export function formatPlaybackHeading(
  template: string,
  parts: { index: number; basis: string; count: number },
): string {
  return template
    .replace(/\{index\}/g, String(parts.index))
    .replace(/\{basis\}/g, parts.basis)
    .replace(/\{count\}/g, String(parts.count));
}

/**
 * Renders the playback list into the owner-provided container. Every row
 * reaches the original URL (anchor, target _blank) and the original record
 * (button via onOpenRecord). An empty model renders the reason, never an
 * empty list.
 */
export function renderPlayback(
  container: HTMLElement,
  sessions: SessionTimeline[],
  hooks: PlaybackHooks,
  labels: PlaybackLabels = DEFAULT_LABELS,
): void {
  while (container.firstChild !== null) {
    container.removeChild(container.firstChild);
  }
  if (sessions.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'session-playback-empty';
    empty.textContent = labels.emptySessions;
    container.appendChild(empty);
    return;
  }
  const list = document.createElement('ol');
  list.className = 'session-playback-sessions';
  sessions.forEach((session, index) => {
    list.appendChild(renderSession(session, index, hooks, labels));
  });
  container.appendChild(list);
}

function renderSession(
  session: SessionTimeline,
  index: number,
  hooks: PlaybackHooks,
  labels: PlaybackLabels,
): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'session-playback-session';

  const heading = document.createElement('h3');
  heading.className = 'session-playback-heading';
  const basisLabel =
    session.basis === 'search_query' ? labels.basisSearchQuery : labels.basisNavSourceUrl;
  heading.textContent = formatPlaybackHeading(labels.sessionHeading, {
    index: index + 1,
    basis: basisLabel,
    count: session.records.length,
  });
  item.appendChild(heading);

  const trailKey = document.createElement('p');
  trailKey.className = 'session-playback-trail';
  trailKey.textContent = `${labels.fromSource}: ${session.key}`;
  item.appendChild(trailKey);

  const steps = document.createElement('ol');
  steps.className = 'session-playback-steps';
  for (const record of session.records) {
    steps.appendChild(renderStep(record, hooks, labels));
  }
  item.appendChild(steps);
  return item;
}

function renderStep(
  record: SessionTimelineRecord,
  hooks: PlaybackHooks,
  labels: PlaybackLabels,
): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'session-playback-step';

  const time = document.createElement('time');
  time.dateTime = new Date(record.createdAt).toISOString();
  time.textContent = new Date(record.createdAt).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  li.appendChild(time);

  if (isSecureUrl(record.url)) {
    const anchor = document.createElement('a');
    anchor.href = record.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = record.title;
    li.appendChild(anchor);
  } else {
    const span = document.createElement('span');
    span.textContent = record.title;
    li.appendChild(span);
  }

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'session-playback-open-record';
  openButton.dataset.recordId = String(record.id);
  openButton.setAttribute('aria-label', `${labels.openRecord}: ${record.title}`);
  openButton.textContent = labels.openRecord;
  openButton.addEventListener('click', () => hooks.onOpenRecord(record.id));
  li.appendChild(openButton);

  return li;
}
