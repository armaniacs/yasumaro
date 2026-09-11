/**
 * inMemoryDomainPolicyPort.ts
 * Test-support DomainPolicyPort — no storage or chrome globals.
 *
 * Moved verbatim from domainPolicyPort.ts (PBI-14 test-support relocation).
 * Production code must not import this module; tests import it from here.
 */

import { StorageKeys } from '../../../utils/storage/types.js';
import type { DomainPolicyPort, Clock } from '../../domainPolicyPort.js';
import { extractDomain, shouldSkipUrl } from '../../urlSkipper.js';
import { evaluateDomainPolicy } from '../../visitAdmission.js';
import type { DomainCacheCheck } from '../../visitAdmission.js';

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
                matchSubdomains: this.store[StorageKeys.DOMAIN_SUBDOMAIN_MATCHING] === true,
            },
            this.clock(),
        );
    }

    seed(items: Record<string, unknown>): void {
        Object.assign(this.store, items);
    }
}
