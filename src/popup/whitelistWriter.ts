/**
 * whitelistWriter.ts
 * Single owner of the "add to the domain-filter whitelist" operation
 * (PBI 2026-09-12-05).
 *
 * Five popup surfaces used to hand-roll the read-modify-write, each with its
 * own dedup check and entry encoding — and none of them validated the
 * pattern, so an unvalidated entry went straight into storage while the
 * dashboard's save path (DomainFilter.parseAndValidate) would have rejected
 * it. Worse, the "path" entries (raw URL or anchored regex) could never match
 * anything: every whitelist consumer matches hostnames only, and both shapes
 * fail isValidDomainPattern. They were dead entries that poisoned the
 * dashboard evaluation path silently.
 *
 * The gateway validates through DomainFilter.parseAndValidate (the sole
 * validation seam), dedups, writes through the SettingsRepository blob seam,
 * refreshes the DomainFilter cache, and normalizes "path" adds to the URL's
 * hostname — the only form any consumer can match. Path-level matching is not
 * implemented anywhere (see DESIGN_SPECIFICATIONS §13.5 note); when a product
 * decision lands on path matching, this is the one file that changes.
 */

import { DomainFilter } from '../utils/domainFilter/DomainFilter.js';
import { extractHostname } from '../utils/wildcardToRegex.js';
import { StorageKeys } from '../utils/storage/types.js';
import type { Settings } from '../utils/storage/types.js';
import { settingsRepository } from '../utils/storage/SettingsRepository.js';
import { updateDomainFilterCache } from '../utils/storage/domainFilterCache.js';

export type WhitelistWriteResult =
  | { ok: true; entry: string; added: boolean }
  | { ok: false; reason: 'invalid-pattern' | 'no-domain'; error?: string };

/** Add a domain pattern (hostname or wildcard) after validation. */
export async function addDomainToWhitelist(domain: string): Promise<WhitelistWriteResult> {
  return addToWhitelist(domain);
}

/**
 * Add the URL's hostname. The historical "path whitelist" stored raw URLs or
 * anchored regexes that no consumer could match and validation would reject;
 * both normalize here to the domain until path-level matching exists.
 */
export async function addPathToWhitelist(url: string): Promise<WhitelistWriteResult> {
  const host = extractHostname(url);
  if (!host) {
    return { ok: false, reason: 'no-domain' };
  }
  return addToWhitelist(host);
}

async function addToWhitelist(entry: string): Promise<WhitelistWriteResult> {
  const filter = new DomainFilter();
  const { valid, errors } = filter.parseAndValidate([entry]);
  const normalized = valid[0];
  if (!normalized) {
    return { ok: false, reason: 'invalid-pattern', error: errors[0] ?? '' };
  }

  const settings = await settingsRepository.getAll();
  const whitelist = (settings[StorageKeys.DOMAIN_WHITELIST] as string[]) || [];
  if (whitelist.includes(normalized)) {
    return { ok: true, entry: normalized, added: false };
  }

  await settingsRepository.setAll({
    [StorageKeys.DOMAIN_WHITELIST]: [...whitelist, normalized],
  } as unknown as Settings);
  await updateDomainFilterCache(await settingsRepository.getAll());
  return { ok: true, entry: normalized, added: true };
}
