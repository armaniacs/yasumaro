// @layer 0 — Foundation: pure policy + injectable flow (no chrome, no storage)
/**
 * visitAdmission.ts — deep module owning the visit-admission decision.
 *
 * Single seam for skip -> cache verdict -> retrying background verdict ->
 * inject. The loader IIFE and the kernel both route through here instead of
 * re-deriving the flow; the Chrome/in-memory port variants share the pure
 * policy function instead of mirroring its branches.
 *
 * The e2e and normal paths turned out identical except warn labels, so there
 * is one flow with a warnLabel (' (e2e)' or '') — the e2e-bypass-safety
 * property (cold cache must still ask background) is tested, not commented.
 */
import { isDomainInList } from './urlSkipper.js';

export const CACHE_TTL = 5 * 60 * 1000;

export interface DomainCacheCheck {
  allowed: boolean;
  useCache: boolean;
}

/** Plain-data snapshot the pure policy evaluates. Ports map storage into this. */
export interface DomainPolicySnapshot {
  cachedWhitelist: string[];
  cachedAt: number;
  mode: string;
  blacklist: string[];
  simpleEnabled: boolean;
  ublockEnabled: boolean;
}

/**
 * Pure domain policy shared by the Chrome and in-memory port variants.
 * Branch-for-branch identical to the two implementations it replaces.
 */
export function evaluateDomainPolicy(
  domain: string | null,
  snapshot: DomainPolicySnapshot,
  nowMs: number,
): DomainCacheCheck {
  if (!domain) {
    return { allowed: false, useCache: true };
  }

  const isCacheValid = snapshot.cachedAt > 0 && nowMs - snapshot.cachedAt < CACHE_TTL;
  if (!isCacheValid) {
    return { allowed: false, useCache: false };
  }

  if (snapshot.mode === 'disabled') {
    return { allowed: true, useCache: true };
  }

  if (snapshot.mode === 'whitelist') {
    const allowed = isDomainInList(domain, snapshot.cachedWhitelist);
    return { allowed, useCache: true };
  }

  if (snapshot.mode === 'blacklist') {
    if (snapshot.ublockEnabled) {
      return { allowed: false, useCache: false };
    }
    if (snapshot.simpleEnabled) {
      const isBlocked = isDomainInList(domain, snapshot.blacklist);
      return { allowed: !isBlocked, useCache: true };
    }
    return { allowed: true, useCache: true };
  }

  return { allowed: true, useCache: true };
}

export interface CheckDomainResponse {
  success?: boolean;
  allowed?: boolean;
}

export interface VisitAdmissionDeps {
  url: string;
  /** '' normally, ' (e2e)' on probe pages — preserves warn-text greppability */
  warnLabel: string;
  shouldSkip: (url: string) => boolean;
  checkCache: (url: string) => Promise<DomainCacheCheck>;
  sendCheckDomain: () => Promise<CheckDomainResponse | undefined>;
  sleep: (ms: number) => Promise<void>;
  loadExtractor: () => Promise<void>;
  warn: (message: string, url: string, detail: string) => void;
}

export type AdmissionOutcome = 'injected' | 'skipped';

function errorDetail(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Shared 3-attempt retry (200ms linear backoff, sleep on catch only). */
export async function checkDomainWithRetry(
  send: () => Promise<CheckDomainResponse | undefined>,
  sleep: (ms: number) => Promise<void>,
): Promise<{ response: CheckDomainResponse | undefined; lastError: unknown }> {
  let response: CheckDomainResponse | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await send();
      if (response) break;
    } catch (e) {
      lastError = e;
      await sleep(200 * (attempt + 1));
    }
  }
  return { response, lastError };
}

/**
 * Full admission decision: skip check, cache read, retrying background
 * verdict, inject decision. All environment access (chrome, timers, import)
 * arrives via adapters so the flow is unit-testable.
 */
export async function resolveVisitAdmission(deps: VisitAdmissionDeps): Promise<AdmissionOutcome> {
  if (deps.shouldSkip(deps.url)) {
    return 'skipped';
  }

  const cacheCheck = await deps.checkCache(deps.url);
  if (cacheCheck.useCache) {
    if (!cacheCheck.allowed) {
      return 'skipped';
    }
    try {
      await deps.loadExtractor();
    } catch (e) {
      deps.warn(`[OWeave] Dynamic import blocked${deps.warnLabel}`, deps.url, errorDetail(e));
    }
    return 'injected';
  }

  const { response, lastError } = await checkDomainWithRetry(deps.sendCheckDomain, deps.sleep);
  if (!response || !response.allowed) {
    if (!response) {
      deps.warn(
        '[OWeave] Domain check failed: no response from service worker',
        deps.url,
        errorDetail(lastError ?? 'unknown'),
      );
    }
    return 'skipped';
  }

  try {
    await deps.loadExtractor();
  } catch (e) {
    deps.warn(`[OWeave] Dynamic import blocked${deps.warnLabel}`, deps.url, errorDetail(e));
  }
  return 'injected';
}
