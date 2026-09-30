// @layer 0 — Foundation (no chrome, no storage, no side effects)
/**
 * apiKeyTransition.ts
 *
 * Pure core of the master-password KEK rotation: classifying stored API-key
 * values and planning which items move from the old KEK to the next one.
 * Decryption itself is injected (TrialDecrypt) so this module never touches
 * crypto providers, storage, or module state — unit tests run without mocks.
 */
import { API_KEY_FIELD_NAMES } from './apiKeyFields.js';
import { isEncrypted } from '../crypto/primitives.js';
import type { EncryptedData } from '../crypto/types.js';

export type ApiKeyPlacement = 'nested' | 'scattered';

export interface ApiKeyTarget {
  field: string;
  placement: ApiKeyPlacement;
  value: unknown;
}

export type StoredValueClass = 'absent' | 'empty' | 'plaintext' | 'ciphertext' | 'malformed';

export function classifyStoredValue(value: unknown): StoredValueClass {
  if (value === undefined || value === null) return 'absent';
  if (value === '') return 'empty';
  if (typeof value === 'string') return 'plaintext';
  if (isEncrypted(value)) return 'ciphertext';
  // Non-empty, non-string, non-envelope shapes are left alone: they are not
  // ciphertext, so neither KEK can claim them, and overwriting them would
  // destroy data the rotation does not understand.
  return 'malformed';
}

/**
 * Enumerate canonical fields across both placements independently. A field
 * present in both yields two targets so each copy migrates on its own.
 */
export function collectApiKeyTargets(
  nested: Record<string, unknown> | undefined,
  scattered: Record<string, unknown> | undefined,
  fields: readonly string[] = API_KEY_FIELD_NAMES,
): ApiKeyTarget[] {
  const targets: ApiKeyTarget[] = [];
  const hasOwn = (obj: Record<string, unknown>, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(obj, key);
  for (const field of fields) {
    if (nested !== undefined && hasOwn(nested, field)) {
      targets.push({ field, placement: 'nested', value: nested[field] });
    }
    if (scattered !== undefined && hasOwn(scattered, field)) {
      targets.push({ field, placement: 'scattered', value: scattered[field] });
    }
  }
  return targets;
}

/**
 * Attempt decryption, returning the plaintext or null. Implementations must
 * not throw on a wrong key — a null return is normal control flow here
 * (trial detection), not an error.
 */
export type TrialDecrypt = (value: EncryptedData, key: CryptoKey) => Promise<string | null>;

export interface TransitionPlan {
  toReencrypt: Array<{ field: string; placement: ApiKeyPlacement; value: EncryptedData; plaintext: string }>;
  alreadyMigrated: Array<{ field: string; placement: ApiKeyPlacement }>;
  unrecoverable: Array<{ field: string; placement: ApiKeyPlacement }>;
}

/**
 * Thrown before any write when at least one item is undecryptable under both
 * KEKs. Carries field names only — never values, ciphertext, or auth data —
 * so UI layers can name the fields that need re-entry.
 */
export class ReencryptionAbortedError extends Error {
  readonly fields: readonly string[];
  constructor(fields: readonly string[]) {
    super(`ReencryptionAbortedError: ${fields.length} field(s) undecryptable under either KEK`);
    this.name = 'ReencryptionAbortedError';
    this.fields = fields;
  }
}

/**
 * Plan the rotation for every target. Old KEK is tried first; an item already
 * readable under the next KEK is skipped (idempotent resume after a Service
 * Worker restart needs no progress marker). Plaintext is carried in the plan
 * (memory only, never logged) so the executor does not pay a second decrypt.
 */
export async function planKekTransition(
  targets: readonly ApiKeyTarget[],
  keys: { previous: CryptoKey; next: CryptoKey },
  trialDecrypt: TrialDecrypt,
): Promise<TransitionPlan> {
  const plan: TransitionPlan = { toReencrypt: [], alreadyMigrated: [], unrecoverable: [] };
  for (const target of targets) {
    if (classifyStoredValue(target.value) !== 'ciphertext') continue;
    const value = target.value as EncryptedData;
    const withOld = await trialDecrypt(value, keys.previous);
    if (withOld !== null) {
      plan.toReencrypt.push({ field: target.field, placement: target.placement, value, plaintext: withOld });
      continue;
    }
    const withNext = await trialDecrypt(value, keys.next);
    if (withNext !== null) {
      plan.alreadyMigrated.push({ field: target.field, placement: target.placement });
      continue;
    }
    plan.unrecoverable.push({ field: target.field, placement: target.placement });
  }
  return plan;
}
