// @layer 1 — Infrastructure (depends on Layer 0 only)
/**
 * storage/encryptionSession.ts
 * Master password lifecycle, encryption key derivation, and HMAC secret
 * management. Split out of storage.ts (PBI: storage.ts deepening).
 */

import { logInfo, logDebug } from '../logger/api.js';
import { sendFromPopup } from '../../messaging/types.js';
import { calculatePasswordStrength } from '../masterPassword.js';
import {
    generateSalt,
    deriveKey,
    hashPasswordWithPBKDF2,
    verifyPasswordWithPBKDF2,
    ENVELOPE_ITERATIONS,
    wrapSecretString,
    unwrapSecretString,
    isWrappedSecretString,
    bytesToBase64,
    base64ToBytes,
} from '../crypto/index.js';
import { validatePasswordPolicy } from '../crypto/cryptoParams.js';
import { hmacSignerForSecret, type HmacSigner } from '../crypto/hmacSigner.js';
import {
  getOrCreateSecretWrappingKey,
  loadSecretWrappingKey,
  wrapSecretWithKey,
  unwrapSecretWithKey,
  isSecretEnvelope,
  type SecretEnvelope,
} from '../crypto/secretWrappingKey.js';
import { StorageKeys } from './types.js';
import {
  collectApiKeyTargets,
  planKekTransition,
  ReencryptionAbortedError,
  type TrialDecrypt,
} from './apiKeyTransition.js';
import { API_KEY_FIELD_NAMES } from './apiKeyFields.js';
import { constantTimeCompare, decryptApiKey, encryptApiKey, isEncrypted } from '../crypto/index.js';
import { StorageTransaction } from './storageTransaction.js';
import { ChromeStoragePort, type StoragePort } from './storagePort.js';

export { ReencryptionAbortedError };
import { checkRateLimit, recordFailedAttempt, resetFailedAttempts } from '../rateLimiter.js';
import { isLocked as authGuardIsLocked } from './authGuard.js';
import { Mutex } from '../Mutex.js';

// ============================================================================
// Module-private session state
// ============================================================================

let cachedEncryptionKey: CryptoKey | null = null;
let cachedMasterPassword: string | null = null; // セッション中のマスターパスワードキャッシュ
let isMasterPasswordRequired = false; // マスターパスワードが設定済みかどうか
let cachedHmacSecret: string | null = null;
// getOrCreateEncryptionKey の session→local 復元・新規secret生成を排他制御する。
// アップデート直後に複数のメッセージハンドラからほぼ同時に呼ばれた場合、
// この区間をロックしないと片方が誤って新しいsecretを生成し、既存の
// 暗号化済みAPIキーが復号不能になる（2026-08-12インシデントの再発防止）。
const encryptionKeyMutex = new Mutex();

// ============================================================================
// Helpers
// ============================================================================

// Local base64 helpers were removed in favour of the shared codec seam
// (PBI 2026-09-15-16): `base64ToBytes` / `bytesToBase64` from crypto/.
// The encoder there chunks its input, so the `String.fromCharCode(...bytes)`
// spread these call sites used — which overflows the argument stack on a
// large enough array — is gone too.

/**
 * パスワードから暗号化キーを導出する（PBKDF2、extensionIdなし）
 * マスターパスワード方式専用
 * VULN-019 fix: uses stored iteration count with fallback to legacy
 */
async function deriveKeyFromPassword(password: string, salt: Uint8Array, iterations?: number): Promise<CryptoKey> {
    // VULN-019 fix: use stored iteration count or ENVELOPE_ITERATIONS for new setups.
    // An explicit iterations argument wins: callers deriving a *new* KEK before
    // its metadata is persisted must not read the still-old stored count.
    // Skip the storage read entirely then — every rotation caller passes it.
    const storedIterations = iterations === undefined
        ? (await chrome.storage.local.get([StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS]))[
            StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS
        ] as number | undefined
        : undefined;
    const iterationsToUse = iterations ?? storedIterations ?? ENVELOPE_ITERATIONS;
    // globalThis: the dashboard bundle has no Node `global` shim, and bare
    // `global` throws ReferenceError there. globalThis exists everywhere.
    const webcrypto = globalThis.crypto;
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);

    const baseKey = await webcrypto.subtle.importKey(
        'raw',
        passwordBuffer,
        'PBKDF2',
        false,
        ['deriveKey']
    );

    return webcrypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt as BufferSource,
            iterations: iterationsToUse,
            hash: 'SHA-256'
        },
        baseKey,
        {
            name: 'AES-GCM',
            length: 256
        },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * マスターパスワードからキーを導出する（マスターパスワード方式専用の分岐）。
 * @throws {Error} マスターパスワード未入力、またはsaltが破損している場合
 */
