import { StorageKeys } from './types.js';
import type { StoragePort } from './storagePort.js';
import type { Settings } from './types.js';

/**
 * settingsSnapshot.ts — decrypt-free settings snapshot for contexts that
 * must not touch keys (PBI 2026-09-28-30).
 *
 * Content scripts read configuration without ever decrypting API-key
 * envelopes: the returned snapshot may still contain ciphertext, which
 * callers must treat as opaque. Read-only: never migrates, never writes,
 * never decrypts.
 *
 * The authoritative-state check mirrors `isSettingsBlobAuthoritative`
 * (settingsMigration.ts) without importing its crypto-bound module graph
 * into content bundles. `settingsSnapshot-authority-parity.test.ts` pins
 * their agreement on a state matrix, so a drift fails loudly instead of
 * silently forking the read path.
 */
function isSnapshotAuthoritative(raw: unknown): boolean {
  if (raw === true) return true;
  if (raw === null || typeof raw !== 'object') return false;
  const state = raw as { stage?: unknown; schemaVersion?: unknown };
  return state.stage === 'completed' && typeof state.schemaVersion === 'number' && state.schemaVersion >= 2;
}

export async function readSettingsSnapshot(port: StoragePort): Promise<Settings> {
  const raw = await port.get(['settings', 'settings_migrated']);
  const blob = (raw['settings'] as Record<string, unknown> | undefined) ?? {};
  let merged: Record<string, unknown>;
  if (isSnapshotAuthoritative(raw['settings_migrated'])) {
    merged = { ...blob };
  } else {
    // Pre-migration layout: fold scattered keys under the blob, like the
    // repository's scattered fallback — without decrypting or persisting.
    const scattered = await port.get(Object.values(StorageKeys) as string[]);
    merged = { ...scattered, ...blob };
  }
  // No DEFAULT_SETTINGS fill: callers keep their own fallbacks (PageState
  // defaults, visitThresholds consts), and filling here would turn "absent"
  // into "present-but-default", breaking retain-previous logic downstream.
  return merged as Settings;
}
