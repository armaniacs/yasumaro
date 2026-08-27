/**
 * domainPolicy.ts
 * Thin re-export — the domain filter policy now lives behind DomainPolicyPort
 * (domainPolicyPort.ts) so loader.ts and contentKernel share the same CACHE_TTL
 * and storage semantics. This file remains for backward compat.
 */

import { ChromeStoragePort } from '../utils/storage/storagePort.js';
import { ChromeDomainPolicyPort, CACHE_TTL } from './domainPolicyPort.js';
import type { DomainCacheCheck } from './domainPolicyPort.js';

// Re-export TTL and type so callers have a single source
export { CACHE_TTL };
export type { DomainCacheCheck } from './domainPolicyPort.js';

// Default port instance used by the content script runtime.
// Both loader.ts and extractor/contentKernel route through this single seam.
const defaultPort = new ChromeDomainPolicyPort(new ChromeStoragePort());

/**
 * Backward-compat wrapper — delegates to the port.
 * New code should inject DomainPolicyPort directly via ContentKernel.
 */
export function checkDomainAllowedFromCache(url: string): Promise<DomainCacheCheck> {
    return defaultPort.checkDomainAllowedFromCache(url);
}