async function deriveKeyFromMasterPassword(passwordSaltBase64: string | undefined): Promise<CryptoKey> {
    // 【セキュリティ修正】マスターパスワードが設定されている場合は強制的にロック
    isMasterPasswordRequired = true;

    if (!cachedMasterPassword) {
        throw new Error('ENCRYPTION_LOCKED: Master password required');
    }
    if (!passwordSaltBase64) {
        throw new Error('CORRUPTION: Master password salt missing');
    }

    const passwordSalt = base64ToBytes(passwordSaltBase64);
    // PBKDF2キー導出を直接使用（マスターパスワードベース）
    // セッションタイムアウトチェックを開始（まだ開始していない場合）
    // Note: Session timeoutはchrome.alarms APIに移行済み（sessionAlarmsManager.ts）
    return deriveKeyFromPassword(cachedMasterPassword, passwordSalt);
}

/**
 * 直前のバージョンでsession storageに一時的に移されたsecretを返す（救済マイグレーション）。
 * PBI 25-25: local への保存は行わない — 呼び出し側が envelope 化して保存する。
 * アップデートを跨いでsession storageが既にクリアされてしまったユーザーは復旧できない
 * （＝暗号化済みAPIキーの再入力が必要）。
 * @returns 復元できた場合はsecret、できなかった場合はundefined
 */
async function restoreSecretFromSessionIfPresent(): Promise<string | undefined> {
    if (!chrome.storage.session) return undefined;

    const sessionResult = await chrome.storage.session.get(StorageKeys.ENCRYPTION_SECRET);
    const sessionSecret = sessionResult[StorageKeys.ENCRYPTION_SECRET] as string | undefined;
    if (!sessionSecret) return undefined;

    return sessionSecret;
}

/** 初回: ランダムなソルトとシークレットを生成し、ラップ済み envelope として保存する。 */
async function generateAndPersistSecret(): Promise<{ saltBase64: string; secret: string }> {
    const salt = generateSalt();
    const saltBase64 = bytesToBase64(salt);
    // 32バイトのランダムシークレットを生成
    const secretBytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = bytesToBase64(secretBytes);

    // PBI 25-25: 平文 Base64 を local に置かない。専用 KEK でラップした
    // envelope のみ保存する。KEK 利用不可時は fail closed（明示エラー） —
    // 平文保存へのフォールバックも自動再生成も行わない。
    const kek = await getOrCreateSecretWrappingKey();
    if (!kek) {
        throw new Error('ENCRYPTION_UNAVAILABLE: secret wrapping key unavailable (IndexedDB)');
    }
    const envelope = await wrapSecretWithKey(secret, kek);

    await chrome.storage.local.set({
        [StorageKeys.ENCRYPTION_SALT]: saltBase64,
        [StorageKeys.ENCRYPTION_SECRET]: envelope,
    });

    return { saltBase64, secret };
}

/**
 * 保存済み secret を envelope へ移行する。unwrap 確認後にだけ保存し、
 * 確認前は平文を除去しない（移行失敗で API キーを失わない順序）。
 * KEK 利用不可時は移行を延期し、legacy 導出を継続する。
 */
async function migrateLegacySecretToEnvelope(legacySecret: string): Promise<void> {
    const kek = await getOrCreateSecretWrappingKey();
    if (!kek) {
        // Not fail-closed: the legacy plaintext still decrypts every stored API
        // key, so refusing here would lock the user out of data they can read.
        // Deferring keeps the read path working; the next call migrates.
        logDebug('Secret migration deferred: wrapping key unavailable', undefined);
        return;
    }
    const envelope = await wrapSecretWithKey(legacySecret, kek);
    // Verify before replacing: an envelope that does not unwrap must never
    // displace the working plaintext.
    const roundTripped = await unwrapSecretWithKey(envelope, kek);
    if (roundTripped !== legacySecret) {
        throw new Error('ENCRYPTION_MIGRATION_FAILED: envelope round-trip mismatch');
    }
    await chrome.storage.local.set({ [StorageKeys.ENCRYPTION_SECRET]: envelope });
}

