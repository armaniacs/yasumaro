/**
 * encryptedBackupSplitCodec.ts
 * PBI01: 暗号化バックアップの分割コーデック。
 *
 * 単一 EncryptionEnvelope 形式では汎用上限に収まらない大容量バックアップを、
 * 複数のパートに分割して運ぶ。マニフェストの
 * 作成、パート分割、結合、検証を encryptedBackupService から分離した純粋な
 * コーデックであり、chrome API や storage には依存しない。
 *
 * コンテナ形式:
 * - manifest: 版数、出力日時、設定本体、パート数、各パート長、
 *   全体平文長、結合用 ID、圧縮方式、復号後バイト長、パート鍵の導出情報と
 *   方式を保持する暗号化エンベロープ
 * - parts: historyDbBase64（またはその gzip 圧縮体）の断片を保持する
 *   暗号化エンベロープの配列。現行方式 (shared-pbkdf2-v1) では全パートが
 *   同一ソルトを共有し、合言葉からの鍵導出は1回だけ行い、各パートはその鍵
 *   とパートごとの IV で直接 AES-GCM 暗号化する。各パートの暗号化対象には
 *   index、total、manifestId を含め、順序入替と切詰めを検出する
 * - 旧方式のパートはパートごとに独立ソルトの EncryptionEnvelope
 *   （パートごとに PBKDF2）。parseSplitBackup は後方互換のため両方式を読む
 */

import {
  encryptEnvelope,
  decryptEnvelope,
  isEncryptionEnvelope,
  bytesToBase64,
  base64ToBytes,
  deriveKey,
  generateSalt,
  generateIV,
  ENVELOPE_ITERATIONS,
  CURRENT_ENVELOPE_VERSION,
  type EncryptionEnvelope,
} from '../utils/crypto/index.js';
import { getWebCrypto, MAX_KDF_ITERATIONS } from '../utils/crypto/primitives.js';
import { MAX_ENVELOPE_BASE64_LENGTH, MAX_BACKUP_FILE_BYTES } from '../utils/limits.js';

export const SPLIT_BACKUP_KIND = 'encrypted-split-backup';
export const SPLIT_BACKUP_FORMAT_VERSION = 1;
export const SPLIT_MANIFEST_KIND = 'split-backup-manifest';
export const SPLIT_PART_KIND = 'split-backup-part';

/** 現行のパート暗号化方式。マニフェストに記録する。 */
export const SPLIT_PART_MODE_SHARED_V1 = 'shared-pbkdf2-v1';
const SPLIT_PART_KEY_HASH = 'SHA-256';
const SPLIT_PART_KEY_KDF = 'pbkdf2';
const ENCRYPTION_ALGORITHM = 'AES-GCM';

/** KDF 回数の上限代わりに復号試行回数を抑えるためのパート数上限。 */
export const MAX_SPLIT_PART_COUNT = 16;

const GCM_TAG_BYTES = 16;
const PART_JSON_SLACK_BYTES = 2048;

/**
 * 1 パートの平文予算。汎用エンベロープ上限から逆算するため、分割しても
 * 各パートの base64 長が汎用上限内に収まる。上限を緩和しない。
 */
export const SPLIT_PART_PLAINTEXT_BUDGET =
  Math.floor((MAX_ENVELOPE_BASE64_LENGTH * 3) / 4) - GCM_TAG_BYTES - PART_JSON_SLACK_BYTES;

export type SplitBackupCompression = 'gzip' | 'none';

/** マニフェストに同梱するパート共有鍵の導出情報。 */
export interface SplitBackupPartKey {
  kdf: 'pbkdf2';
  hash: string;
  iterations: number;
  salt: string;
}

export interface SplitBackupInput {
  version: number;
  exportedAt: string;
  settings: unknown;
  historyDbBase64: string;
}

export interface SplitBackupManifest {
  kind: typeof SPLIT_MANIFEST_KIND;
  version: number;
  exportedAt: string;
  manifestId: string;
  total: number;
  partLengths: number[];
  totalPlaintextLength: number;
  compression: SplitBackupCompression;
  originalByteLength: number;
  settings: unknown;
  /** 現行方式でのみ存在。欠落時は旧来の per-part-KDF 形式として読む。 */
  partMode?: string;
  partKey?: SplitBackupPartKey;
}

