// @layer 1 — Settings validation (no background imports)
/**
 * autoTagRules.ts
 *
 * Auto-tag rules for saved collections (PBI 2026-10-23-06, BDD scenario 2):
 * a named rule (conditions → tag) applied to every saved record whose URL or
 * title matches. Kept in this module (not the repository chain) so the
 * recording pipeline can match without pulling storage, mirroring
 * savedCollections.ts.
 *
 * Rule semantics (pinned by tests):
 * - ALL specified conditions must match (AND). A rule with no conditions is
 *   invalid — a match-everything rule is a footgun, so it fails closed.
 * - Every enabled matching rule applies (not first-match); output is ordered
 *   by priority ascending, ties broken by rule id, so multi-rule output is
 *   deterministic.
 * - The tag rides the same normalization dictionary as AI tags, so a rule
 *   tag and an AI tag for the same concept fold to one entry.
 *
 * 縮退の出口: unknown input fails closed to null; a rule that cannot match
 * anything valid never fires.
 */

export interface AutoTagRule {
  id: string;
  name: string;
  /** Host suffix match, e.g. "example.com" (leading dot optional). */
  domainSuffix?: string;
  /** Case-insensitive URL substring. */
  urlContains?: string;
  /** Case-insensitive title substring. */
  titleContains?: string;
  /** Single tag (no `#`, no whitespace — the `#tag1 #tag2` CSV shape). */
  tag: string;
  /** Lower applies first; ties break by rule id. */
  priority: number;
  enabled: boolean;
}

/** Provenance for the rule undo: which rule tagged which record URL, when. */
export interface AutoTagApplication {
  ruleId: string;
  tag: string;
  url: string;
  at: number;
}

/** The application log is a bounded ring — history, not an audit trail. */
export const AUTO_TAG_APPLICATIONS_CAP = 200;

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Normalize one stored rule; unknown input falls back to null. */
export function normalizeAutoTagRule(id: unknown, raw: unknown): AutoTagRule | null {
  if (typeof id !== 'string' || id.trim() === '') return null;
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const name = asNonEmptyString(record['name']);
  if (name === null) return null;
  const tag = asNonEmptyString(record['tag']);
  // A tag is one CSV cell: no `#` marker, no whitespace.
  if (tag === null || tag.includes('#') || /\s/.test(tag)) return null;
  const domainSuffix = asNonEmptyString(record['domainSuffix'])?.toLowerCase().replace(/^\.+/, '') ?? undefined;
  const urlContains = asNonEmptyString(record['urlContains']) ?? undefined;
  const titleContains = asNonEmptyString(record['titleContains']) ?? undefined;
  // Fail closed: a rule with nothing to match on would tag everything.
  if (domainSuffix === undefined && urlContains === undefined && titleContains === undefined) return null;
  const priority = asFiniteNumber(record['priority']) ?? 100;
  const enabled = typeof record['enabled'] === 'boolean' ? record['enabled'] : true;
  return {
    id,
    name,
    tag,
    priority,
    enabled,
    ...(domainSuffix !== undefined ? { domainSuffix } : {}),
    ...(urlContains !== undefined ? { urlContains } : {}),
    ...(titleContains !== undefined ? { titleContains } : {}),
  };
}

/** Normalize a stored map; corrupted entries are dropped from the result. */
export function normalizeAutoTagRules(raw: unknown): Record<string, AutoTagRule> {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Record<string, AutoTagRule> = {};
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    const normalized = normalizeAutoTagRule(id, entry);
    if (normalized !== null) out[id] = normalized;
  }
  return out;
}

/** Pure upsert: insert-or-replace one rule on the map. */
export function upsertAutoTagRule(
  map: Record<string, AutoTagRule>,
  rule: AutoTagRule,
): Record<string, AutoTagRule> {
  return { ...map, [rule.id]: rule };
}

/** Pure remove: drop one rule from the map (missing id is a no-op). */
export function removeAutoTagRule(
  map: Record<string, AutoTagRule>,
  id: string,
): Record<string, AutoTagRule> {
  return Object.fromEntries(Object.entries(map).filter(([key]) => key !== id));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** True when every specified condition matches (AND). */
export function ruleMatches(rule: Pick<AutoTagRule, 'domainSuffix' | 'urlContains' | 'titleContains'>, url: string, title: string): boolean {
  if (rule.domainSuffix !== undefined) {
    const host = hostOf(url);
    if (host !== rule.domainSuffix && !host.endsWith(`.${rule.domainSuffix}`)) return false;
  }
  if (rule.urlContains !== undefined && !url.toLowerCase().includes(rule.urlContains.toLowerCase())) return false;
  if (rule.titleContains !== undefined && !title.toLowerCase().includes(rule.titleContains.toLowerCase())) return false;
  return true;
}

export interface AutoTagMatch {
  tag: string;
  ruleId: string;
}

/**
 * All enabled rules matching the record, ordered by priority ascending with
 * rule-id tiebreak. Deterministic across runs for the same rule set.
 */
export function matchAutoTagRules(
  url: string,
  title: string,
  rules: Record<string, AutoTagRule>,
): AutoTagMatch[] {
  return Object.values(rules)
    .filter((rule) => rule.enabled && ruleMatches(rule, url, title))
    .sort((a, b) => (a.priority === b.priority ? (a.id < b.id ? -1 : 1) : a.priority - b.priority))
    .map((rule) => ({ tag: rule.tag, ruleId: rule.id }));
}

/**
 * Merge rule tags after the AI tags, dropping case-insensitive duplicates so
 * a rule and the AI never double-tag the same concept.
 */
export function mergeRuleTags(existing: string[] | undefined, matches: AutoTagMatch[]): string[] | undefined {
  if (matches.length === 0) return existing;
  const seen = new Set((existing ?? []).map((t) => t.toLowerCase()));
  const merged = [...(existing ?? [])];
  for (const match of matches) {
    if (!seen.has(match.tag.toLowerCase())) {
      seen.add(match.tag.toLowerCase());
      merged.push(match.tag);
    }
  }
  return merged;
}

/** Normalize one stored application-log entry; unknown input is null. */
export function normalizeAutoTagApplication(raw: unknown): AutoTagApplication | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const ruleId = asNonEmptyString(record['ruleId']);
  const tag = asNonEmptyString(record['tag']);
  const url = asNonEmptyString(record['url']);
  const at = asFiniteNumber(record['at']);
  if (ruleId === null || tag === null || url === null || at === null) return null;
  return { ruleId, tag, url, at };
}

/** Pure log append with a cap: oldest entries fall off, newest survive. */
export function appendAutoTagApplications(
  log: AutoTagApplication[],
  entries: AutoTagApplication[],
): AutoTagApplication[] {
  if (entries.length === 0) return log;
  return [...log, ...entries].slice(-AUTO_TAG_APPLICATIONS_CAP);
}
