import { getMessageOr } from '../i18n.js';

export const ENCRYPTION_LOCKED_CODE = 'ENCRYPTION_LOCKED';

const FALLBACK_MESSAGE =
  'Your API keys are locked by the master password and cannot be used by background tasks. Open the dashboard and review the master password setting.';

export class EncryptionLockedError extends Error {
  readonly code = ENCRYPTION_LOCKED_CODE;
  constructor() {
    super(getMessageOr('encryptionLockedApiKeys', FALLBACK_MESSAGE));
    this.name = 'EncryptionLockedError';
  }
}

// encryptionSession throws plain Errors prefixed with the code, so match both shapes.
export function isEncryptionLockedError(e: unknown): boolean {
  return e instanceof EncryptionLockedError
    || (e instanceof Error && e.message.startsWith(`${ENCRYPTION_LOCKED_CODE}:`));
}

// A non-null object here is the undecrypted envelope: decryption always yields a string.
export function assertApiKeyResolved(value: unknown): void {
  if (typeof value === 'object' && value !== null) throw new EncryptionLockedError();
}
