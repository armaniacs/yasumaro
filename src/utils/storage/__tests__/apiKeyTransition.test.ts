// Pure module under test: no chrome, no storage, no KDF, no waits.
import { describe, it, expect, vi } from 'vitest';
import {
  ReencryptionAbortedError,
  classifyStoredValue,
  collectApiKeyTargets,
  planKekTransition,
  type ApiKeyPlacement,
  type ApiKeyTarget,
  type TrialDecrypt,
} from '../apiKeyTransition.js';
import { API_KEY_FIELD_NAMES } from '../apiKeyFields.js';
import type { EncryptedData } from '../../crypto/types.js';

/**
 * The two KEKs are never used as real keys. planKekTransition only forwards
 * them to the injected trialDecrypt, so labelled stand-ins let a test assert
 * *which* KEK was tried, by identity, with no KDF and no crypto.
 */
const PREVIOUS_KEK = { id: 'kek-previous' } as unknown as CryptoKey;
const NEXT_KEK = { id: 'kek-next' } as unknown as CryptoKey;
const KEYS = { previous: PREVIOUS_KEK, next: NEXT_KEK };

function envelope(seed: string): EncryptedData {
  return { ciphertext: btoa(`ct::${seed}`), iv: btoa(`iv::${seed}`) };
}

type KekReach = 'previous' | 'next' | 'none';

interface TrialCall {
  field: string;
  kek: 'previous' | 'next';
}

interface TransitionFixture {
  targets: ApiKeyTarget[];
  trialDecrypt: TrialDecrypt;
  calls: () => TrialCall[];
  reachOf: (target: ApiKeyTarget) => KekReach;
  secretOf: (target: ApiKeyTarget) => string;
  pick: (reach: KekReach, placement?: ApiKeyPlacement) => ApiKeyTarget;
  fieldsWithReach: (reach: KekReach) => string[];
}

/**
 * One ciphertext per canonical field, each with a distinct value. Reach is
 * split into thirds (previous → next → none) so every bucket is populated
 * without hardcoding the canonical list length, and placement alternates so
 * both stores are exercised. The trialDecrypt answer is derived from
 * (ciphertext, key) — the same inputs a real trial decrypt sees — never from a
 * queue of canned return values.
 */
function buildFixture(): TransitionFixture {
  const fieldByCiphertext = new Map<string, string>();
  const reach = new Map<string, KekReach>();
  const secret = new Map<string, string>();
  const targets: ApiKeyTarget[] = [];
  const third = Math.ceil(API_KEY_FIELD_NAMES.length / 3);

  for (const [index, field] of API_KEY_FIELD_NAMES.entries()) {
    const placement: ApiKeyPlacement = index % 2 === 0 ? 'nested' : 'scattered';
    const value = envelope(`${placement}:${field}`);
    fieldByCiphertext.set(value.ciphertext, field);
    reach.set(field, index < third ? 'previous' : index < third * 2 ? 'next' : 'none');
    secret.set(field, `sk-live-${placement}-${field}`);
    targets.push({ field, placement, value });
  }

  const trialDecrypt = vi.fn(
    async (value: EncryptedData, key: CryptoKey): Promise<string | null> => {
      const field = fieldByCiphertext.get(value.ciphertext);
      if (field === undefined) return null;
      const bucket = reach.get(field);
      if (key === PREVIOUS_KEK) {
        return bucket === 'previous' ? (secret.get(field) ?? null) : null;
      }
      return bucket === 'next' ? (secret.get(field) ?? null) : null;
    },
  );

  return {
    targets,
    trialDecrypt,
    calls: () =>
      trialDecrypt.mock.calls.map(([value, key]) => ({
        field: fieldByCiphertext.get(value.ciphertext) ?? '<unmapped ciphertext>',
        kek: key === PREVIOUS_KEK ? 'previous' : 'next',
      })),
    reachOf: (target) => reach.get(target.field) ?? 'none',
    secretOf: (target) => secret.get(target.field) ?? '',
    pick: (bucket, placement) => {
      const match = targets.find(
        (t) => reach.get(t.field) === bucket && (placement === undefined || t.placement === placement),
      );
      if (match === undefined) {
        throw new Error(`fixture has no '${bucket}' target${placement === undefined ? '' : ` in ${placement}`}`);
      }
      return match;
    },
    fieldsWithReach: (bucket) => API_KEY_FIELD_NAMES.filter((f) => reach.get(f) === bucket),
  };
}

function frozenTarget(field: string, placement: ApiKeyPlacement, value: unknown): ApiKeyTarget {
  return Object.freeze({ field, placement, value });
}

