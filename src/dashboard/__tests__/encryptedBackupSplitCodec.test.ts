/**
 * encryptedBackupSplitCodec.test.ts
 * PBI01: 分割コーデックの Outside-In 失敗試験から開始する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Crypto } from '@peculiar/webcrypto';
import {
  createSplitBackup,
  parseSplitBackup,
  isSplitBackupContainer,
  SplitBackupError,
  SPLIT_BACKUP_FORMAT_VERSION,
  MAX_SPLIT_PART_COUNT,
  type SplitBackupContainer,
  type SplitBackupInput,
} from '../encryptedBackupSplitCodec.js';
import { MAX_ENVELOPE_BASE64_LENGTH, MAX_BACKUP_FILE_BYTES } from '../../utils/limits.js';
import {
  decryptEnvelope,
  encryptEnvelope,
  deriveKey,
  base64ToBytes,
} from '../../utils/crypto/index.js';

// PBKDF2 at production iterations dominates runtime. Values are asserted in
// cryptoParamsSSOT.test.ts; here the KDF only needs to behave.
vi.mock('../../utils/crypto/cryptoParams.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/crypto/cryptoParams.js')>();
  return {
    ...actual,
    CRYPTO_PARAMS: {
      ...actual.CRYPTO_PARAMS,
      PBKDF2_ITERATIONS: 1_000,
      LEGACY_PBKDF2_ITERATIONS: 100,
    },
  };
});

beforeEach(() => {
  global.crypto = new Crypto() as unknown as Crypto;
  vi.clearAllMocks();
});

const PASSWORD = 'correct-password-123!';
const WRONG_PASSWORD = 'wrong-password-456!';

function bytesToB64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function makeInput(dbBytes: Uint8Array, settings: unknown = { theme: 'dark' }): SplitBackupInput {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    historyDbBase64: bytesToB64(dbBytes),
  };
}

function compressibleBytes(size: number): Uint8Array {
  const sentence = 'History log entry for https://example.com/articles/12345 with AI summary text. ';
  const bytes = new TextEncoder().encode(sentence);
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = bytes[i % bytes.length]!;
  return out;
}

function randomBytes(size: number): Uint8Array {
  const out = new Uint8Array(size);
  global.crypto.getRandomValues(out);
  return out;
}

describe('split backup round-trip (Outside-In)', () => {
  it('round-trips settings and history through split envelopes', async () => {
    const input = makeInput(compressibleBytes(500), { theme: 'dark', fontSize: 14 });
    const container = await createSplitBackup(input, PASSWORD, { chunkChars: 64 });

    expect(container.formatVersion).toBe(SPLIT_BACKUP_FORMAT_VERSION);
    expect(container.parts.length).toBeGreaterThan(1);

    const parsed = await parseSplitBackup(container, PASSWORD, { expectedVersion: 1 });
    expect(parsed).toEqual(input);
  });

  it('binds every part to its manifest id, index and total', async () => {
    const input = makeInput(compressibleBytes(300));
    const container = await createSplitBackup(input, PASSWORD, { chunkChars: 64 });

    const manifestJson = await decryptEnvelope(container.manifest, PASSWORD);
    const manifest = JSON.parse(manifestJson) as {
      manifestId: string;
      total: number;
      partKey?: { salt: string; iterations: number; hash: string };
    };
    expect(manifest.total).toBe(container.parts.length);

    const sharedKey = await deriveKey(
      PASSWORD,
      base64ToBytes(manifest.partKey!.salt),
      manifest.partKey!.iterations,
      manifest.partKey!.hash,
    );
    const salts = new Set(container.parts.map((p) => p.salt));
    expect(salts.size).toBe(1);
    expect([...salts][0]).toBe(manifest.partKey!.salt);
    for (const [index, part] of container.parts.entries()) {
      const partJson =
        'ciphertext' in (part as unknown as Record<string, unknown>)
          ? new TextDecoder().decode(
              await (globalThis.crypto as Crypto).subtle.decrypt(
                { name: 'AES-GCM', iv: base64ToBytes((part as unknown as { iv: string }).iv) as BufferSource },
                sharedKey,
                base64ToBytes((part as unknown as { ciphertext: string }).ciphertext) as BufferSource,
              ),
            )
          : new TextDecoder().decode(
              await (globalThis.crypto as Crypto).subtle.decrypt(
                { name: 'AES-GCM', iv: base64ToBytes(part.iv) as BufferSource },
                sharedKey,
                base64ToBytes(part.data) as BufferSource,
              ),
            );
      const partPayload = JSON.parse(partJson) as {
        index: number;
        total: number;
        manifestId: string;
      };
      expect(partPayload.index).toBe(index);
      expect(partPayload.total).toBe(container.parts.length);
      expect(partPayload.manifestId).toBe(manifest.manifestId);
    }
  });

  it('keeps every part within the generic envelope cap at the default budget', async () => {
    // Random bytes defeat gzip, forcing several full-size parts at the real budget.
    const input = makeInput(randomBytes(20 * 1024 * 1024));
    const container = await createSplitBackup(input, PASSWORD);

    expect(container.parts.length).toBeGreaterThan(1);
    for (const part of container.parts) {
      const cipherLength =
        'ciphertext' in (part as unknown as Record<string, unknown>)
          ? (part as unknown as { ciphertext: string }).ciphertext.length
          : (part as { data: string }).data.length;
      expect(cipherLength).toBeLessThanOrEqual(MAX_ENVELOPE_BASE64_LENGTH);
    }
    expect(container.manifest.data.length).toBeLessThanOrEqual(MAX_ENVELOPE_BASE64_LENGTH);

    const parsed = await parseSplitBackup(container, PASSWORD, { expectedVersion: 1 });
    expect(parsed).toEqual(input);
  });

  it('uses gzip for compressible history bytes and verifies the original length', async () => {
    const input = makeInput(compressibleBytes(200_000));
    const container = await createSplitBackup(input, PASSWORD);

    const manifestJson = await decryptEnvelope(container.manifest, PASSWORD);
    const manifest = JSON.parse(manifestJson) as {
      compression: string;
      originalByteLength: number;
      totalPlaintextLength: number;
    };
    expect(manifest.compression).toBe('gzip');
    expect(manifest.originalByteLength).toBe(200_000);
    expect(manifest.totalPlaintextLength).toBeLessThan(input.historyDbBase64.length);

    const parsed = await parseSplitBackup(container, PASSWORD, { expectedVersion: 1 });
    expect(parsed).toEqual(input);
  });

  it('keeps raw bytes for incompressible input', async () => {
    const input = makeInput(randomBytes(4096));
    const container = await createSplitBackup(input, PASSWORD);

    const manifestJson = await decryptEnvelope(container.manifest, PASSWORD);
    const manifest = JSON.parse(manifestJson) as { compression: string };
    expect(manifest.compression).toBe('none');

    const parsed = await parseSplitBackup(container, PASSWORD, { expectedVersion: 1 });
    expect(parsed).toEqual(input);
  });

  it('round-trips an empty history db as a single part', async () => {
    const input = makeInput(new Uint8Array(0));
    const container = await createSplitBackup(input, PASSWORD);

    expect(container.parts.length).toBe(1);
    const parsed = await parseSplitBackup(container, PASSWORD, { expectedVersion: 1 });
    expect(parsed).toEqual(input);
  });
});

describe('split backup rejection', () => {
  it('rejects a missing part naming the missing part number', async () => {
    const input = makeInput(compressibleBytes(900));
    const container = await createSplitBackup(input, PASSWORD, { chunkChars: 64 });
    expect(container.parts.length).toBeGreaterThan(2);

    const dropped: SplitBackupContainer = {
      ...container,
      parts: container.parts.filter((_, i) => i !== 1),
    };
    // Manifest still claims the original count: the drop is detected, not hidden.
    const error = await parseSplitBackup(dropped, PASSWORD, { expectedVersion: 1 }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SplitBackupError);
    expect((error as SplitBackupError).message).toContain('1');
  });

  it('rejects reordered parts', async () => {
    const input = makeInput(compressibleBytes(900));
    const container = await createSplitBackup(input, PASSWORD, { chunkChars: 64 });

    const reordered: SplitBackupContainer = {
      ...container,
      parts: [container.parts[1]!, container.parts[0]!, ...container.parts.slice(2)],
    };
    await expect(parseSplitBackup(reordered, PASSWORD, { expectedVersion: 1 })).rejects.toThrow(
      SplitBackupError,
    );
  });

  it('rejects a tampered part', async () => {
    const input = makeInput(compressibleBytes(900));
    const container = await createSplitBackup(input, PASSWORD, { chunkChars: 64 });

    const tampered = structuredClone(container);
    const first = tampered.parts[0]! as unknown as Record<string, unknown>;
    if (typeof first['ciphertext'] === 'string') {
      const data = first['ciphertext'] as string;
      const flipped = data.at(-1) === 'A' ? 'B' : 'A';
      first['ciphertext'] = `${data.slice(0, -1)}${flipped}`;
    } else {
      const data = first['data'] as string;
      const flipped = data.at(-1) === 'A' ? 'B' : 'A';
      first['data'] = `${data.slice(0, -1)}${flipped}`;
    }
    await expect(parseSplitBackup(tampered, PASSWORD, { expectedVersion: 1 })).rejects.toThrow(
      SplitBackupError,
    );
  });

  it('rejects a part taken from another backup (manifest id mismatch)', async () => {
    const containerA = await createSplitBackup(makeInput(compressibleBytes(900)), PASSWORD, {
      chunkChars: 64,
    });
    const containerB = await createSplitBackup(makeInput(compressibleBytes(900)), PASSWORD, {
      chunkChars: 64,
    });

    const mixed: SplitBackupContainer = {
      ...containerA,
      parts: [containerB.parts[0]!, ...containerA.parts.slice(1)],
    };
    await expect(parseSplitBackup(mixed, PASSWORD, { expectedVersion: 1 })).rejects.toThrow(
      SplitBackupError,
    );
  });

  it('rejects a tampered manifest envelope', async () => {
    const input = makeInput(compressibleBytes(300));
    const container = await createSplitBackup(input, PASSWORD, { chunkChars: 64 });

    const tampered = structuredClone(container);
    const data = tampered.manifest.data;
    const flipped = data.at(-1) === 'A' ? 'B' : 'A';
    tampered.manifest.data = `${data.slice(0, -1)}${flipped}`;
    await expect(parseSplitBackup(tampered, PASSWORD, { expectedVersion: 1 })).rejects.toThrow(
      SplitBackupError,
    );
  });

  it('rejects a forged manifest with a wrong part count', async () => {
    const input = makeInput(compressibleBytes(300));
    const container = await createSplitBackup(input, PASSWORD, { chunkChars: 64 });

    const manifest = JSON.parse(await decryptEnvelope(container.manifest, PASSWORD)) as Record<
      string,
      unknown
    >;
    manifest['total'] = (manifest['total'] as number) + 1;
    const forged: SplitBackupContainer = {
      ...container,
      manifest: await encryptEnvelope(JSON.stringify(manifest), PASSWORD),
    };
    await expect(parseSplitBackup(forged, PASSWORD, { expectedVersion: 1 })).rejects.toThrow(
      /part-count|total/i,
    );
  });

  it('rejects a forged manifest with a wrong version', async () => {
    const input = makeInput(compressibleBytes(300));
    const container = await createSplitBackup(input, PASSWORD, { chunkChars: 64 });

    const manifest = JSON.parse(await decryptEnvelope(container.manifest, PASSWORD)) as Record<
      string,
      unknown
    >;
    manifest['version'] = 999;
    const forged: SplitBackupContainer = {
      ...container,
      manifest: await encryptEnvelope(JSON.stringify(manifest), PASSWORD),
    };
    await expect(parseSplitBackup(forged, PASSWORD, { expectedVersion: 1 })).rejects.toThrow(
      /version/i,
    );
  });

  it('rejects an oversized part before any KDF work (pre-auth length gate)', async () => {
    const input = makeInput(compressibleBytes(300));
    const container = await createSplitBackup(input, PASSWORD, { chunkChars: 64 });

    const oversized = structuredClone(container);
    const first = oversized.parts[0]! as unknown as Record<string, unknown>;
    if (typeof first['ciphertext'] === 'string') {
      first['ciphertext'] = 'A'.repeat(MAX_ENVELOPE_BASE64_LENGTH + 1);
    } else {
      first['data'] = 'A'.repeat(MAX_ENVELOPE_BASE64_LENGTH + 1);
    }
    await expect(parseSplitBackup(oversized, PASSWORD, { expectedVersion: 1 })).rejects.toThrow(
      /length|too large/i,
    );
  });

  it('rejects a wrong password without leaking plaintext', async () => {
    const input = makeInput(compressibleBytes(300));
    const container = await createSplitBackup(input, PASSWORD, { chunkChars: 64 });

    await expect(
      parseSplitBackup(container, WRONG_PASSWORD, { expectedVersion: 1 }),
    ).rejects.toThrow(SplitBackupError);
  });

  it('rejects non-container input by shape', async () => {
    const single = await encryptEnvelope(JSON.stringify({ hello: 'world' }), PASSWORD);
    await expect(parseSplitBackup(null, PASSWORD)).rejects.toThrow(SplitBackupError);
    await expect(parseSplitBackup({}, PASSWORD)).rejects.toThrow(SplitBackupError);
    await expect(parseSplitBackup(single, PASSWORD)).rejects.toThrow(SplitBackupError);
  });

  it('refuses to create more parts than the part-count cap', async () => {
    const input = makeInput(compressibleBytes(MAX_SPLIT_PART_COUNT * 10 + 64));
    await expect(
      createSplitBackup(input, PASSWORD, { chunkChars: 8 }),
    ).rejects.toThrow(SplitBackupError);
  });

  it('rejects a manifest whose plaintext total exceeds the backup file budget', async () => {
    const input = makeInput(compressibleBytes(300));
    const container = await createSplitBackup(input, PASSWORD, { chunkChars: 64 });

    const manifest = JSON.parse(await decryptEnvelope(container.manifest, PASSWORD)) as Record<
      string,
      unknown
    >;
    manifest['totalPlaintextLength'] = MAX_BACKUP_FILE_BYTES + 1;
    const forged: SplitBackupContainer = {
      ...container,
      manifest: await encryptEnvelope(JSON.stringify(manifest), PASSWORD),
    };
    await expect(parseSplitBackup(forged, PASSWORD, { expectedVersion: 1 })).rejects.toThrow(
      SplitBackupError,
    );
  });
});

describe('isSplitBackupContainer', () => {
  it('accepts a created container and rejects single envelopes', async () => {
    const container = await createSplitBackup(makeInput(compressibleBytes(100)), PASSWORD);
    expect(isSplitBackupContainer(container)).toBe(true);

    const single = await encryptEnvelope('hello', PASSWORD);
    expect(isSplitBackupContainer(single)).toBe(false);
    expect(isSplitBackupContainer(null)).toBe(false);
    expect(isSplitBackupContainer({})).toBe(false);
  });
});

describe('split backup review fixes (Outside-In)', () => {
  async function countPbkdf2(fn: () => Promise<unknown>): Promise<number> {
    const subtle = (globalThis.crypto as unknown as Crypto).subtle;
    const orig = subtle.deriveKey.bind(subtle);
    let count = 0;
    (subtle as unknown as Record<string, unknown>)['deriveKey'] = (async (...args: unknown[]) => {
      const alg = args[0] as { name?: string } | undefined;
      if (alg?.name === 'PBKDF2') count++;
      return (orig as (...a: never[]) => Promise<CryptoKey>)(...(args as never[]));
    }) as typeof subtle.deriveKey;
    try {
      await fn();
    } finally {
      (subtle as unknown as Record<string, unknown>)['deriveKey'] = orig;
    }
    return count;
  }

  function partDataLength(part: unknown): number {
    const p = part as Record<string, unknown>;
    if (typeof p['data'] === 'string') return (p['data'] as string).length;
    return (p['ciphertext'] as string).length;
  }

  it('指摘1: writes the input view to the compression stream without Uint8Array.from copy', async () => {
    const RealCompression = globalThis.CompressionStream;
    const RealDecompression = globalThis.DecompressionStream;
    const seen: Uint8Array[] = [];
    class PassthroughCS {
      readable: ReadableStream<Uint8Array>;
      writable: WritableStream<Uint8Array>;
      constructor(_format: string) {
        let notify: () => void = () => {};
        const done = new Promise<void>((r) => {
          notify = r;
        });
        const local: Uint8Array[] = [];
        this.writable = new WritableStream<Uint8Array>({
          write(chunk: Uint8Array) {
            local.push(chunk);
          },
          close() {
            for (const c of local) seen.push(c);
            notify();
          },
        });
        this.readable = new ReadableStream<Uint8Array>({
          start(controller) {
            void done.then(() => {
              for (const c of local) controller.enqueue(c);
              controller.close();
            });
          },
        });
      }
    }
    (globalThis as unknown as Record<string, unknown>)['CompressionStream'] = PassthroughCS;
    (globalThis as unknown as Record<string, unknown>)['DecompressionStream'] = PassthroughCS;
    const fromSpy = vi.spyOn(Uint8Array, 'from');
    fromSpy.mockClear();
    try {
      await createSplitBackup(makeInput(compressibleBytes(500)), PASSWORD, { chunkChars: 64 });
      const callsWithBytes = fromSpy.mock.calls.filter(
        (args) => args[0] instanceof Uint8Array && (args[0] as Uint8Array).length > 0,
      );
      expect(callsWithBytes.length).toBe(0);
    } finally {
      fromSpy.mockRestore();
      (globalThis as unknown as Record<string, unknown>)['CompressionStream'] = RealCompression;
      (globalThis as unknown as Record<string, unknown>)['DecompressionStream'] = RealDecompression;
    }
  });

  it('指摘2: derives the part key once per create (not per part)', async () => {
    const input = makeInput(compressibleBytes(900));
    let parts = 0;
    const kdfCount = await countPbkdf2(async () => {
      const container = await createSplitBackup(input, PASSWORD, { chunkChars: 64 });
      parts = container.parts.length;
    });
    expect(parts).toBeGreaterThan(2);
    expect(kdfCount).toBe(2);
  });

  it('指摘2: manifest records the shared-key method', async () => {
    const container = await createSplitBackup(makeInput(compressibleBytes(300)), PASSWORD, {
      chunkChars: 64,
    });
    const manifest = JSON.parse(await decryptEnvelope(container.manifest, PASSWORD)) as Record<
      string,
      unknown
    >;
    expect(manifest['partMode']).toBe('shared-pbkdf2-v1');
    const partKey = manifest['partKey'] as Record<string, unknown>;
    expect(partKey['kdf']).toBe('pbkdf2');
    expect(partKey['hash']).toBe('SHA-256');
    expect(partKey['iterations']).toBe(1_000);
    expect(typeof partKey['salt']).toBe('string');
  });

  it('指摘3: reuses the shared key on parse (not per part KDF)', async () => {
    const container = await createSplitBackup(makeInput(compressibleBytes(900)), PASSWORD, {
      chunkChars: 64,
    });
    expect(container.parts.length).toBeGreaterThan(2);
    const kdfCount = await countPbkdf2(async () => {
      await parseSplitBackup(container, PASSWORD, { expectedVersion: 1 });
    });
    expect(kdfCount).toBe(2);
  });

  it('後方互換: parses legacy per-part-KDF containers', async () => {
    const input = makeInput(compressibleBytes(300));
    const chunkChars = 64;
    const body = input.historyDbBase64;
    const chunks: string[] = [];
    for (let i = 0; i < body.length; i += chunkChars) chunks.push(body.slice(i, i + chunkChars));
    const manifestId = 'legacy-manifest-id';
    const total = chunks.length;
    const parts = [];
    for (const [index, chunk] of chunks.entries()) {
      parts.push(
        await encryptEnvelope(
          JSON.stringify({ kind: 'split-backup-part', index, total, manifestId, chunk }),
          PASSWORD,
        ),
      );
    }
    const legacyManifest = {
      kind: 'split-backup-manifest',
      version: 1,
      exportedAt: input.exportedAt,
      manifestId,
      total,
      partLengths: parts.map((p) => p.data.length),
      totalPlaintextLength: body.length,
      compression: 'none',
      originalByteLength: Buffer.from(body, 'base64').length,
      settings: input.settings,
    };
    const legacy: SplitBackupContainer = {
      kind: 'encrypted-split-backup',
      formatVersion: 1,
      manifest: await encryptEnvelope(JSON.stringify(legacyManifest), PASSWORD),
      parts,
    };
    expect(partDataLength(legacy.parts[0])).toBeGreaterThan(0);
    const parsed = await parseSplitBackup(legacy, PASSWORD, { expectedVersion: 1 });
    expect(parsed).toEqual({ ...input, historyDbBase64: body });
  });
});

describe('create-side joined-length gate (PBI 2026-11-26-02)', () => {
  // The joined body is base64 text, so its length moves in quanta of 4 chars:
  // the values adjacent to MAX_BACKUP_FILE_BYTES are the cap itself
  // (39,321,600 raw bytes) and cap+4 (39,321,601 raw bytes, one byte over).
  const CAP_BOUNDARY_BYTES = (MAX_BACKUP_FILE_BYTES * 3) / 4;

  // The over-cap input is read-only for createSplitBackup, so the reject tests
  // share one construction instead of re-encoding ~37MB per test.
  let overBudgetInput: SplitBackupInput | undefined;
  function getOverBudgetInput(): SplitBackupInput {
    overBudgetInput ??= makeInput(randomBytes(CAP_BOUNDARY_BYTES + 1));
    return overBudgetInput;
  }

  it('accepts a joined body exactly at the backup file budget and restores it', async () => {
    const input = makeInput(randomBytes(CAP_BOUNDARY_BYTES));
    const container = await createSplitBackup(input, PASSWORD);

    const manifest = JSON.parse(await decryptEnvelope(container.manifest, PASSWORD)) as {
      totalPlaintextLength: number;
      compression: string;
    };
    expect(manifest.totalPlaintextLength).toBe(MAX_BACKUP_FILE_BYTES);
    expect(manifest.compression).toBe('none');

    // The invariant under repair: a backup that creation accepted must restore.
    const parsed = await parseSplitBackup(container, PASSWORD, { expectedVersion: 1 });
    expect(parsed.historyDbBase64).toBe(input.historyDbBase64);
  });

  it('rejects the smallest over-budget incompressible body with split-backup-too-large', async () => {
    const error = await createSplitBackup(getOverBudgetInput(), PASSWORD).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SplitBackupError);
    expect((error as SplitBackupError).code).toBe('split-backup-too-large');
  });

  it('rejects an over-budget body even when it needs no more than 16 parts', async () => {
    const error = await createSplitBackup(getOverBudgetInput(), PASSWORD, { chunkChars: 20_000_000 }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SplitBackupError);
    expect((error as SplitBackupError).code).toBe('split-backup-too-large');
  });

  it('fails before building any part: no KDF work and no container on gate violation', async () => {
    const subtle = (globalThis.crypto as unknown as Crypto).subtle;
    const orig = subtle.deriveKey.bind(subtle);
    let kdfCount = 0;
    (subtle as unknown as Record<string, unknown>)['deriveKey'] = (async (...args: unknown[]) => {
      const alg = args[0] as { name?: string } | undefined;
      if (alg?.name === 'PBKDF2') kdfCount++;
      return (orig as (...a: never[]) => Promise<CryptoKey>)(...(args as never[]));
    }) as typeof subtle.deriveKey;
    try {
      const outcome = await createSplitBackup(getOverBudgetInput(), PASSWORD).then(
        (container) => container,
        (e: unknown) => e,
      );
      expect(outcome).toBeInstanceOf(SplitBackupError);
      expect((outcome as SplitBackupError).code).toBe('split-backup-too-large');
    } finally {
      (subtle as unknown as Record<string, unknown>)['deriveKey'] = orig;
    }
    // Parts are built after the shared part-key KDF, so zero KDF calls prove
    // the gate fired before any part (and manifest) existed.
    expect(kdfCount).toBe(0);
  });
});