/**
 * マスターパスワード未設定時のキー取得（従来方式、マイグレーション準備）。
 *
 * 【重要】ENCRYPTION_SECRET は chrome.storage.local に保存する。
 * chrome.storage.session は拡張機能のアップデート時にクリアされる
 * ("session" storage area, cleared on extension update per Chrome's
 * Storage API contract) ため、ここに秘密を置くと updateのたびに
 * 秘密が失われ、既存の暗号化済みAPIキー（Obsidian/AI providerの
 * トークン）が復号不能になりデータロスを引き起こす（2026-08-12
 * インシデント: v6.7.42アップデート後にAPIキーが消失した報告）。
 *
 * session→local復元と新規secret生成は排他制御する。ロック待ち中に
 * 別の呼び出しが復元・生成を完了させている可能性があるため、ロック
 * 取得後は必ず chrome.storage.local を読み直す（ダブルチェック）。
 */
async function getOrCreateAnonymousSecretKey(): Promise<CryptoKey> {
    await encryptionKeyMutex.acquire();
    try {
        // 別の呼び出しがロック内で既にキー導出（PBKDF2, ~100k iterations）を
        // 完了させている場合、そのキャッシュを再利用して重複導出を避ける。
        if (cachedEncryptionKey) {
            return cachedEncryptionKey;
        }

        const recheck = await chrome.storage.local.get([
            StorageKeys.ENCRYPTION_SALT,
            StorageKeys.ENCRYPTION_SECRET,
        ]);
        let saltBase64 = recheck[StorageKeys.ENCRYPTION_SALT] as string;
        const storedSecret = recheck[StorageKeys.ENCRYPTION_SECRET] as string | SecretEnvelope | undefined;
        let secret: string | undefined;

        if (saltBase64 && !storedSecret) {
            const restored = await restoreSecretFromSessionIfPresent();
            if (restored !== undefined) {
                secret = restored;
                // Session-rescued plaintext takes the same envelope road as
                // legacy secrets — but durability wins over wrapping. Without a
                // KEK the only copy would stay in chrome.storage.session, which
                // Chrome clears on restart or update; a later read would then
                // find a salt with no secret and regenerate the pair, orphaning
                // every API key encrypted under the lost one. So keep the
                // pre-PBI-25-25 behavior (plaintext in local) and wrap it on a
                // later call.
                const kek = await getOrCreateSecretWrappingKey();
                if (!kek) {
                    await chrome.storage.local.set({ [StorageKeys.ENCRYPTION_SECRET]: restored });
                    await chrome.storage.session.remove(StorageKeys.ENCRYPTION_SECRET);
                } else {
                    const envelope = await wrapSecretWithKey(restored, kek);
                    if ((await unwrapSecretWithKey(envelope, kek)) === restored) {
                        await chrome.storage.local.set({ [StorageKeys.ENCRYPTION_SECRET]: envelope });
                        await chrome.storage.session.remove(StorageKeys.ENCRYPTION_SECRET);
                    }
                }
            }
        }

        if (storedSecret !== undefined && !secret) {
            if (isSecretEnvelope(storedSecret)) {
                // Wrapped envelope: unwrap with the dedicated KEK. KEK loss
                // is fail-closed — explicit error, no regeneration (which
                // would orphan existing encrypted API keys), no deletion.
                const kek = await loadSecretWrappingKey();
                if (!kek) {
                    throw new Error('ENCRYPTION_UNAVAILABLE: secret wrapping key unavailable (IndexedDB)');
                }
                secret = await unwrapSecretWithKey(storedSecret, kek);
            } else if (typeof storedSecret === 'string') {
                // Legacy plaintext: keep serving it (no data loss), then
                // migrate to an envelope when the KEK is available.
                secret = storedSecret;
                await migrateLegacySecretToEnvelope(storedSecret);
            }
        }

        if (!saltBase64 && storedSecret !== undefined) {
            // Salt and secret are written in one set(), so a stored secret
            // without its salt means the record is damaged. Generating a fresh
            // pair here would replace the only copy of the wrapped secret and
            // orphan every API key encrypted under it, so report the
            // corruption instead — the same reason the KEK path above refuses
            // to regenerate. (A fresh install has neither key and still
            // generates normally.)
            throw new Error('CORRUPTION: encryption salt missing');
        }

        if (saltBase64 && !secret) {
            // Session rescue found nothing. Generating a pair here would
            // overwrite the existing salt and orphan every API key encrypted
            // under it, so report the corruption and leave storage untouched.
            throw new Error('CORRUPTION: encryption secret missing');
        }

        if (!saltBase64 || !secret) {
            ({ saltBase64, secret } = await generateAndPersistSecret());
        }

        const salt = base64ToBytes(saltBase64);

        // ランダムなsecretとsaltからPBKDF2でキー導出
        cachedEncryptionKey = await deriveKey(secret, salt);
        return cachedEncryptionKey;
    } finally {
        encryptionKeyMutex.release();
    }
}