describe('apiKeyTransition', () => {
  describe('collectApiKeyTargets', () => {
    it('enumerates every canonical field from the nested blob, in canonical order', () => {
      const nested = Object.fromEntries(API_KEY_FIELD_NAMES.map((f) => [f, envelope(`n:${f}`)]));

      const targets = collectApiKeyTargets(nested, undefined);

      expect(targets.map((t) => t.field)).toEqual([...API_KEY_FIELD_NAMES]);
      expect(targets.map((t) => t.placement)).toEqual(API_KEY_FIELD_NAMES.map(() => 'nested'));
      // Values travel by reference; the planner must not copy or normalise them.
      for (const field of API_KEY_FIELD_NAMES) {
        expect(targets.find((t) => t.field === field)?.value).toBe(nested[field]);
      }
    });

    it('enumerates the same field set from the scattered placement', () => {
      const scattered = Object.fromEntries(API_KEY_FIELD_NAMES.map((f) => [f, `sk-live-${f}`]));

      const targets = collectApiKeyTargets(undefined, scattered);

      expect(targets.map((t) => t.field)).toEqual([...API_KEY_FIELD_NAMES]);
      expect(targets.map((t) => t.placement)).toEqual(API_KEY_FIELD_NAMES.map(() => 'scattered'));
      for (const field of API_KEY_FIELD_NAMES) {
        expect(targets.find((t) => t.field === field)?.value).toBe(scattered[field]);
      }
    });

    it('yields two independent targets when one field exists in both placements', () => {
      const nested = { provider_api_key: envelope('nested-provider') };
      const scattered = { provider_api_key: 'sk-live-provider' };

      const targets = collectApiKeyTargets(nested, scattered);

      // Each copy migrates on its own — a de-duplicating collector would drop
      // one of the two copies and silently leave it under the old KEK.
      expect(targets).toEqual([
        { field: 'provider_api_key', placement: 'nested', value: nested.provider_api_key },
        { field: 'provider_api_key', placement: 'scattered', value: scattered.provider_api_key },
      ]);
    });

    it('yields one target per field per placement for a fully duplicated store', () => {
      const nested = Object.fromEntries(API_KEY_FIELD_NAMES.map((f) => [f, envelope(`n:${f}`)]));
      const scattered = Object.fromEntries(API_KEY_FIELD_NAMES.map((f) => [f, envelope(`s:${f}`)]));

      const targets = collectApiKeyTargets(nested, scattered);

      expect(targets.map((t) => `${t.field}:${t.placement}`)).toEqual(
        API_KEY_FIELD_NAMES.flatMap((f) => [`${f}:nested`, `${f}:scattered`]),
      );
    });

    it('returns nothing when neither placement holds an API key', () => {
      expect(collectApiKeyTargets(undefined, undefined)).toEqual([]);
      expect(collectApiKeyTargets({}, {})).toEqual([]);
    });

    it('covers provider_api_key and github_pat — fields a 4-field helper could not reach', () => {
      const stored = {
        provider_api_key: envelope('provider'),
        github_pat: 'ghp_live',
      };

      const targets = collectApiKeyTargets(stored, undefined);

      expect(targets.map((t) => t.field)).toEqual(['provider_api_key', 'github_pat']);
    });

    it('ignores non-API-key settings living in the same blob', () => {
      const nested = {
        ai_provider: 'openai',
        obsidian_host: 'https://obsidian.example',
        obsidian_api_key: envelope('n:obsidian'),
      };

      const targets = collectApiKeyTargets(nested, undefined);

      expect(targets.map((t) => t.field)).toEqual(['obsidian_api_key']);
    });

    it('collects an own key whose stored value is explicitly undefined', () => {
      const nested = { gemini_api_key: undefined };

      const targets = collectApiKeyTargets(nested, undefined);

      // Presence, not truthiness: a truthiness probe would drop this target
      // and leave the key un-rotated.
      expect(targets).toHaveLength(1);
      expect(targets[0]?.field).toBe('gemini_api_key');
      expect(targets[0]?.value).toBeUndefined();
    });

    it('does not collect a field inherited from the prototype chain', () => {
      const nested = Object.create({ gemini_api_key: envelope('inherited') }) as Record<string, unknown>;

      expect(collectApiKeyTargets(nested, undefined)).toEqual([]);
    });

    it('honours an explicit field list instead of the canonical one', () => {
      const nested = Object.fromEntries(API_KEY_FIELD_NAMES.map((f) => [f, envelope(`n:${f}`)]));

      const targets = collectApiKeyTargets(nested, undefined, ['github_pat']);

      expect(targets.map((t) => t.field)).toEqual(['github_pat']);
    });
  });

  describe('classifyStoredValue', () => {
    it('reports a missing value as absent', () => {
      expect(classifyStoredValue(undefined)).toBe('absent');
      expect(classifyStoredValue(null)).toBe('absent');
    });

    it('distinguishes an empty string from a plaintext key', () => {
      expect(classifyStoredValue('')).toBe('empty');
      expect(classifyStoredValue('sk-live-abc')).toBe('plaintext');
    });

    it('treats a whitespace-only value as plaintext, not empty', () => {
      expect(classifyStoredValue('   ')).toBe('plaintext');
    });

    it('reports a well-formed envelope, metadata and all, as ciphertext', () => {
      const value = { ...envelope('valid'), version: 1, alg: 'AES-GCM' };

      expect(classifyStoredValue(value)).toBe('ciphertext');
    });

    it('reports a string that merely looks like base64 as plaintext, not ciphertext', () => {
      expect(classifyStoredValue('c2VjcmV0LXZhbHVl')).toBe('plaintext');
    });

    it('reports a half-formed envelope as malformed instead of ciphertext', () => {
      const malformed: unknown[] = [
        {},
        { ciphertext: '', iv: '' },
        { ciphertext: 'Y3Q=' },
        { iv: 'aXY=' },
        { ciphertext: 42, iv: 'aXY=' },
        [],
      ];

      for (const value of malformed) {
        expect(classifyStoredValue(value)).toBe('malformed');
      }
    });

    it('reports non-string, non-envelope scalars as malformed', () => {
      for (const value of [0, 1, false, true, Number.NaN]) {
        expect(classifyStoredValue(value)).toBe('malformed');
      }
    });
  });

  describe('planKekTransition', () => {
    it('re-encrypts an item only the previous KEK can open, carrying its plaintext for the executor', async () => {
      const fx = buildFixture();
      const target = fx.pick('previous', 'scattered');

      const plan = await planKekTransition([target], KEYS, fx.trialDecrypt);

      expect(plan.toReencrypt).toEqual([
        { field: target.field, placement: 'scattered', value: target.value, plaintext: fx.secretOf(target) },
      ]);
      // Same envelope instance: the executor re-encrypts without re-reading.
      expect(plan.toReencrypt[0]?.value).toBe(target.value);
      expect(plan.alreadyMigrated).toEqual([]);
      expect(plan.unrecoverable).toEqual([]);
      // The old KEK answered, so the next KEK is never consulted.
      expect(fx.calls()).toEqual([{ field: target.field, kek: 'previous' }]);
    });

    it('treats a next-KEK-readable item as already migrated, with no re-encryption delta', async () => {
      const fx = buildFixture();
      const target = fx.pick('next', 'nested');

      const plan = await planKekTransition([target], KEYS, fx.trialDecrypt);

      expect(plan.toReencrypt).toEqual([]);
      // The delta entry names the field only — no value travels with it.
      expect(plan.alreadyMigrated).toEqual([{ field: target.field, placement: 'nested' }]);
      expect(Object.keys(plan.alreadyMigrated[0] ?? {}).sort()).toEqual(['field', 'placement']);
      expect(plan.unrecoverable).toEqual([]);
      expect(fx.calls()).toEqual([
        { field: target.field, kek: 'previous' },
        { field: target.field, kek: 'next' },
      ]);
    });

    it('re-planning an already migrated store reproduces the plan and adds no delta', async () => {
      const fx = buildFixture();
      const migrated = fx.targets.filter((t) => fx.reachOf(t) === 'next');

      const first = await planKekTransition(migrated, KEYS, fx.trialDecrypt);
      const callsAfterFirst = fx.calls().length;
      const second = await planKekTransition(migrated, KEYS, fx.trialDecrypt);

      expect(first).toEqual(second);
      expect(first.toReencrypt).toEqual([]);
      expect(first.alreadyMigrated.map((i) => i.field)).toEqual(migrated.map((t) => t.field));
      // Pure function: the resumed run pays the same trial cost, so no state
      // survives from the first run.
      expect(fx.calls().length).toBe(callsAfterFirst * 2);
    });

    it('marks an item neither KEK can open as unrecoverable after trying both', async () => {
      const fx = buildFixture();
      const target = fx.pick('none', 'scattered');

      const plan = await planKekTransition([target], KEYS, fx.trialDecrypt);

      expect(plan.unrecoverable).toEqual([{ field: target.field, placement: 'scattered' }]);
      expect(plan.toReencrypt).toEqual([]);
      expect(plan.alreadyMigrated).toEqual([]);
      expect(fx.calls()).toEqual([
        { field: target.field, kek: 'previous' },
        { field: target.field, kek: 'next' },
      ]);
    });

    it('partitions a mixed store across the three buckets exactly once per target, in order', async () => {
      const fx = buildFixture();

      const plan = await planKekTransition(fx.targets, KEYS, fx.trialDecrypt);

      // No loss, no duplication, and no extra properties on a bucket entry.
      expect([
        ...plan.toReencrypt.map((i) => ({ field: i.field, placement: i.placement })),
        ...plan.alreadyMigrated,
        ...plan.unrecoverable,
      ]).toEqual(fx.targets.map((t) => ({ field: t.field, placement: t.placement })));
      expect(plan.toReencrypt.map((i) => i.field)).toEqual(fx.fieldsWithReach('previous'));
      expect(plan.alreadyMigrated.map((i) => i.field)).toEqual(fx.fieldsWithReach('next'));
      expect(plan.unrecoverable.map((i) => i.field)).toEqual(fx.fieldsWithReach('none'));
    });

    it('trials the previous KEK before the next KEK for every ciphertext, in target order', async () => {
      const fx = buildFixture();

      await planKekTransition(fx.targets, KEYS, fx.trialDecrypt);

      const expected = fx.targets.flatMap((t) =>
        fx.reachOf(t) === 'previous'
          ? [{ field: t.field, kek: 'previous' as const }]
          : [
              { field: t.field, kek: 'previous' as const },
              { field: t.field, kek: 'next' as const },
            ],
      );

      expect(fx.calls()).toEqual(expected);
    });

    it('never trials a value that is not ciphertext and leaves it out of every bucket', async () => {
      const fx = buildFixture();
      const nonCiphertext: ApiKeyTarget[] = [
        frozenTarget('obsidian_api_key', 'nested', undefined),
        frozenTarget('gemini_api_key', 'nested', null),
        frozenTarget('openai_api_key', 'scattered', ''),
        frozenTarget('provider_api_key', 'nested', 'sk-live-plaintext'),
        frozenTarget('github_pat', 'scattered', { ciphertext: '', iv: '' }),
      ];

      const plan = await planKekTransition(nonCiphertext, KEYS, fx.trialDecrypt);

      expect(plan).toEqual({ toReencrypt: [], alreadyMigrated: [], unrecoverable: [] });
      expect(fx.calls()).toEqual([]);
    });

    it('returns an empty plan for an empty target list without trialing anything', async () => {
      const fx = buildFixture();

      const plan = await planKekTransition([], KEYS, fx.trialDecrypt);

      expect(plan).toEqual({ toReencrypt: [], alreadyMigrated: [], unrecoverable: [] });
      expect(fx.calls()).toEqual([]);
    });
  });

  describe('ReencryptionAbortedError', () => {
    it('carries field names only — no ciphertext, plaintext, or key material survives serialization', async () => {
      const fx = buildFixture();
      // Same construction the executor performs: names in, nothing else.
      const plan = await planKekTransition(fx.targets, KEYS, fx.trialDecrypt);
      const error = new ReencryptionAbortedError(plan.unrecoverable.map((u) => u.field));

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ReencryptionAbortedError);
      expect(error.fields).toEqual(fx.fieldsWithReach('none'));

      const serialized = JSON.stringify({ ...error, message: error.message });
      const envelopes = fx.targets.map((t) => t.value as EncryptedData);
      const secrets = [
        ...envelopes.map((e) => e.ciphertext),
        ...envelopes.map((e) => e.iv),
        ...fx.targets.map((t) => fx.secretOf(t)),
      ];

      // Positive anchor: the field names really are in the payload, so the
      // negative checks below are about the values, not an empty error.
      for (const field of error.fields) {
        expect(serialized).toContain(field);
      }
      for (const secret of secrets) {
        expect(serialized).not.toContain(secret);
        expect(error.message).not.toContain(secret);
      }
      expect(JSON.stringify(error)).not.toContain(secrets[0] ?? 'ct::');
      expect(error.message).toContain(`${plan.unrecoverable.length} field(s)`);
    });

    it('adds no own property beyond the name, message and field list', () => {
      const error = new ReencryptionAbortedError(['github_pat']);

      const ownProps = Object.getOwnPropertyNames(error)
        .filter((p) => p !== 'stack')
        .sort();

      expect(ownProps).toEqual(['fields', 'message', 'name']);
      expect(error.fields).toEqual(['github_pat']);
    });

    it('counts the fields it was given, including the empty case', () => {
      expect(new ReencryptionAbortedError([]).fields).toEqual([]);
      expect(new ReencryptionAbortedError([]).message).toContain('0 field(s)');
      expect(new ReencryptionAbortedError(['a', 'b', 'c']).message).toContain('3 field(s)');
    });
  });
});
