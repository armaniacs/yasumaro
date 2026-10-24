/**
 * savedCollectionQuery.ts
 *
 * Pure condition-shape logic for named saved collections (PBI 2026-10-23-06).
 * The panel stores exactly what its own state can hold: the search term, the
 * active tag filter and the selected day (a custom range select is ephemeral
 * and never lands in state, so it is not capturable). Kept free of DOM and
 * chrome imports so the serialize/parse pair is unit-testable without jsdom.
 *
 * 縮退の出口: an unknown stored shape fails closed to the empty condition, so
 * a corrupted query degrades to "no conditions" instead of poisoning recall.
 */

/** The condition fields a saved collection can carry (what panel state holds). */
export interface SavedCollectionQueryShape {
  search: string;
  tag: string | null;
  date: string | null;
}

/** Inputs the panel owns; kept structural so this module never imports the model. */
export interface CollectionQueryInput {
  searchQuery: string;
  activeTagFilter: string | null;
  selectedDate: string | null;
}

/** Serialize the panel's current conditions into the stored query record. */
export function serializeCollectionQuery(input: CollectionQueryInput): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  const search = input.searchQuery.trim();
  if (search !== '') query['search'] = search;
  const tag = input.activeTagFilter;
  if (tag !== null && tag.trim() !== '') query['tag'] = tag.trim();
  const date = input.selectedDate;
  if (date !== null && date.trim() !== '') query['date'] = date.trim();
  return query;
}

/** True when the record carries at least one condition (empty save fails closed). */
export function hasCollectionCondition(query: Record<string, unknown>): boolean {
  return Object.keys(query).length > 0;
}

/** Defensive parse: an unknown stored shape fails closed to the empty condition. */
export function parseCollectionQuery(raw: unknown): SavedCollectionQueryShape {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const str = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  return {
    search: str(record['search']) ?? '',
    tag: str(record['tag']),
    date: str(record['date']),
  };
}

/** Labels for the human-readable summary; injected so this module stays chrome-free. */
export interface CollectionQueryLabels {
  search: string;
  tag: string;
  date: string;
}

/** Human-readable condition summary for a list row; '' when no condition parsed. */
export function describeCollectionQuery(raw: unknown, labels: CollectionQueryLabels): string {
  const parsed = parseCollectionQuery(raw);
  const parts: string[] = [];
  if (parsed.search !== '') parts.push(`${labels.search}: ${parsed.search}`);
  if (parsed.tag !== null) parts.push(`${labels.tag}: ${parsed.tag}`);
  if (parsed.date !== null) parts.push(`${labels.date}: ${parsed.date}`);
  return parts.join(' / ');
}

/**
 * Collision-safe id for a new collection. crypto.randomUUID is the primary
 * path (secure contexts); the fallback never throws and keeps a timestamp
 * component so two calls in the same millisecond still differ.
 */
export function newCollectionId(now: number = Date.now()): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the deterministic fallback.
  }
  const rand = Math.floor(Math.random() * 0x10000).toString(36);
  return `col-${now.toString(36)}-${rand}`;
}
