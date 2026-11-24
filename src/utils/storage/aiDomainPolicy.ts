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
 * An unknown/corrupted value fails closed to `no-summary` (no-send side):
 * a garbage row must never widen egress to unrestricted send. `no-summary`
 * records the visit without any AI, so nothing leaves the device, while
 * `mask-required` would still send masked content to cloud AI. This mirrors
 * `normalizePrivacyMode`, which fails closed to `masked_cloud` so unknown
 * values never silently disable PII masking. Normalization happens at read
 * time (`normalizeAiDomainPolicyMap` / `resolveAiDomainPolicy`), so corrupt
 * values arriving via settings import or backup restore are contained
 * without a migration.
 */
export function normalizeAiDomainPolicy(value: unknown): AiDomainPolicy {
    return isAiDomainPolicy(value) ? value : 'no-summary';
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
 * Single owner of the per-domain egress policy decision (PBI 2026-10-23-01,
 * fail-closed per PBI 2026-11-24-19).
 * Resolves the policy for a page URL from the saved map; a URL without a
 * domain and a domain without a row both resolve to `allowed` (the map is
 * an opt-in restriction, so a missing row must not deny a send). A present
 * row with an unknown value resolves to `no-summary` via
 * `normalizeAiDomainPolicy`.
 */
export function resolveAiDomainPolicy(settings: Settings, url: string): AiDomainPolicy {
    const domain = extractDomain(url);
    if (!domain) return 'allowed';
    const map = normalizeAiDomainPolicyMap(settings[StorageKeys.AI_DOMAIN_POLICY]);
    const policy = map[domain];
    if (policy === undefined) return 'allowed';
    return normalizeAiDomainPolicy(policy);
}
