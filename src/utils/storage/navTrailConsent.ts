/**
 * navTrailConsent.ts
 * Feature-specific consent for the navigation trail (PBI 2026-09-26-03).
 *
 * WHY a separate consent instead of bumping PRIVACY_POLICY_VERSION: the trail
 * records two new per-record fields, and it is opt-in. Re-prompting every
 * existing user over an opt-in feature they never asked for would train people
 * to click through consent dialogs. The global policy version therefore stays
 * put, and the PBI 2026-09-25-24 ruling (device-local consent stays out of
 * export/restore) is what this key implements.
 *
 * WHY chrome.storage.local directly rather than the settings repository: the
 * value must stay out of DEFAULT_SETTINGS, or settingsExportImport would pick
 * it up and an export written on a consenting device would carry the
 * authorization to another one. Same treatment as ENCRYPTION_SALT.
 */

import { StorageKeys } from './types.js';

export interface NavTrailConsent {
  enabled: boolean;
  consentedAt: number | null;
}

export const NAV_TRAIL_CONSENT_DEFAULT: NavTrailConsent = {
  enabled: false,
  consentedAt: null,
};

/**
 * A consent record is only usable when it is enabled AND carries the moment it
 * was granted. `enabled: true` with a null timestamp is a malformed write, and
 * treating it as active would collect data the user never agreed to.
 */
export function isNavTrailActive(consent: NavTrailConsent): boolean {
  return consent.enabled && consent.consentedAt !== null;
}

function isNavTrailConsentShape(value: unknown): value is NavTrailConsent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { enabled?: unknown; consentedAt?: unknown };
  if (typeof candidate.enabled !== 'boolean') {
    return false;
  }
  return candidate.consentedAt === null || typeof candidate.consentedAt === 'number';
}

export async function getNavTrailConsent(): Promise<NavTrailConsent> {
  try {
    const result = await chrome.storage.local.get(StorageKeys.NAV_TRAIL_CONSENT);
    const stored = result[StorageKeys.NAV_TRAIL_CONSENT];
    return isNavTrailConsentShape(stored) ? stored : NAV_TRAIL_CONSENT_DEFAULT;
  } catch {
    return NAV_TRAIL_CONSENT_DEFAULT;
  }
}

export async function enableNavTrail(now: number): Promise<void> {
  await chrome.storage.local.set({
    [StorageKeys.NAV_TRAIL_CONSENT]: { enabled: true, consentedAt: now } satisfies NavTrailConsent,
  });
}

export async function disableNavTrail(): Promise<void> {
  await chrome.storage.local.set({
    [StorageKeys.NAV_TRAIL_CONSENT]: { ...NAV_TRAIL_CONSENT_DEFAULT },
  });
}
