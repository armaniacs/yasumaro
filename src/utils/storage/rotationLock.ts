// @layer 1 — Infrastructure: cross-context mutual exclusion for master-password KEK rotation
export const ROTATION_LOCK_NAME = 'yasumaro:master-password-rotation';

export class RotationInProgressError extends Error {
  constructor() {
    super('RotationInProgressError: another master password operation is in progress');
    this.name = 'RotationInProgressError';
  }
}

// The default is read per call (not at module load) so tests can inject a manager.
export async function withRotationLock<T>(
  fn: () => Promise<T>,
  locks: Pick<LockManager, 'request'> | null = globalThis.navigator?.locks ?? null,
): Promise<T> {
  if (locks === null) {
    // Fail closed: running unserialized is what this lock exists to prevent.
    throw new Error('ROTATION_LOCK_UNAVAILABLE: Web Locks API is not available');
  }
  return locks.request(ROTATION_LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
    if (lock === null) throw new RotationInProgressError();
    return fn();
  });
}
