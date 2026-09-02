// @layer 1 — Infrastructure shim (re-export from deep module)
// Compatibility shim: all logic now lives in storage/storageTransaction.ts (deep module).
// Keeping this barrel so existing imports keep working; new code should import from
// src/utils/storage/storageTransaction.ts directly.

export {
  ConflictError,
  StorageTransaction,
  withOptimisticLock,
  withAtomicKeys,
  withLockViaPort,
  withAtomicViaPort,
  __resetStorageTransactionForTest,
  _resetKeySerializerForTest,
} from './storage/storageTransaction.js';

// Legacy export kept for tests that import enablePostWriteVerification (now no-op, always enabled)
export function enablePostWriteVerification(): void {
  // no-op: post-write verification is always enabled in the deep module
}
