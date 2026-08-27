/**
 * authGuard.ts
 * Single seam for "is the encryption session currently locked?".
 * Consolidates the MASTER_PASSWORD_ENABLED + IS_LOCKED read used by
 * getOrCreateEncryptionKey so callers never read chrome.storage.local directly.
 */

import { StorageKeys } from './types.js';

export async function isLocked(): Promise<boolean> {
  const lockStatus = await chrome.storage.local.get([
    StorageKeys.MASTER_PASSWORD_ENABLED,
    StorageKeys.IS_LOCKED,
  ]);
  // IS_LOCKED is meaningless (and must not block decryption) for users who
  // never configured a master password.
  return Boolean(lockStatus[StorageKeys.MASTER_PASSWORD_ENABLED] && lockStatus[StorageKeys.IS_LOCKED]);
}
