/**
 * appVersion.ts
 *
 * Popup version label (PBI 2026-11-23-05). Shows the running extension
 * version directly under the logo so users can quote it in support requests.
 * The manifest read is injectable so tests swap it without touching
 * chrome.runtime.getManifest (parallel runs share the global chrome double).
 */

/** Fallback text when the version cannot be read. Never translated. */
export const APP_VERSION_FALLBACK = 'unknown';

/** Minimal manifest shape this module reads. */
export interface ManifestLike {
  version?: string | null | undefined;
}

/** Injectable manifest reader seam. May throw; the caller degrades. */
export type ManifestReader = () => ManifestLike | null | undefined;

export interface AppVersionDeps {
  getManifest?: ManifestReader;
  doc?: Document;
}

/** Formats a raw manifest version for display. */
export function formatAppVersion(version: string | null | undefined): string {
  const raw = (version ?? '').trim();
  if (!raw) return APP_VERSION_FALLBACK;
  return raw.startsWith('v') ? raw : `v${raw}`;
}

/** Default seam: the live manifest, degrading to null outside extensions. */
function defaultManifestReader(): ManifestLike | null {
  try {
    return chrome.runtime.getManifest() as ManifestLike;
  } catch {
    return null;
  }
}

/**
 * Writes the running version into #appVersion. Never throws: a failed read
 * leaves the fallback text and the rest of the popup boots untouched.
 * Returns the displayed text. Call after applyI18n so the value is final.
 */
export function initAppVersion(deps: AppVersionDeps = {}): string {
  const root = deps.doc ?? (typeof document !== 'undefined' ? document : undefined);
  let version: string | null | undefined;
  try {
    version = (deps.getManifest ?? defaultManifestReader)()?.version;
  } catch {
    version = null;
  }
  const text = formatAppVersion(version);
  root?.getElementById('appVersion')?.replaceChildren(text);
  return text;
}
