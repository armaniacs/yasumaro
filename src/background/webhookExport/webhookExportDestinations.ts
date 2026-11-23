/**
 * webhookExportDestinations.ts (PBI 2026-10-31-12)
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
 * Initial set = the declared manifest origin set as of 2026-10-31 (31
 * patterns, dist/chromium-mv3/manifest.json measured): 8 http loopback + 8
 * https loopback + 14 AI-provider patterns (including the *.openai.com
 * wildcard) + 1 Gist egress (api.github.com). The set is a VERBATIM
 * snapshot, not a derivation from the manifest SSOT: a derivation would let
 * a manifest addition for another feature widen the webhook allowlist
 * automatically (PBI AC). The pin test compares the snapshot against the
 * declared manifest host_permissions, so:
 *   - a manifest addition for ANOTHER feature does not widen the webhook
 *     allowlist (the pin fails and forces a conscious list update);
 *   - a manifest removal does not invalidate already-saved webhook
 *     destinations — the grandfather clause (ユーザー裁定 2026-10-31: the
 *     existing loopback / AI-provider / Gist origins stay in the initial
 *     set) is carried by this list, never by the live manifest.
 *
 * The 8 http loopback entries are DEAD entries at the send gate: the https
 * requirement (isWebhookUrlAllowed) always rejects them. They stay in the
 * list because the pin source is the declared origin set and the
 * save-time grandfather clause (an unchanged stored http loopback
 * destination is preserved, not rejected) reads this list.
 *
 * The matcher isUrlCoveredByHostPattern moved here from webhookExportSender.ts
 * (re-exported there for compatibility) so the judgment source has no import
 * cycle: settings → destinations → payload, sender → destinations.
 */

import { isWebhookUrlAllowed, webhookUrlOrigin } from './webhookExportPayload.js';
import { escapeRegExp } from '../../utils/string.js';

/**
 * The webhook-specific destination allowlist. Initial set = the declared
 * manifest origin set (31 patterns) so existing destinations keep working
 * (現状動作の維持). Update this list ONLY deliberately, together with the
 * manifest pin in webhookExportDestinations.test.ts.
 */
export const WEBHOOK_EXPORT_DESTINATION_PATTERNS: readonly string[] = [
  // 8 http loopback (grandfathered; always rejected by the send gate's https
  // requirement — dead entries, kept for the origin-set pin and the
  // save-time grandfather clause).
  'http://127.0.0.1:27123/*',
  'http://127.0.0.1:27124/*',
  'http://127.0.0.1:11434/*',
  'http://127.0.0.1:1234/*',
  'http://localhost:27123/*',
  'http://localhost:27124/*',
  'http://localhost:11434/*',
  'http://localhost:1234/*',
  // 8 https loopback
  'https://127.0.0.1:27123/*',
  'https://127.0.0.1:27124/*',
  'https://127.0.0.1:11434/*',
  'https://127.0.0.1:1234/*',
  'https://localhost:27123/*',
  'https://localhost:27124/*',
  'https://localhost:11434/*',
  'https://localhost:1234/*',
  // 14 AI-provider patterns (manifest host_permissions order)
  'https://generativelanguage.googleapis.com/*',
  'https://api.openai.com/*',
  'https://*.openai.com/*',
  'https://api.anthropic.com/*',
  'https://api.groq.com/*',
  'https://mistral.ai/*',
  'https://api.mistral.ai/*',
  'https://deepseek.com/*',
  'https://api.deepseek.com/*',
  'https://voyageai.com/*',
  'https://volcengine.com/*',
  'https://z.ai/*',
  'https://wandb.ai/*',
  'https://api.ai.sakura.ad.jp/*',
  // 1 Gist egress
  'https://api.github.com/*',
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
