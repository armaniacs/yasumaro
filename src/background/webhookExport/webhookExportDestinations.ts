/**
 * webhookExportDestinations.ts (PBI 2026-10-31-12, narrowed PBI 2026-11-24-18)
 *
 * The webhook-specific destination allowlist and the SINGLE judgment source
 * shared by the save-time pre-flight (webhookExportSettings.ts) and the
 * send-time gate (webhookExportSender.ts defaultIsWebhookHostPermitted).
 *
 * 判定条件の明文化 (PBI AC): the save judgment and the send judgment are the
 * same function — https (isWebhookUrlAllowed) ∩
 * WEBHOOK_EXPORT_DESTINATION_PATTERNS. A save-permitted destination can never
 * diverge from the send verdict because there is only one verdict function
 * (pinned by webhookExportDestinations.test.ts).
 *
 * Kept set (PBI 2026-11-24-18, owner裁定 run-3 NV-1): 16 loopback patterns —
 * 8 https loopback (functional webhook hosts) + 8 http loopback (DEAD entries
 * at the send gate, kept for the save-time grandfather clause). Removed: 14
 * AI-provider patterns (including the *.openai.com wildcard) and 1 Gist
 * egress (api.github.com). WHY: the audit flagged third-party endpoints as a
 * webhook egress path; AI providers and api.github.com are not
 * webhook-dedicated hosts. Gist sync keeps its own egress path
 * (GIST_EGRESS_HOST_PERMISSIONS, declared mandatorily in the manifest) and a
 * generic webhook POST to api.github.com is not a supported webhook use, so
 * Gist does not stay in this list.
 *
 * The set is a DELIBERATE snapshot, not a derivation from the manifest SSOT:
 * the manifest still declares AI-provider and Gist hosts for their own
 * features, and a derivation would let a manifest addition for another
 * feature widen the webhook allowlist automatically (PBI AC). The pin test
 * no longer asserts equality with the declared manifest host_permissions —
 * the divergence is intentional — so:
 *   - a manifest addition for ANOTHER feature does not widen the webhook
 *     allowlist (the pin fails on any unreviewed list change instead);
 *   - a manifest removal does not invalidate already-saved webhook
 *     destinations — the loopback grandfather clause is carried by this
 *     list, never by the live manifest.
 *
 * The 8 http loopback entries are DEAD entries at the send gate: the https
 * requirement (isWebhookUrlAllowed) always rejects them. They stay in the
 * list because the save-time grandfather clause (an unchanged stored http
 * loopback destination is preserved, not rejected) reads this list.
 *
 * Grandfather policy (silent-disable-free): already-saved AI-provider / Gist
 * destinations are NOT wiped, migrated, or disabled silently. They stay in
 * storage as-is; the next save with the same URL is rejected
 * (destination-not-in-allowlist) and the send gate blocks the egress, so the
 * user sees the reason and picks a loopback destination. No storage-schema
 * migration is needed.
 *
 * The matcher isUrlCoveredByHostPattern moved here from webhookExportSender.ts
 * (re-exported there for compatibility) so the judgment source has no import
 * cycle: settings → destinations → payload, sender → destinations.
 */

import { isWebhookUrlAllowed, webhookUrlOrigin } from './webhookExportPayload.js';
import { escapeRegExp } from '../../utils/string.js';

/**
 * The webhook-specific destination allowlist. Narrowed set (PBI
 * 2026-11-24-18) = 16 loopback patterns only: 8 https functional + 8 http
 * dead grandfather entries. Update this list ONLY deliberately, together
 * with the pin in webhookExportDestinations.test.ts.
 */
export const WEBHOOK_EXPORT_DESTINATION_PATTERNS: readonly string[] = [
  // 8 http loopback (grandfathered; always rejected by the send gate's https
  // requirement — dead entries, kept for the save-time grandfather clause).
  'http://127.0.0.1:27123/*',
  'http://127.0.0.1:27124/*',
  'http://127.0.0.1:11434/*',
  'http://127.0.0.1:1234/*',
  'http://localhost:27123/*',
  'http://localhost:27124/*',
  'http://localhost:11434/*',
  'http://localhost:1234/*',
  // 8 https loopback (the only functional webhook hosts)
  'https://127.0.0.1:27123/*',
  'https://127.0.0.1:27124/*',
  'https://127.0.0.1:11434/*',
  'https://127.0.0.1:1234/*',
  'https://localhost:27123/*',
  'https://localhost:27124/*',
  'https://localhost:11434/*',
  'https://localhost:1234/*',
];

/** Machine-readable save/send verdict reasons; user text resolves at the UI. */
export type WebhookDestinationReason =
  | 'permitted'
  | 'non-https-or-empty-destination'
  | 'destination-not-in-allowlist';

