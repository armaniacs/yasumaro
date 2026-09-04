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

        const result = await this.storage.get([
            StorageKeys.DOMAIN_FILTER_CACHE,
            StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP,
            StorageKeys.DOMAIN_FILTER_MODE,
        ]);

        const cachedWhitelist = (result[StorageKeys.DOMAIN_FILTER_CACHE] as string[]) || [];
        const cachedAt = (result[StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP] as number) || 0;
        const mode = (result[StorageKeys.DOMAIN_FILTER_MODE] as string) || 'disabled';

        // Second-stage read only in blacklist mode (storage call pattern
        // unchanged); branching itself lives in the shared pure policy.
        let blacklist: string[] = [];
        let simpleEnabled = true;
        let ublockEnabled = false;
        if (mode === 'blacklist') {
            const result2 = await this.storage.get([
                StorageKeys.DOMAIN_BLACKLIST,
                StorageKeys.SIMPLE_FORMAT_ENABLED,
                StorageKeys.UBLOCK_FORMAT_ENABLED,
            ]);

            blacklist = (result2[StorageKeys.DOMAIN_BLACKLIST] as string[]) || [];
            simpleEnabled = result2[StorageKeys.SIMPLE_FORMAT_ENABLED] !== false;
            ublockEnabled = result2[StorageKeys.UBLOCK_FORMAT_ENABLED] === true;
        }

        return evaluateDomainPolicy(
            domain,
            { cachedWhitelist, cachedAt, mode, blacklist, simpleEnabled, ublockEnabled },
            this.clock(),
        );
    }
}

/**
 * In-memory implementation for tests — no storage or chrome globals.
 * Mirrors ChromeDomainPolicyPort logic but seeded via plain objects.
 */
export class InMemoryDomainPolicyPort implements DomainPolicyPort {
    constructor(
        private readonly store: Record<string, unknown> = {},
        private readonly clock: Clock = () => Date.now(),
    ) {}

    shouldSkip(url: string): boolean {
        return shouldSkipUrl(url);
    }

    async checkDomainAllowedFromCache(url: string): Promise<DomainCacheCheck> {
        const domain = extractDomain(url);
        if (!domain) return { allowed: false, useCache: true };

        return evaluateDomainPolicy(
            domain,
            {
                cachedWhitelist: (this.store[StorageKeys.DOMAIN_FILTER_CACHE] as string[]) || [],
                cachedAt: (this.store[StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP] as number) || 0,
                mode: (this.store[StorageKeys.DOMAIN_FILTER_MODE] as string) || 'disabled',
                blacklist: (this.store[StorageKeys.DOMAIN_BLACKLIST] as string[]) || [],
                simpleEnabled: this.store[StorageKeys.SIMPLE_FORMAT_ENABLED] !== false,
                ublockEnabled: this.store[StorageKeys.UBLOCK_FORMAT_ENABLED] === true,
            },
            this.clock(),
        );
    }

    seed(items: Record<string, unknown>): void {
        Object.assign(this.store, items);
    }
}
