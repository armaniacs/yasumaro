// @layer 1 — Infrastructure (depends on Layer 0 only)
/**
 * storage/aiDomainPolicy.ts
 * Per-domain egress policy (PBI 2026-10-23-01): normalization and the single
 * owner of the domain → policy decision.
 *
 * A separate module from defaults.ts on purpose: defaults.ts sits upstream of
 * settingsMigration (SettingsRepository → settingsMigration → defaults), and
 * the resolver needs extractDomain from domainUtils, which imports
 * SettingsRepository — deriving here would close a utils-internal import
 * cycle and change module init order for every settings reader.
 */

import { StorageKeys } from './types.js';
import { isAiDomainPolicy } from './types.js';
import type { AiDomainPolicy, Settings } from './types.js';
import { extractDomain } from '../domainUtils.js';

/**
 * Resolve a persisted or imported per-domain policy value defensively.
 * An unknown/corrupted value fails closed to the default (`allowed`): a
 * garbage row must not silently stop a send (fail-open in the other
 * direction would silently disable the user's no-summary choice).
 */
export function normalizeAiDomainPolicy(value: unknown): AiDomainPolicy {
    return isAiDomainPolicy(value) ? value : 'allowed';
}

/**
 * Resolve the persisted domain-policy map defensively. A corrupt value must
 * fall through to an empty map, not to "every domain denied" — the map is
 * an opt-in restriction, so garbage must not expand it.
 */
export function normalizeAiDomainPolicyMap(value: unknown): Record<string, AiDomainPolicy> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, AiDomainPolicy> = {};
    for (const [domain, policy] of Object.entries(value as Record<string, unknown>)) {
        out[domain] = normalizeAiDomainPolicy(policy);
    }
    return out;
}

/**
 * Single owner of the per-domain egress policy decision (PBI 2026-10-23-01).
 * Resolves the policy for a page URL from the saved map; a URL without a
 * domain and a domain without a row both resolve to `allowed`.
 */
export function resolveAiDomainPolicy(settings: Settings, url: string): AiDomainPolicy {
    const domain = extractDomain(url);
    if (!domain) return 'allowed';
    const map = normalizeAiDomainPolicyMap(settings[StorageKeys.AI_DOMAIN_POLICY]);
    return normalizeAiDomainPolicy(map[domain]);
}
