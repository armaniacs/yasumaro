/**
 * webhookExportPayload.ts
 *
 * Minimal webhook export payload builder (PBI 2026-10-22-05).
 * 外部連携: a user-configured webhook receives マスク済みタイトル・マスク済み
 * 要約・タグ・URL only. The payload carries no raw page content — PII
 * マスキングを送信前に適用する: the sender passes the title and the summary
 * through the same maskText seam immediately before building, so nothing
 * raw ever reaches this builder.
 *
 * 縮退の出口: unknown shapes fail closed — an https-less or empty
 * destination URL is never allowed, an empty record builds nothing.
 * Minimal scope: no bidirectional sync, no BI direct connection.
 */

/** The persisted record fields the payload and conditions read. */
export interface WebhookExportRecord {
  id: string;
  /** Page title. The sender masks this via the maskText seam before building. */
  title: string;
  url: string;
  /** Persisted post-cleansing summary (never raw page content). */
  summary?: string | undefined;
  /** Persisted tags (CSV string or list, stored shape may vary). */
  tags?: string | string[] | undefined;
}

/** Transfer conditions: tag and/or a minimum engagement threshold. */
export interface WebhookExportCondition {
  /** A record must carry this tag (the leading # is stripped). */
  tag?: string | undefined;
  /** Minimum scroll-depth percent (0-100) the record must have reached. */
  minScrollDepth?: number | undefined;
  /** Minimum stay seconds the record must have reached. */
  minVisitDuration?: number | undefined;
}

/** The minimal webhook body: masked title + masked summary + tags + URL. */
export interface WebhookExportPayload {
  text: string;
  title: string;
  url: string;
  summary?: string | undefined;
  tags?: string[] | undefined;
}

/** Normalizes the stored tags shape into a list (unknown shapes fail closed). */
export function normalizeWebhookExportTags(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim());
  }
  if (typeof raw === 'string') {
    return raw.split(',').map((t) => t.trim()).filter((t) => t !== '');
  }
  return [];
}

/**
 * Transfer-condition match (転送条件). Unknown inputs fail closed: an absent
 * record field never matches a set condition.
 */
export function matchesWebhookExportCondition(
  record: WebhookExportRecord,
  condition: WebhookExportCondition,
  engagement?: { scrollDepth?: number | undefined; visitDuration?: number | undefined },
): boolean {
  if (condition.tag !== undefined) {
    const wanted = condition.tag.replace(/^#/, '').trim();
    const tags = normalizeWebhookExportTags(record.tags);
    if (wanted === '' || !tags.includes(wanted)) return false;
  }
  if (condition.minScrollDepth !== undefined) {
    if (engagement?.scrollDepth === undefined || engagement.scrollDepth < condition.minScrollDepth) return false;
  }
  if (condition.minVisitDuration !== undefined) {
    if (engagement?.visitDuration === undefined || engagement.visitDuration < condition.minVisitDuration) return false;
  }
  return true;
}

/**
 * The destination gate (縮退の出口): https only, fail-closed on anything else.
 * The origin-permission check (未宣言originは遮断) rides the manifest's
 * DECLARED host_permissions in the send path
 * (defaultIsWebhookHostPermitted → chrome.runtime.getManifest()); this pure
 * gate never allows a non-https or empty destination.
 */
export function isWebhookUrlAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname !== '';
  } catch {
    return false;
  }
}

/** The webhook origin (host + port) the permission grant covers. */
export function webhookUrlOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Builds the minimal webhook body. 縮退の出口: an empty record builds
 * nothing. The caller supplies already-masked fields — the title and the
 * summary ride the sender's maskText seam before this builder runs; the
 * builder never masks itself.
 */
export function buildWebhookExportPayload(record: WebhookExportRecord): WebhookExportPayload | null {
  if (record.url.trim() === '') return null;
  const tags = normalizeWebhookExportTags(record.tags);
  const summary = typeof record.summary === 'string' && record.summary.trim() !== '' ? record.summary.trim() : undefined;
  const lines = [record.title || record.url, record.url];
  if (summary !== undefined) lines.push(summary);
  if (tags.length > 0) lines.push(tags.map((t) => `#${t}`).join(' '));
  return {
    text: lines.join('\n'),
    title: record.title,
    url: record.url,
    summary,
    tags: tags.length > 0 ? tags : undefined,
  };
}