// ============================================================================
// KEK rotation — shared re-encryption procedure for set / change / remove
// ============================================================================

// Keys dropped when master-password protection is removed (adjudicated 4-key contract).
const DISABLE_REMOVED_KEYS = [
  StorageKeys.MASTER_PASSWORD_ENABLED,
  StorageKeys.MASTER_PASSWORD_SALT,
  StorageKeys.MASTER_PASSWORD_HASH,
  StorageKeys.IS_LOCKED,
] as const;

/**
 * Run fn, restoring the session key cache if it throws. Key resolution
 * during rotation (notably the anonymous KEK) populates the module cache as
 * a side effect; on abort the pre-call session must stand, otherwise the next
 * reader silently uses the wrong KEK. Success paths set their final cache
 * state explicitly after this returns.
 */
async function withPreservedSessionCache<T>(fn: () => Promise<T>): Promise<T> {
  const savedPassword = cachedMasterPassword;
  const savedKey = cachedEncryptionKey;
  try {
    return await fn();
  } catch (e) {
    cachedMasterPassword = savedPassword;
    cachedEncryptionKey = savedKey;
    throw e;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Read both API-key placements in one round trip. */
async function readApiKeyPlacements(
  port: StoragePort,
): Promise<{ nested: Record<string, unknown> | undefined; scattered: Record<string, unknown> }> {
  const stored = await port.get(['settings', ...API_KEY_FIELD_NAMES]);
  const scattered: Record<string, unknown> = {};
  for (const field of API_KEY_FIELD_NAMES) {
    if (Object.prototype.hasOwnProperty.call(stored, field)) {
      scattered[field] = stored[field];
    }
  }
  return { nested: asRecord(stored['settings']), scattered };
}

/**
 * Move every canonical API-key ciphertext from the previous KEK to the next
 * one, across both the nested `settings` blob and legacy scattered keys.
 *
 * Fixed order (adjudicated): read both placements → decrypt everything with
 * the old KEK (abort on the first failure, zero writes) → re-encrypt with the
 * next KEK → delta write → read back and verify under the next KEK. Auth
 * metadata is never touched here; callers update it only after this resolves.
 *
 * Keys resolve lazily so a run with no ciphertext performs one storage read
 * and derives nothing (no PBKDF2, no secret generation).
 */
async function reencryptApiKeysToKek(options: {
  resolveKeys: () => Promise<{ previous: CryptoKey; next: CryptoKey }>;
  port?: StoragePort;
}): Promise<void> {
  const port: StoragePort = options.port ?? new ChromeStoragePort();
  const { nested, scattered } = await readApiKeyPlacements(port);
  const targets = collectApiKeyTargets(nested, scattered);
  if (!targets.some((t) => isEncrypted(t.value))) {
    return;
  }

  const keys = await options.resolveKeys();
  const trialDecrypt: TrialDecrypt = async (value, key) => {
    try {
      return await decryptApiKey(value, key);
    } catch {
      return null;
    }
  };
  const plan = await planKekTransition(targets, keys, trialDecrypt);
  if (plan.unrecoverable.length > 0) {
    const fields = [...new Set(plan.unrecoverable.map((u) => u.field))];
    throw new ReencryptionAbortedError(fields);
  }

  const nestedDelta: Record<string, unknown> = {};
  const scatteredDelta: Record<string, unknown> = {};
  for (const item of plan.toReencrypt) {
    const reencrypted = await encryptApiKey(item.plaintext, keys.next);
    (item.placement === 'nested' ? nestedDelta : scatteredDelta)[item.field] = reencrypted;
  }
  if (Object.keys(nestedDelta).length > 0) {
    // Delta-only write through the transaction (persistReEncrypted precedent):
    // never spread a cached snapshot, and never route EncryptedData objects
    // through writeSettings (its keyProvider resolves before auth metadata
    // exists and would fail closed mid-rotation).
    const tx = new StorageTransaction(port);
    await tx.withLock<Record<string, unknown>>('settings', (current) => ({ ...(current ?? {}), ...nestedDelta }));
  }
  if (Object.keys(scatteredDelta).length > 0) {
    // Single set without per-field withLock: field-level locks would write
    // `<field>_version` CAS records into user-visible storage.
    await port.set(scatteredDelta);
  }
  // Drop the repository cache right after writing (before verification), so a
  // failed read-back never leaves readers on the pre-rotation snapshot.
  const { settingsRepository } = await import('./SettingsRepository.js');
  settingsRepository.clearCache();

  // Durable confirmation under the next KEK before any metadata change.
  const reread = await readApiKeyPlacements(port);
  const byLocation = new Map(
    collectApiKeyTargets(reread.nested, reread.scattered).map((t) => [`${t.placement}:${t.field}`, t.value]),
  );
  for (const item of plan.toReencrypt) {
    const current = byLocation.get(`${item.placement}:${item.field}`);
    let roundTripped: string | null = null;
    if (isEncrypted(current)) {
      try {
        roundTripped = await decryptApiKey(current, keys.next);
      } catch {
        roundTripped = null;
      }
    }
    if (roundTripped === null || !(await constantTimeCompare(roundTripped, item.plaintext))) {
      throw new Error(`REENCRYPT_VERIFY_FAILED: read-back mismatch for field ${item.field}`);
    }
  }
}

/**
 * Shared set/change body: rotate all API keys to a KEK derived from
 * `password`, then persist the new auth metadata in one write.
 *
 * The new salt is anchored in `MASTER_PASSWORD_PENDING_SALT` before any
 * ciphertext moves, and deleted only once the metadata carries it — so an
 * interrupted run re-derives the identical next KEK on retry (resume), while
 * a run that never reaches the metadata write leaves the anchor for the next
 * attempt instead of stranding migrated items.
 */
async function rotateToNewMasterPassword(options: {
  password: string;
  resolvePrevious: () => Promise<CryptoKey>;
  lockAfter: boolean;
}): Promise<void> {
  const policy = validatePasswordPolicy(options.password);
  if (!policy.ok) {
    throw new Error(policy.reason);
  }
  const port = new ChromeStoragePort();
  const anchored = await port.get(StorageKeys.MASTER_PASSWORD_PENDING_SALT);
  const anchoredSalt = anchored[StorageKeys.MASTER_PASSWORD_PENDING_SALT] as string | undefined;
  const saltBase64 = anchoredSalt ?? bytesToBase64(generateSalt());
  if (anchoredSalt === undefined) {
    await port.set({ [StorageKeys.MASTER_PASSWORD_PENDING_SALT]: saltBase64 });
  }
  const salt = base64ToBytes(saltBase64);
  const hash = await hashPasswordWithPBKDF2(options.password, salt);
  try {
    await withPreservedSessionCache(async () => {
      // resolvePrevious stays inside the lazy resolver: a run with no
      // ciphertext must derive nothing (fast path inside reencryptApiKeysToKek).
      await reencryptApiKeysToKek({
        resolveKeys: async () => ({
          previous: await options.resolvePrevious(),
          next: await deriveKeyFromPassword(options.password, salt, ENVELOPE_ITERATIONS),
        }),
        port,
      });
      await chrome.storage.local.set({
        [StorageKeys.MASTER_PASSWORD_ENABLED]: true,
        [StorageKeys.MASTER_PASSWORD_SALT]: saltBase64,
        [StorageKeys.MASTER_PASSWORD_HASH]: hash,
        [StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS]: ENVELOPE_ITERATIONS,
        [StorageKeys.IS_LOCKED]: options.lockAfter,
      });
    });
  } finally {
    const meta = await chrome.storage.local.get(StorageKeys.MASTER_PASSWORD_SALT);
    if (meta[StorageKeys.MASTER_PASSWORD_SALT] === saltBase64) {
      if (port.remove) await port.remove(StorageKeys.MASTER_PASSWORD_PENDING_SALT);
      else throw new Error('StoragePort.remove is required to clean up the rotation anchor');
    }
  }
}

// ============================================================================
// Public interface
// ============================================================================

/**
 * 暗号化キーを取得または作成する
 *
 * 【セキュリティ修正】マスターパスワードが設定されている場合、マスターパスワードからキーを導出
 * マスターパスワード未設定の場合は従来の方式でマイグレーション準備
 *
 * @returns {Promise<CryptoKey>} 導出された暗号化キー
 * @throws {Error} ロックされている場合（マスターパスワード未入力）
 */
export async function getOrCreateEncryptionKey(): Promise<CryptoKey> {
    // VULN-017 fix: check IS_LOCKED before returning cached key.
    if (cachedEncryptionKey) {
        if (await authGuardIsLocked()) {
            cachedEncryptionKey = null;
            cachedMasterPassword = null;
            throw new Error('ENCRYPTION_LOCKED: Session is locked');
        }
        return cachedEncryptionKey;
    }

    // マスターパスワード設定状態を確認
    const result = await chrome.storage.local.get([
        StorageKeys.MASTER_PASSWORD_ENABLED,
        StorageKeys.MASTER_PASSWORD_SALT,
    ]);

    const masterPasswordEnabled = result[StorageKeys.MASTER_PASSWORD_ENABLED] as boolean;

    if (masterPasswordEnabled) {
        cachedEncryptionKey = await deriveKeyFromMasterPassword(result[StorageKeys.MASTER_PASSWORD_SALT] as string | undefined);
        return cachedEncryptionKey;
    }

    return getOrCreateAnonymousSecretKey();
}

/**
 * マスターパスワードが設定されているか確認
 * @returns {Promise<boolean>} マスターパスワードが設定済みの場合true
 */
export async function isMasterPasswordEnabled(): Promise<boolean> {
    const result = await chrome.storage.local.get(StorageKeys.MASTER_PASSWORD_ENABLED);
    return Boolean(result[StorageKeys.MASTER_PASSWORD_ENABLED]);
}

/**
 * 暗号化がロックされているか確認（マスターパスワード未入力）
 * @returns {Promise<boolean>} ロックされている場合true
 */
export async function isEncryptionLocked(): Promise<boolean> {
    const enabled = await isMasterPasswordEnabled();
    return isMasterPasswordRequired && enabled && !cachedMasterPassword;
}

/**
 * マスターパスワードを設定する
 *
 * 既存 API キーは旧 KEK（未設定時は匿名 KEK）から新 KEK へ再暗号化される。
 * 認証メタデータは read back 確認が通るまで書かない。
 * @param {string} password - マスターパスワード
 * @returns {Promise<boolean>} 成功した場合true
 */
export async function setMasterPassword(password: string): Promise<boolean> {
    await rotateToNewMasterPassword({
        password,
        resolvePrevious: () => getOrCreateEncryptionKey(),
        lockAfter: true,
    });

    // 【セキュリティ修正】設定時はパスワードキャッシュをクリア（ロック状態で開始）
    cachedMasterPassword = null;
    isMasterPasswordRequired = true;

    // キャッシュをクリア
    cachedEncryptionKey = null;

    // Keep scoring for logInfo (strength still computed via shared scorer)
    const strength = calculatePasswordStrength(password);
    await logInfo(
        'Master password set',
        { strength: strength.score, level: strength.level },
        'storage/encryptionSession.ts'
    );

    return true;
}

/**
 * マスターパスワードを検証し、セッションをアンロックする
 * @param {string} password - マスターパスワード
 * @returns {Promise<boolean>} 成功した場合true
 */
export async function unlockWithPassword(password: string): Promise<boolean> {
    // VULN-018 fix: check rate limit before attempting password verification
    const rateLimitResult = await checkRateLimit();
    if (!rateLimitResult.success) {
        throw new Error(rateLimitResult.error || 'Too many attempts. Please try again later.');
    }

    const result = await chrome.storage.local.get([
        StorageKeys.MASTER_PASSWORD_HASH,
        StorageKeys.MASTER_PASSWORD_SALT,
        StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS,
        StorageKeys.MASTER_PASSWORD_ENABLED
    ]);

    const enabled = result[StorageKeys.MASTER_PASSWORD_ENABLED] as boolean;
    if (!enabled) {
        throw new Error('Master password not enabled');
    }

    const storedHash = result[StorageKeys.MASTER_PASSWORD_HASH] as string;
    const saltBase64 = result[StorageKeys.MASTER_PASSWORD_SALT] as string;
    const storedIterations = result[StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS] as number | undefined;

    if (!storedHash || !saltBase64) {
        throw new Error('Master password data corrupted');
    }

    const salt = base64ToBytes(saltBase64);
    // Pass stored iterations to enable constant-time verification:
    // when iterations is known, only one PBKDF2 pass is needed.
    const verifyResult = await verifyPasswordWithPBKDF2(password, storedHash, salt, storedIterations);

    if (verifyResult.isValid) {
        // VULN-019 fix: re-hash with new iteration count if legacy hash was used
        if (verifyResult.needsRehash) {
            const newHash = await hashPasswordWithPBKDF2(password, salt);
            await chrome.storage.local.set({
                [StorageKeys.MASTER_PASSWORD_HASH]: newHash,
                [StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS]: ENVELOPE_ITERATIONS,
            });
            logInfo('Migrated master password hash to stronger KDF (600,000 iterations)');
        }
        // VULN-018 fix: reset failed attempts on successful authentication
        await resetFailedAttempts();
        // アクティビティ通知を送信（sessionAlarmsManager.tsへ）
        sendFromPopup('ACTIVITY_UPDATE', {}).catch((error) => {
            // 送信失敗は無視（Service Workerが起動していない可能性）
            logDebug('Failed to send activity update', { error: error.message }, 'storage/encryptionSession.ts');
        });
        cachedMasterPassword = password;
        cachedEncryptionKey = null; // 新しいキーを生成するためにキャッシュをクリア
        await chrome.storage.local.set({ [StorageKeys.IS_LOCKED]: false });
        return true;
    }

    // VULN-018 fix: record failed attempt
    await recordFailedAttempt();
    return false;
}

/**
 * セッションをロックする（マスターパスワードキャッシュをクリア）
 */
export async function lockSession(): Promise<void> {
    cachedMasterPassword = null;
    cachedEncryptionKey = null;
    await chrome.storage.local.set({ [StorageKeys.IS_LOCKED]: true });
}

/**
 * マスターパスワードを再設定する（古いパスワード検証後）
 *
 * 既存 API キーは旧パスワード由来 KEK から新 KEK へ再暗号化される。
 * unlock は1回だけ呼ぶ（以前は新パスワードでも unlock していたが、read back
 * 確認が同等の保証をするため、レート制限の二重計上と KDF 2 回分を避ける）。
 * @param {string} oldPassword - 現在のマスターパスワード
 * @param {string} newPassword - 新しいパスワード
 * @returns {Promise<boolean>} 成功した場合true
 */
export async function changeMasterPassword(oldPassword: string, newPassword: string): Promise<boolean> {
    // まず古いパスワードでアンロック試行
    const isValid = await unlockWithPassword(oldPassword);
    if (!isValid) {
        return false;
    }

    await rotateToNewMasterPassword({
        password: newPassword,
        // Session already holds the old KEK after unlock: no extra KDF.
        resolvePrevious: () => getOrCreateEncryptionKey(),
        lockAfter: false,
    });

    // Take over the session with the new password (replaces the removed
    // second unlockWithPassword call and its extra KDF + rate-limit count).
    cachedMasterPassword = newPassword;
    cachedEncryptionKey = null;
    await logInfo('Master password changed', {}, 'storage/encryptionSession.ts');
    return true;
}

/**
 * マスターパスワード設定を解除する（API キーは匿名 KEK へ再暗号化して保持）
 *
 * 復号不能な項目が1件でもあれば ReencryptionAbortedError を投げ、認証
 * メタデータと元 ciphertext には一切触れない。
 * NOTE: rate limiting is the caller's job — the dashboard checks it in the
 * auth modal before calling. Direct callers (e.g. future message handlers)
 * must rate-limit the password attempts themselves.
 * @param {string} [password] - 現在のマスターパスワード（dashboard の認証モーダルが渡す）。省略時はセッションキャッシュを使う
 */
export async function removeMasterPassword(password?: string): Promise<void> {
    const meta = await chrome.storage.local.get([
        StorageKeys.MASTER_PASSWORD_ENABLED,
        StorageKeys.MASTER_PASSWORD_SALT,
        StorageKeys.MASTER_PASSWORD_HASH,
        StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS,
    ]);
    if (!meta[StorageKeys.MASTER_PASSWORD_ENABLED]) {
        // Idempotent cleanup when no master password is set: nothing is
        // encrypted under a master KEK, so there is nothing to migrate.
        await chrome.storage.local.remove([...DISABLE_REMOVED_KEYS]);
        cachedMasterPassword = null;
        isMasterPasswordRequired = false;
        cachedEncryptionKey = null;
        return;
    }
    const storedHash = meta[StorageKeys.MASTER_PASSWORD_HASH] as string | undefined;
    const saltBase64 = meta[StorageKeys.MASTER_PASSWORD_SALT] as string | undefined;
    const storedIterations = meta[StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS] as number | undefined;
    if (!storedHash || !saltBase64) {
        throw new Error('CORRUPTION: master password metadata incomplete');
    }
    const oldPassword = password ?? cachedMasterPassword;
    if (!oldPassword) {
        throw new Error('ENCRYPTION_LOCKED: Master password required');
    }
    const saltBytes = base64ToBytes(saltBase64);
    return withPreservedSessionCache(async () => {
        // Self-verify without a full unlock: the dashboard already rate-limits,
        // and flipping IS_LOCKED here would add writes before confirmation.
        const verifyResult = await verifyPasswordWithPBKDF2(
            oldPassword,
            storedHash,
            saltBytes,
            storedIterations
        );
        if (!verifyResult.isValid) {
            throw new Error('Incorrect password');
        }
        const previous = await deriveKeyFromPassword(oldPassword, saltBytes, storedIterations);
        // Drop the session key cache before resolving the next KEK:
        // getOrCreateAnonymousSecretKey() short-circuits on a cached key, and the
        // cache currently holds the master-derived key. Resolving "anonymous"
        // against it would re-encrypt under the same KEK being removed and strand
        // every API key. Previous is already derived above, so clearing is safe.
        clearEncryptionKeyCache();
        const next = await getOrCreateAnonymousSecretKey();
        await reencryptApiKeysToKek({ resolveKeys: async () => ({ previous, next }) });

        await chrome.storage.local.remove([...DISABLE_REMOVED_KEYS]);

        cachedMasterPassword = null;
        isMasterPasswordRequired = false;
        cachedEncryptionKey = null;
    });
}

/**
 * 暗号化キーのキャッシュをクリアする（テスト用）
 */
export function clearEncryptionKeyCache(): void {
    cachedEncryptionKey = null;
    cachedMasterPassword = null;
    cachedHmacSecret = null;
}

/**
 * HMAC Secretを取得または作成する。
 * chrome.storage.local には AES-GCM でラップした envelope 形式でのみ保存し、
 * 平文base64は保存しない（設定インポート署名鍵の漏洩耐性のため）。
 * 旧形式（平文base64）が見つかった場合は透過的にラップ形式へ移行する。
 * @returns {Promise<string>} HMACシークレット（呼び出し元には従来通り平文文字列を返す）
 */
export async function getOrCreateHmacSecret(): Promise<string> {
    if (cachedHmacSecret) {
        return cachedHmacSecret;
    }

    const result = await chrome.storage.local.get(StorageKeys.HMAC_SECRET);
    const stored = result[StorageKeys.HMAC_SECRET];

    let secret: string;

    if (isWrappedSecretString(stored)) {
        try {
            secret = await unwrapSecretString(stored);
        } catch (e) {
            // The KEK lives in chrome.storage.session and is cleared on browser/
            // extension restart, so unwrapping an already-wrapped secret can fail
            // for existing users. Self-heal instead of throwing: generate a fresh
            // secret and persist it wrapped (mirrors hmacKeyStore recovery).
            const { ErrorCode } = await import('../logger/types.js');
const { logError } = await import('../logger/api.js');
            const { errorMessage } = await import('../errorUtils.js');
            await logError('Failed to unwrap HMAC secret, regenerating', { error: errorMessage(e as Error) }, ErrorCode.CRYPTO_ENCRYPTION_FAILURE);
            const secretBytes = crypto.getRandomValues(new Uint8Array(32));
            secret = bytesToBase64(secretBytes);
            const wrapped = await wrapSecretString(secret);
            await chrome.storage.local.set({ [StorageKeys.HMAC_SECRET]: wrapped });
        }
    } else if (typeof stored === 'string' && stored.length > 0) {
        // Legacy plaintext secret: migrate to wrapped form.
        secret = stored;
        const wrapped = await wrapSecretString(secret);
        await chrome.storage.local.set({ [StorageKeys.HMAC_SECRET]: wrapped });
    } else {
        // 32バイトのランダムシークレットを生成
        const secretBytes = crypto.getRandomValues(new Uint8Array(32));
        secret = bytesToBase64(secretBytes);

        const wrapped = await wrapSecretString(secret);
        await chrome.storage.local.set({ [StorageKeys.HMAC_SECRET]: wrapped });
    }

    cachedHmacSecret = secret;
    return secret;
}

/**
 * Signer for settings and log exports.
 *
 * Standard base64, because these signatures are written into files the user
 * downloads — switching the encoding would make every previously exported
 * backup fail verification on restore.
 *
 * The secret is resolved per call so a rotation (or a cache cleared by a
 * service worker restart) is picked up without rebuilding the signer.
 */
export const exportHmacSigner: HmacSigner = hmacSignerForSecret(getOrCreateHmacSecret, 'base64');