export interface SplitBackupPartPayload {
  kind: typeof SPLIT_PART_KIND;
  index: number;
  total: number;
  manifestId: string;
  chunk: string;
}

export interface SplitBackupContainer {
  kind: typeof SPLIT_BACKUP_KIND;
  formatVersion: number;
  manifest: EncryptionEnvelope;
  parts: EncryptionEnvelope[];
}

export interface CreateSplitBackupOptions {
  /** テスト用の上書き。通常は SPLIT_PART_PLAINTEXT_BUDGET を使う。 */
  chunkChars?: number;
}

export interface ParseSplitBackupOptions {
  /** 呼び出し側のペイロード版数。指定時はマニフェスト版数と照合する。 */
  expectedVersion?: number;
}

export type SplitBackupFailureCode =
  | 'invalid-shape'
  | 'invalid-option'
  | 'too-large'
  | 'too-many-parts'
  | 'split-backup-too-large'
  | 'decrypt-failed'
  | 'invalid-manifest'
  | 'version-mismatch'
  | 'part-count-mismatch'
  | 'part-length-mismatch'
  | 'part-mismatch'
  | 'length-mismatch'
  | 'decompress-failed';

export class SplitBackupError extends Error {
  readonly code: SplitBackupFailureCode;
  readonly partIndex: number | undefined;
  /** Present only for split-backup-too-large: lets the UI show how far over the budget the container is. */
  readonly detail: { joinedBodyChars: number; capChars: number } | undefined;

  constructor(
    code: SplitBackupFailureCode,
    message: string,
    partIndex?: number,
    detail?: { joinedBodyChars: number; capChars: number },
  ) {
    super(message);
    this.name = 'SplitBackupError';
    this.code = code;
    this.partIndex = partIndex;
    this.detail = detail;
  }
}

function isRecord(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null;
}

/**
 * Display fields for the split-backup-too-large gate. Chars are the
 * post-compression base64 body, so the byte-equivalent label scales them
 * back by 3/4 and rounds up — an approximate size is enough for the user to
 * decide "organize the history", and the raw char count would be misleading.
 * Returns null for other failures or when no budget detail was attached, so
 * callers fall back to the generic message.
 */
export function splitTooLargeBudgetFields(error: unknown): { size: string; limit: string } | null {
  if (!(error instanceof SplitBackupError) || error.code !== 'split-backup-too-large' || !error.detail) {
    return null;
  }
  const toMbLabel = (chars: number) => `${Math.ceil((chars * 3) / 4 / (1024 * 1024))} MB`;
  return {
    size: toMbLabel(error.detail.joinedBodyChars),
    limit: toMbLabel(error.detail.capChars),
  };
}

export function isSplitBackupContainer(data: unknown): data is SplitBackupContainer {
  if (!isRecord(data)) return false;
  return (
    data['kind'] === SPLIT_BACKUP_KIND &&
    data['formatVersion'] === SPLIT_BACKUP_FORMAT_VERSION &&
    isRecord(data['manifest']) &&
    Array.isArray(data['parts'])
  );
}

function randomManifestId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function pumpStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  reader.releaseLock();
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function gzipBytes(input: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('gzip');
  // WHY read concurrently with the write: a single large write can fill the
  // transform queue and stall writer.write until the readable side drains.
  const reading = pumpStream(stream.readable);
  const writer = stream.writable.getWriter();
  try {
    // WHY assertion, not Uint8Array.from: the writer only reads the view, so a
    // copy would double peak memory on multi-MB inputs for no safety gain.
    await writer.write(input as Uint8Array<ArrayBuffer>);
  } finally {
    await writer.close();
  }
  return reading;
}

async function gunzipBytes(input: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('gzip');
  const reading = pumpStream(stream.readable);
  const writer = stream.writable.getWriter();
  try {
    // WHY assertion, not Uint8Array.from: same zero-copy reason as gzipBytes.
    await writer.write(input as Uint8Array<ArrayBuffer>);
  } finally {
    await writer.close();
  }
  return reading;
}

