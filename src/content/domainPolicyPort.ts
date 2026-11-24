/**
 * domainPolicyPort.ts
 * DomainPolicyPort — single seam for URL skip + domain filter cache.
 * Eliminates duplication between loader.ts and domainPolicy.ts where
 * CACHE_TTL and storage reads were managed separately.
 */

import { StorageKeys } from '../utils/storage/types.js';
import { hasBlobTopLevelSkew, readBlobFirst, resolveBlobFirstAll, withBlobTierKeys } from '../utils/storage/blobTierRead.js';
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
        // The four policy keys are written into the settings blob and are
        // TOP_LEVEL_ONLY (never folded away), so the blob is read first and
        // the top-level copy is only the legacy fallback (blobTierRead.ts).
        // The mirror keys have no blob tier: domainFilterCache.ts writes them
        // top-level only.
        const result = await this.storage.get(
            withBlobTierKeys([
                StorageKeys.DOMAIN_FILTER_CACHE,
                StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP,
                StorageKeys.DOMAIN_FILTER_MODE,
                StorageKeys.DOMAIN_SUBDOMAIN_MATCHING,
                StorageKeys.DOMAIN_BLACKLIST,
                StorageKeys.SIMPLE_FORMAT_ENABLED,
                StorageKeys.UBLOCK_FORMAT_ENABLED,
            ]),
        );

        const cachedWhitelist = (result[StorageKeys.DOMAIN_FILTER_CACHE] as string[]) || [];
        const cachedAt = (result[StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP] as number) || 0;
        const mode = (result[StorageKeys.DOMAIN_FILTER_MODE] as string) || 'disabled';
        // Scoped projection: only the four policy inputs leave the storage
        // seam. The fetched blob may carry encrypted API keys and sync
        // destinations, but they never enter the verdict inputs and are never
        // forwarded to a page-facing bridge.
        const policy = resolveBlobFirstAll(result, [
            StorageKeys.DOMAIN_SUBDOMAIN_MATCHING,
            StorageKeys.DOMAIN_BLACKLIST,
            StorageKeys.SIMPLE_FORMAT_ENABLED,
            StorageKeys.UBLOCK_FORMAT_ENABLED,
        ]);
        const matchSubdomains = readBlobFirst(result, StorageKeys.DOMAIN_SUBDOMAIN_MATCHING) === true;

        const blacklist =
            mode === 'blacklist' || mode === 'whitelist'
                ? ((policy[StorageKeys.DOMAIN_BLACKLIST] as string[] | undefined) || [])
                : [];
        const simpleEnabled =
            mode === 'blacklist' || mode === 'whitelist'
                ? policy[StorageKeys.SIMPLE_FORMAT_ENABLED] !== false
                : true;
        const ublockEnabled =
            mode === 'blacklist' || mode === 'whitelist'
                ? policy[StorageKeys.UBLOCK_FORMAT_ENABLED] === true
                : false;
        // Fail-closed tie-break (PBI 2026-11-24-17): a blob copy next to a
        // different top-level copy means the two-stage cache write straddled
        // generations. Never trust the permissive side; defer to background.
        const generationSkewed = hasBlobTopLevelSkew(result, [
            StorageKeys.DOMAIN_SUBDOMAIN_MATCHING,
            StorageKeys.DOMAIN_BLACKLIST,
            StorageKeys.SIMPLE_FORMAT_ENABLED,
            StorageKeys.UBLOCK_FORMAT_ENABLED,
        ]);

        return evaluateDomainPolicy(
            domain,
            { cachedWhitelist, cachedAt, mode, blacklist, simpleEnabled, ublockEnabled, matchSubdomains, generationSkewed },
            this.clock(),
        );
    }
}
