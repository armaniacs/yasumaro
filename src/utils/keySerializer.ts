// @layer 1 — Infrastructure shim (re-export from deep module)
// Compatibility shim: serialization logic now lives inside storage/storageTransaction.ts internal seam.
// This file is retained only for backward compat; new code should not import from here.

export {
  runSerialized,
  runSerializedMulti,
  __resetStorageTransactionForTest,
  _resetKeySerializerForTest,
} from './storage/storageTransaction.js';