function splitString(text: string, chunkChars: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkChars) {
    chunks.push(text.slice(i, i + chunkChars));
  }
  if (chunks.length === 0) chunks.push('');
  return chunks;
}

function resolveChunkChars(options?: CreateSplitBackupOptions): number {
  const chunkChars = options?.chunkChars ?? SPLIT_PART_PLAINTEXT_BUDGET;
  if (!Number.isInteger(chunkChars) || chunkChars < 1) {
    throw new SplitBackupError('invalid-option', 'chunkChars must be a positive integer');
  }
  return chunkChars;
}

function assertEnvelopeWithinGenericCap(envelope: unknown, partIndex?: number): asserts envelope is EncryptionEnvelope {
  if (!isEncryptionEnvelope(envelope)) {
    throw new SplitBackupError('invalid-shape', 'Split backup envelope has an invalid shape', partIndex);
  }
  // WHY the generic cap, not the backup cap: each part is small by
  // construction, so the VULN-036 pre-auth allocation budget stays at the
  // generic level instead of widening it per part.
  for (const field of ['salt', 'iv', 'data'] as const) {
    if (envelope[field].length > MAX_ENVELOPE_BASE64_LENGTH) {
      throw new SplitBackupError(
        'too-large',
        `Split backup envelope ${field} exceeds the generic length limit (${envelope[field].length} chars)`,
        partIndex,
      );
    }
  }
}

function parsePartKey(data: unknown): SplitBackupPartKey {
  if (!isRecord(data)) throw new SplitBackupError('invalid-manifest', 'Split backup part key is not an object');
  const kdf = data['kdf'];
  const hash = data['hash'];
  const iterations = data['iterations'];
  const salt = data['salt'];
  if (kdf !== SPLIT_PART_KEY_KDF) throw new SplitBackupError('invalid-manifest', 'Split backup part key has an unknown KDF');
  if (hash !== SPLIT_PART_KEY_HASH) {
    throw new SplitBackupError('invalid-manifest', 'Split backup part key has an unknown hash');
  }
  if (!Number.isInteger(iterations) || (iterations as number) < 1 || (iterations as number) > MAX_KDF_ITERATIONS) {
    throw new SplitBackupError('invalid-manifest', 'Split backup part key has invalid iterations');
  }
  if (typeof salt !== 'string' || salt.length === 0 || salt.length > MAX_ENVELOPE_BASE64_LENGTH) {
    throw new SplitBackupError('invalid-manifest', 'Split backup part key has an invalid salt');
  }
  try {
    base64ToBytes(salt);
  } catch {
    throw new SplitBackupError('invalid-manifest', 'Split backup part key salt is not valid base64');
  }
  return data as unknown as SplitBackupPartKey;
}

function parseManifest(data: unknown): SplitBackupManifest {
  if (!isRecord(data)) throw new SplitBackupError('invalid-manifest', 'Split backup manifest is not an object');
  const m = data as Record<string, unknown>;
  const valid =
    m['kind'] === SPLIT_MANIFEST_KIND &&
    typeof m['version'] === 'number' &&
    Number.isInteger(m['version']) &&
    typeof m['exportedAt'] === 'string' &&
    typeof m['manifestId'] === 'string' &&
    (m['manifestId'] as string).length > 0 &&
    typeof m['total'] === 'number' &&
    Number.isInteger(m['total']) &&
    (m['total'] as number) >= 1 &&
    Array.isArray(m['partLengths']) &&
    (m['partLengths'] as unknown[]).every((n) => typeof n === 'number' && Number.isInteger(n) && (n as number) >= 0) &&
    typeof m['totalPlaintextLength'] === 'number' &&
    Number.isInteger(m['totalPlaintextLength']) &&
    (m['totalPlaintextLength'] as number) >= 0 &&
    (m['compression'] === 'gzip' || m['compression'] === 'none') &&
    typeof m['originalByteLength'] === 'number' &&
    Number.isInteger(m['originalByteLength']) &&
    (m['originalByteLength'] as number) >= 0 &&
    isRecord(m['settings']);
  if (!valid) throw new SplitBackupError('invalid-manifest', 'Split backup manifest has invalid fields');
  const manifest = data as unknown as SplitBackupManifest;
  const hasMode = m['partMode'] !== undefined;
  const hasKey = m['partKey'] !== undefined;
  if (!hasMode && !hasKey) return manifest;
  if (m['partMode'] !== SPLIT_PART_MODE_SHARED_V1) {
    throw new SplitBackupError('invalid-manifest', 'Split backup manifest has an unknown part mode');
  }
  manifest.partKey = parsePartKey(m['partKey']);
  return manifest;
}

