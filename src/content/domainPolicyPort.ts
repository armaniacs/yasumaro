/**
 * domainPolicyPort.ts
 * DomainPolicyPort — single seam for URL skip + domain filter cache.
 * Eliminates duplication between loader.ts and domainPolicy.ts where
 * CACHE_TTL and storage reads were managed separately.
 */

import { StorageKeys } from '../utils/storage/types.js';
import type { StoragePort } from '../utils/storage/storagePort.js';
import { extractDomain, shouldSkipUrl } from './urlSkipper.js';
import { evaluateDomainPolicy } from './visitAdmission.js';
import type { DomainCacheCheck } from './visitAdmission.js';

// Re-exported for backward compat (tests import them from this seam).
export { CACHE_TTL } from './visitAdmission.js';
export type { DomainCacheCheck, DomainPolicySnapshot } from './visitAdmission.js';

export interface DomainPolicyPort {
    shouldSkip(url: string): boolean;
    checkDomainAllowedFromCache(url: string): Promise<DomainCacheCheck>;
}

export type Clock = () => number;

/**
 * ChromeStorage-backed implementation. Uses injected StoragePort + Clock
 * so loader and domainPolicy share the same TTL and storage semantics.
 */
export class ChromeDomainPolicyPort implements DomainPolicyPort {
    constructor(
        private readonly storage: StoragePort,
        private readonly clock: Clock = () => Date.now(),
    ) {}

    shouldSkip(url: string): boolean {
        return shouldSkipUrl(url);
    }

    async checkDomainAllowedFromCache(url: string): Promise<DomainCacheCheck> {
        const domain = extractDomain(url);
        // Early return preserved (avoids a wasted storage read); the pure
        // policy handles null identically for direct callers.
        if (!domain) {
            return { allowed: false, useCache: true };
        }

        // PBI 2026-11-08-05: single atomic read. The previous two-stage
        // reads let a settings change land between them, mixing the mode of
        // one generation with the flags of the next — every field below now
        // comes from the same snapshot.
        const result = await this.storage.get([
            StorageKeys.DOMAIN_FILTER_CACHE,
            StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP,
            StorageKeys.DOMAIN_FILTER_MODE,
            StorageKeys.DOMAIN_SUBDOMAIN_MATCHING,
            StorageKeys.DOMAIN_BLACKLIST,
            StorageKeys.SIMPLE_FORMAT_ENABLED,
            StorageKeys.UBLOCK_FORMAT_ENABLED,
        ]);

        const cachedWhitelist = (result[StorageKeys.DOMAIN_FILTER_CACHE] as string[]) || [];
        const cachedAt = (result[StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP] as number) || 0;
        const mode = (result[StorageKeys.DOMAIN_FILTER_MODE] as string) || 'disabled';
        const matchSubdomains = result[StorageKeys.DOMAIN_SUBDOMAIN_MATCHING] === true;

        const blacklist =
            mode === 'blacklist' || mode === 'whitelist'
                ? ((result[StorageKeys.DOMAIN_BLACKLIST] as string[]) || [])
                : [];
        const simpleEnabled =
            mode === 'blacklist' || mode === 'whitelist'
                ? result[StorageKeys.SIMPLE_FORMAT_ENABLED] !== false
                : true;
        const ublockEnabled =
            mode === 'blacklist' || mode === 'whitelist'
                ? result[StorageKeys.UBLOCK_FORMAT_ENABLED] === true
                : false;

        return evaluateDomainPolicy(
            domain,
            { cachedWhitelist, cachedAt, mode, blacklist, simpleEnabled, ublockEnabled, matchSubdomains },
            this.clock(),
        );
    }
}
