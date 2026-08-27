/**
 * domainPolicyPort.ts
 * DomainPolicyPort — single seam for URL skip + domain filter cache.
 * Eliminates duplication between loader.ts and domainPolicy.ts where
 * CACHE_TTL and storage reads were managed separately.
 */

import { StorageKeys } from '../utils/storage/types.js';
import type { StoragePort } from '../utils/storage/storagePort.js';
import { extractDomain, isDomainInList, shouldSkipUrl } from './urlSkipper.js';

export const CACHE_TTL = 5 * 60 * 1000;

export interface DomainCacheCheck {
    allowed: boolean;
    useCache: boolean;
}

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

        const isCacheValid = cachedAt > 0 && (this.clock() - cachedAt) < CACHE_TTL;

        if (!isCacheValid) {
            return { allowed: false, useCache: false };
        }

        if (mode === 'disabled') {
            return { allowed: true, useCache: true };
        }

        if (mode === 'whitelist') {
            const allowed = isDomainInList(domain, cachedWhitelist);
            return { allowed, useCache: true };
        }

        if (mode === 'blacklist') {
            const result2 = await this.storage.get([
                StorageKeys.DOMAIN_BLACKLIST,
                StorageKeys.SIMPLE_FORMAT_ENABLED,
                StorageKeys.UBLOCK_FORMAT_ENABLED,
            ]);

            const blacklist = (result2[StorageKeys.DOMAIN_BLACKLIST] as string[]) || [];
            const simpleEnabled = result2[StorageKeys.SIMPLE_FORMAT_ENABLED] !== false;
            const ublockEnabled = result2[StorageKeys.UBLOCK_FORMAT_ENABLED] === true;

            if (ublockEnabled) {
                return { allowed: false, useCache: false };
            }

            if (simpleEnabled) {
                const isBlocked = isDomainInList(domain, blacklist);
                return { allowed: !isBlocked, useCache: true };
            }

            return { allowed: true, useCache: true };
        }

        return { allowed: true, useCache: true };
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

        const cachedWhitelist = (this.store[StorageKeys.DOMAIN_FILTER_CACHE] as string[]) || [];
        const cachedAt = (this.store[StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP] as number) || 0;
        const mode = (this.store[StorageKeys.DOMAIN_FILTER_MODE] as string) || 'disabled';

        const isCacheValid = cachedAt > 0 && (this.clock() - cachedAt) < CACHE_TTL;
        if (!isCacheValid) return { allowed: false, useCache: false };
        if (mode === 'disabled') return { allowed: true, useCache: true };
        if (mode === 'whitelist') {
            return { allowed: isDomainInList(domain, cachedWhitelist), useCache: true };
        }
        if (mode === 'blacklist') {
            const blacklist = (this.store[StorageKeys.DOMAIN_BLACKLIST] as string[]) || [];
            const simpleEnabled = this.store[StorageKeys.SIMPLE_FORMAT_ENABLED] !== false;
            const ublockEnabled = this.store[StorageKeys.UBLOCK_FORMAT_ENABLED] === true;
            if (ublockEnabled) return { allowed: false, useCache: false };
            if (simpleEnabled) return { allowed: !isDomainInList(domain, blacklist), useCache: true };
            return { allowed: true, useCache: true };
        }
        return { allowed: true, useCache: true };
    }

    seed(items: Record<string, unknown>): void {
        Object.assign(this.store, items);
    }
}