function parsePartPayload(data: unknown, position: number, bindPosition: boolean): SplitBackupPartPayload {
  if (!isRecord(data)) {
    throw new SplitBackupError('part-mismatch', `Split backup part ${position} is not an object`, position);
  }
  const p = data as Record<string, unknown>;
  const index = p['index'];
  const valid =
    p['kind'] === SPLIT_PART_KIND &&
    typeof index === 'number' &&
    Number.isInteger(index) &&
    (!bindPosition || index === position) &&
    typeof p['total'] === 'number' &&
    Number.isInteger(p['total']) &&
    typeof p['manifestId'] === 'string' &&
    typeof p['chunk'] === 'string';
  if (!valid) {
    throw new SplitBackupError(
      'part-mismatch',
      `Split backup part ${position} failed the index/total/manifest binding check`,
      position,
    );
  }
  return data as unknown as SplitBackupPartPayload;
}

function isSharedManifest(manifest: SplitBackupManifest): boolean {
  return manifest.partMode === SPLIT_PART_MODE_SHARED_V1 && manifest.partKey !== undefined;
}

async function encryptWithSharedKey(plaintext: string, key: CryptoKey, saltBase64: string): Promise<EncryptionEnvelope> {
  const iv = generateIV();
  const webcrypto = getWebCrypto();
  const ciphertext = await webcrypto.subtle.encrypt(
    { name: ENCRYPTION_ALGORITHM, iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    version: CURRENT_ENVELOPE_VERSION,
    kdf: SPLIT_PART_KEY_KDF,
    hash: SPLIT_PART_KEY_HASH,
    iterations: ENVELOPE_ITERATIONS,
    salt: saltBase64,
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptWithSharedKey(envelope: EncryptionEnvelope, key: CryptoKey): Promise<string> {
  const webcrypto = getWebCrypto();
  const plaintext = await webcrypto.subtle.decrypt(
    { name: ENCRYPTION_ALGORITHM, iv: base64ToBytes(envelope.iv) as BufferSource },
    key,
    base64ToBytes(envelope.data) as BufferSource,
  );
  return new TextDecoder().decode(plaintext);
}

function checkPayloadBinding(
  payload: SplitBackupPartPayload,
  manifest: SplitBackupManifest,
  position: number,
  chunks: string[],
): void {
  if (payload.total !== manifest.total) {
    throw new SplitBackupError(
      'part-mismatch',
      `Split backup part ${position} total ${payload.total} does not match manifest total ${manifest.total}`,
      position,
    );
  }
  if (payload.manifestId !== manifest.manifestId) {
    throw new SplitBackupError(
      'part-mismatch',
      `Split backup part ${position} belongs to another backup (manifest binding mismatch)`,
      position,
    );
  }
  if (payload.index < 0 || payload.index >= manifest.total) {
    throw new SplitBackupError(
      'part-mismatch',
      `Split backup part ${position} names an out-of-range index ${payload.index}`,
      position,
    );
  }
  if (chunks[payload.index] !== undefined) {
    throw new SplitBackupError(
      'part-mismatch',
      `Split backup part index ${payload.index} appears twice`,
      position,
    );
  }
  chunks[payload.index] = payload.chunk;
}

/**
 * バックアップ入力を分割コンテナにする。DB バイト列は暗号化前に gzip 圧縮を
 * 試み、縮む場合だけ併用する（base64 化より前の生バイトに対する圧縮が最も
 * 縮むことを実測で確認済み）。パート共有鍵は合言葉から1回だけ導出し、各
 * パートはその鍵とパートごとの IV で直接 AES-GCM 暗号化する（KDF 回数自体は
 * 下げない）。各パートは汎用上限内に収まることを作成時に断言する。
 */
export async function createSplitBackup(
  input: SplitBackupInput,
  password: string,
  options?: CreateSplitBackupOptions,
): Promise<SplitBackupContainer> {
  if (!isRecord(input) || !Number.isInteger(input['version']) || typeof input['exportedAt'] !== 'string') {
    throw new SplitBackupError('invalid-shape', 'Split backup input has an invalid shape');
  }
  if (!isRecord(input.settings)) {
    throw new SplitBackupError('invalid-shape', 'Split backup input settings must be an object');
  }
  if (typeof input.historyDbBase64 !== 'string') {
    throw new SplitBackupError('invalid-shape', 'Split backup input history must be a base64 string');
  }
  const chunkChars = resolveChunkChars(options);

  let rawBytes: Uint8Array;
  try {
    rawBytes = base64ToBytes(input.historyDbBase64);
  } catch {
    throw new SplitBackupError('invalid-shape', 'Split backup input history is not valid base64');
  }

  const compressed = await gzipBytes(rawBytes);
  const compressedBase64 = bytesToBase64(compressed);
  // WHY min-selection: random-looking DB pages can expand under gzip, so the
  // raw form stays available and the manifest records which one was stored.
  const useGzip = compressedBase64.length < input.historyDbBase64.length;
  const body = useGzip ? compressedBase64 : input.historyDbBase64;

  // WHY the create-side twin of parseSplitBackup's joined-length gate: a
  // container whose joined body exceeds MAX_BACKUP_FILE_BYTES could never be
  // restored (parse rejects manifest.totalPlaintextLength over the same
  // budget), so accepting it would break "a created backup always restores".
  // The cap measures the post-compression base64 body, not the raw DB size.
  if (body.length > MAX_BACKUP_FILE_BYTES) {
    throw new SplitBackupError(
      'split-backup-too-large',
      `Split backup joined body exceeds the backup file budget (${body.length} chars)`,
      undefined,
      { joinedBodyChars: body.length, capChars: MAX_BACKUP_FILE_BYTES },
    );
  }

  const chunks = splitString(body, chunkChars);
  if (chunks.length > MAX_SPLIT_PART_COUNT) {
    throw new SplitBackupError(
      'too-many-parts',
      `Split backup needs ${chunks.length} parts, above the cap of ${MAX_SPLIT_PART_COUNT}`,
    );
  }

  const manifestId = randomManifestId();
  const total = chunks.length;
  // WHY one KDF for all parts: per-part encryptEnvelope would run the full
  // PBKDF2 count on every part. All parts share one salt, so the same
  // iteration count yields one key for every part and the KDF invocations
  // drop from N+1 to 2 (shared part key + manifest). IVs stay unique per
  // part, so AES-GCM nonce reuse does not occur.
  const partSalt = generateSalt();
  const partSaltBase64 = bytesToBase64(partSalt);
  const partKey = await deriveKey(password, partSalt, ENVELOPE_ITERATIONS, SPLIT_PART_KEY_HASH);
  const parts: EncryptionEnvelope[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const payload: SplitBackupPartPayload = {
      kind: SPLIT_PART_KIND,
      index,
      total,
      manifestId,
      chunk,
    };
    const envelope = await encryptWithSharedKey(JSON.stringify(payload), partKey, partSaltBase64);
    if (envelope.data.length > MAX_ENVELOPE_BASE64_LENGTH) {
      throw new SplitBackupError(
        'too-large',
        `Split backup part ${index} exceeds the generic length limit (${envelope.data.length} chars)`,
        index,
      );
    }
    parts.push(envelope);
  }

  const manifest: SplitBackupManifest = {
    kind: SPLIT_MANIFEST_KIND,
    version: input.version,
    exportedAt: input.exportedAt,
    manifestId,
    total,
    partLengths: parts.map((p) => p.data.length),
    totalPlaintextLength: body.length,
    compression: useGzip ? 'gzip' : 'none',
    originalByteLength: rawBytes.length,
    settings: input.settings,
    partMode: SPLIT_PART_MODE_SHARED_V1,
    partKey: {
      kdf: SPLIT_PART_KEY_KDF,
      hash: SPLIT_PART_KEY_HASH,
      iterations: ENVELOPE_ITERATIONS,
      salt: partSaltBase64,
    },
  };
  const manifestEnvelope = await encryptEnvelope(JSON.stringify(manifest), password);
  if (manifestEnvelope.data.length > MAX_ENVELOPE_BASE64_LENGTH) {
    throw new SplitBackupError(
      'too-large',
      `Split backup manifest exceeds the generic length limit (${manifestEnvelope.data.length} chars)`,
    );
  }

  return {
    kind: SPLIT_BACKUP_KIND,
    formatVersion: SPLIT_BACKUP_FORMAT_VERSION,
    manifest: manifestEnvelope,
    parts,
  };
}

/**
 * 分割コンテナを結合してバックアップ入力に戻す。復号前ゲートの順序は単一形式
 * と同じく形状確認、長さゲート、KDF、認証復号の順序を保つ。長さゲートは
 * 汎用上限で行い、上限緩和はしない。現行方式はマニフェスト復号後に共有鍵を
 * 1回だけ導出して使い回し、旧来の per-part-KDF 形式も後方互換として読む。
 */
export async function parseSplitBackup(
  container: unknown,
  password: string,
  options?: ParseSplitBackupOptions,
): Promise<SplitBackupInput> {
  if (!isSplitBackupContainer(container)) {
    throw new SplitBackupError('invalid-shape', 'Not a split backup container');
  }
  if (container.parts.length < 1) {
    throw new SplitBackupError('invalid-shape', 'Split backup has no parts');
  }
  if (container.parts.length > MAX_SPLIT_PART_COUNT) {
    throw new SplitBackupError(
      'too-many-parts',
      `Split backup declares ${container.parts.length} parts, above the cap of ${MAX_SPLIT_PART_COUNT}`,
    );
  }

  assertEnvelopeWithinGenericCap(container.manifest);
  container.parts.forEach((part, index) => assertEnvelopeWithinGenericCap(part, index));

  let manifestJson: string;
  try {
    manifestJson = await decryptEnvelope(container.manifest, password);
  } catch {
    throw new SplitBackupError('decrypt-failed', 'Split backup manifest failed authentication');
  }
  let manifest: SplitBackupManifest;
  try {
    manifest = parseManifest(JSON.parse(manifestJson) as unknown);
  } catch (error) {
    if (error instanceof SplitBackupError) throw error;
    throw new SplitBackupError('invalid-manifest', 'Split backup manifest is not valid JSON');
  }

  if (options?.expectedVersion !== undefined && manifest.version !== options.expectedVersion) {
    throw new SplitBackupError(
      'version-mismatch',
      `Unsupported split backup version: ${manifest.version} (expected ${options.expectedVersion})`,
    );
  }
  if (container.parts.length > manifest.total) {
    throw new SplitBackupError(
      'part-count-mismatch',
      `Split backup part-count mismatch: manifest claims ${manifest.total} parts but the container holds ${container.parts.length}`,
    );
  }
  const fastPath = manifest.total === container.parts.length;
  if (fastPath) {
    if (
      manifest.partLengths.length !== manifest.total ||
      manifest.partLengths.some((length, index) => length !== container.parts[index]!.data.length)
    ) {
      throw new SplitBackupError(
        'part-length-mismatch',
        'Split backup part lengths do not match the manifest (order swap or truncation suspected)',
      );
    }
  }
  // WHY the file-pick ceiling, not a new literal: joined plaintext can never
  // legitimately exceed what the panel gate already lets through as one file.
  if (manifest.totalPlaintextLength > MAX_BACKUP_FILE_BYTES) {
    throw new SplitBackupError(
      'too-large',
      `Split backup plaintext total exceeds the backup file budget (${manifest.totalPlaintextLength} chars)`,
    );
  }

  const chunks: string[] = new Array<string>(manifest.total);
  if (isSharedManifest(manifest)) {
    const partKey = parsePartKey(manifest.partKey);
    let sharedKey: CryptoKey;
    try {
      sharedKey = await deriveKey(password, base64ToBytes(partKey.salt), partKey.iterations, partKey.hash);
    } catch {
      throw new SplitBackupError('decrypt-failed', 'Split backup part key derivation failed');
    }
    for (const [position, part] of container.parts.entries()) {
      if (
        part.kdf !== partKey.kdf ||
        part.hash !== partKey.hash ||
        part.iterations !== partKey.iterations ||
        part.salt !== partKey.salt
      ) {
        throw new SplitBackupError(
          'part-mismatch',
          `Split backup part ${position} does not match the manifest part key`,
          position,
        );
      }
      let partJson: string;
      try {
        partJson = await decryptWithSharedKey(part, sharedKey);
      } catch {
        throw new SplitBackupError(
          'decrypt-failed',
          `Split backup part ${position} failed authentication`,
          position,
        );
      }
      let payload: SplitBackupPartPayload;
      try {
        payload = parsePartPayload(JSON.parse(partJson) as unknown, position, fastPath);
      } catch (error) {
        if (error instanceof SplitBackupError) throw error;
        throw new SplitBackupError(
          'part-mismatch',
          `Split backup part ${position} is not valid JSON`,
          position,
        );
      }
      checkPayloadBinding(payload, manifest, position, chunks);
    }
  } else {
    for (const [position, part] of container.parts.entries()) {
      let partJson: string;
      try {
        partJson = await decryptEnvelope(part, password);
      } catch {
        throw new SplitBackupError(
          'decrypt-failed',
          `Split backup part ${position} failed authentication`,
          position,
        );
      }
      let payload: SplitBackupPartPayload;
      try {
        payload = parsePartPayload(JSON.parse(partJson) as unknown, position, fastPath);
      } catch (error) {
        if (error instanceof SplitBackupError) throw error;
        throw new SplitBackupError(
          'part-mismatch',
          `Split backup part ${position} is not valid JSON`,
          position,
        );
      }
      checkPayloadBinding(payload, manifest, position, chunks);
    }
  }
  if (!fastPath) {
    // WHY identify from authenticated inner indices: with a dropped part the
    // position binding no longer locates it, but each surviving part still
    // names its own index, so the complement is exactly the missing set.
    const missing: number[] = [];
    for (let index = 0; index < manifest.total; index++) {
      if (chunks[index] === undefined) missing.push(index);
    }
    throw new SplitBackupError(
      'part-count-mismatch',
      `Split backup is missing part(s) ${missing.join(', ')} (manifest claims ${manifest.total} parts but the container holds ${container.parts.length})`,
    );
  }

  const joined = chunks.join('');
  if (joined.length !== manifest.totalPlaintextLength) {
    throw new SplitBackupError(
      'length-mismatch',
      `Split backup joined length ${joined.length} differs from the manifest total ${manifest.totalPlaintextLength}`,
    );
  }

  let historyDbBase64: string;
  try {
    if (manifest.compression === 'gzip') {
      const decompressed = await gunzipBytes(base64ToBytes(joined));
      if (decompressed.length !== manifest.originalByteLength) {
        throw new SplitBackupError(
          'length-mismatch',
          `Split backup decompressed length ${decompressed.length} differs from the manifest original ${manifest.originalByteLength}`,
        );
      }
      historyDbBase64 = bytesToBase64(decompressed);
    } else {
      const decoded = base64ToBytes(joined);
      if (decoded.length !== manifest.originalByteLength) {
        throw new SplitBackupError(
          'length-mismatch',
          'Split backup decoded length differs from the manifest original',
        );
      }
      historyDbBase64 = joined;
    }
  } catch (error) {
    if (error instanceof SplitBackupError) throw error;
    throw new SplitBackupError('decompress-failed', 'Split backup payload failed to decode');
  }

  return {
    version: manifest.version,
    exportedAt: manifest.exportedAt,
    settings: manifest.settings,
    historyDbBase64,
  };
}