/** The destination verdict. Origin only — the full URL (possibly token-bearing) never surfaces in UI. */
export interface WebhookDestinationVerdict {
  permitted: boolean;
  reason: WebhookDestinationReason;
  origin: string;
}

/**
 * Match-pattern check for one allowlist entry. Implements the Chrome
 * match-pattern semantics the declared entries use: `<all_urls>` (match-pattern
 * schemes only, noted inline), a `*` scheme (http|https only), a `*` /
 * `*.host` / exact host, and a path glob — with one fail-closed path
 * deviation noted inline. An exact host that carries an explicit port (the
 * declared loopback entries) matches the URL's host+port; a portless host
 * keeps the portless hostname comparison (any port matches), and the `*` /
 * `*.host` wildcard branches are NOT widened to port matching.
 */
export function isUrlCoveredByHostPattern(url: string, pattern: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const protocol = parsed.protocol.replace(/:$/, '');
  if (pattern === '<all_urls>') {
    // Chrome's <all_urls> covers the match-pattern schemes only, so a
    // chrome-internal, data, or unknown scheme never passes an all-urls
    // declaration.
    return ['http', 'https', 'file', 'ftp', 'ws', 'wss'].includes(protocol);
  }
  const schemeSeparator = pattern.indexOf('://');
  if (schemeSeparator < 0) return false;
  const scheme = pattern.slice(0, schemeSeparator);
  const rest = pattern.slice(schemeSeparator + 3);
  const slash = rest.indexOf('/');
  const host = slash < 0 ? rest : rest.slice(0, slash);
  const pathGlob = slash < 0 ? '/' : rest.slice(slash);
  if (scheme === '*') {
    // In Chrome match patterns a `*` scheme matches http and https only.
    if (protocol !== 'http' && protocol !== 'https') return false;
  } else if (scheme !== protocol) {
    return false;
  }
  const hostname = parsed.hostname;
  // PBI 2026-10-31-10: a pattern host that carries an explicit port (the
  // declared loopback entries, e.g. 127.0.0.1:27123) is compared against the
  // URL's host+port — parsed.host keeps an explicit port and drops the
  // scheme default. A portless pattern keeps the hostname comparison (any
  // port matches), and the `*` / `*.host` wildcard branches below are NOT
  // widened to port matching. The lastIndexOf guard keeps a portless IPv6
  // pattern host (`[::1]`) on the hostname path.
  const patternHostHasPort = host.lastIndexOf(':') > host.lastIndexOf(']');
  const urlHost = patternHostHasPort ? parsed.host : hostname;
  if (host === '*') {
    // Any host.
  } else if (host.startsWith('*.')) {
    const base = host.slice(2);
    if (hostname !== base && !hostname.endsWith(`.${base}`)) return false;
  } else if (host !== urlHost) {
    return false;
  }
  const path = `${parsed.pathname}${parsed.search}`;
  // Path glob: each `*` matches any run of characters (ReDoS-safe: the
  // pattern comes from the extension's own allowlist, not user input).
  // Deviation from Chrome, kept deliberately fail-closed: Chrome mandates a
  // path segment in every pattern and would reject a pathless one at
  // install; this matcher treats a pathless pattern as `/` (root only), so
  // it never widens a match beyond what Chrome would grant.
  const regex = new RegExp(`^${pathGlob.split('*').map(escapeRegExp).join('.*')}$`);
  return regex.test(path);
}

/**
 * The allowlist check alone (no https requirement). The save-time grandfather
 * clause reads this: an unchanged stored destination the initial list covers
 * is preserved, not rejected.
 */
export function isWebhookDestinationInAllowlist(
  url: string,
  patterns: readonly string[] = WEBHOOK_EXPORT_DESTINATION_PATTERNS,
): boolean {
  return patterns.some((pattern) => isUrlCoveredByHostPattern(url, pattern));
}

/**
 * THE single judgment source (PBI 2026-10-31-12): https ∩ allowlist. Both the
 * save-time pre-flight (webhookExportSettings.ts saveWebhookExportSettings)
 * and the send-time gate (webhookExportSender.ts defaultIsWebhookHostPermitted)
 * call this function, so the save display can never claim a permission the
 * send gate does not grant. Fail closed: an unparseable or empty destination
 * is non-permitted with the https reason.
 */
export function judgeWebhookDestination(url: string): WebhookDestinationVerdict {
  const origin: string = webhookUrlOrigin(url) ?? '';
  if (!isWebhookUrlAllowed(url)) {
    return { permitted: false, reason: 'non-https-or-empty-destination', origin };
  }
  if (!isWebhookDestinationInAllowlist(url)) {
    return { permitted: false, reason: 'destination-not-in-allowlist', origin };
  }
  return { permitted: true, reason: 'permitted', origin };
}
