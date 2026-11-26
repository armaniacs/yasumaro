/**
 * restoreChunkedTransport.test.ts
 * Cross-layer integration pin for the chunked restore transport:
 * dashboard client (real chunking) -> SW handler (real) -> offscreen deps
 * contract (fake staging backend).
 *
 * Capacity regression: the old single-shot restore_db hit the 10M-char wire
 * cap at ~7.5MB of DB, so a backup of that size could never be restored.
 * Here a DB just over that boundary round-trips through the session, with
 * every single message's base64 payload pinned under the per-chunk cap.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { restoreDb, RESTORE_CHUNK_BYTES } from '../dashboard/dashboardSqliteService.js';
import { createRestoreSessionHandler } from '../background/handlers/dashboardSqlite/restoreSessionHandler.js';
import type { RestoreSessionDeps } from '../background/handlers/dashboardSqlite/deps.js';
import type { DashboardSqliteRequest } from '../messaging/dashboardSqliteProtocol.js';
import { base64ToBytes } from '../utils/crypto/index.js';
import { MAX_RESTORE_CHUNK_BASE64 } from '../utils/limits.js';

const TOKEN = 'test-confirm-token';

/**
 * Fake offscreen backend: assembles the staging from the appended chunks and
 * verifies the commit contract, so the round trip proves byte fidelity.
 */
function makeOffscreenDeps(totalBytes: number) {
  const stagingBytes = new Uint8Array(totalBytes);
  const aborted: string[] = [];
  const deps: RestoreSessionDeps = {
    restoreBegin: async (declaredTotal, totalChunks) => {
      if (declaredTotal !== totalBytes) {
        return { success: false, error: { kind: 'unknown' as const, message: `begin totalBytes mismatch: ${declaredTotal}`, retriable: false } };
      }
      if (Math.ceil(totalBytes / RESTORE_CHUNK_BYTES) !== totalChunks) {
        return { success: false, error: { kind: 'unknown' as const, message: `totalChunks mismatch: ${totalChunks}`, retriable: false } };
      }
      return { success: true, data: 'restore_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db' };
    },
    restoreAppendChunk: async (stagingName, offset, dataBase64) => {
      if (!/^restore_incoming_[A-Za-z0-9-]{36}\.db$/.test(stagingName)) {
        return { success: false, error: { kind: 'unknown' as const, message: 'bad staging name', retriable: false } };
      }
      if (dataBase64.length > MAX_RESTORE_CHUNK_BASE64) {
        return { success: false, error: { kind: 'unknown' as const, message: 'chunk over cap', retriable: false } };
      }
      const bytes = base64ToBytes(dataBase64);
      stagingBytes.set(bytes, offset);
      return { success: true, data: bytes.byteLength };
    },
    restoreCommit: async (stagingName, declaredTotal) => {
      let nonZeroTail = false;
      for (let i = declaredTotal; i < stagingBytes.length; i++) {
        if (stagingBytes[i] !== 0) nonZeroTail = true;
      }
      if (declaredTotal !== totalBytes || nonZeroTail) {
        return { success: false, error: { kind: 'unknown' as const, message: 'commit size mismatch', retriable: false } };
      }
      void stagingName;
      return { success: true, data: undefined };
    },
    restoreAbort: async (stagingName) => {
      aborted.push(stagingName);
      return { success: true, data: undefined };
    },
  };
  return { deps, stagingBytes, aborted };
}

/** Route every dashboard op through the real SW handler backed by the fake offscreen deps. */
function wireDashboardToHandler(totalBytes: number) {
  const { deps, stagingBytes, aborted } = makeOffscreenDeps(totalBytes);
  const handler = createRestoreSessionHandler(deps);
  (globalThis as any).chrome = (globalThis as any).chrome ?? {};
  (globalThis as any).chrome.runtime = (globalThis as any).chrome.runtime ?? {};
  (globalThis as any).chrome.runtime.sendMessage = vi.fn(async (message: {
    payload: { subtype: string };
  }) => {
    const { subtype } = message.payload;
    if (subtype === 'create_confirm_token') {
      return { success: true, confirmToken: TOKEN };
    }
    return handler(message.payload as unknown as DashboardSqliteRequest);
  });
  return { stagingBytes, aborted };
}

describe('restore chunked transport (dashboard -> SW -> offscreen contract)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('round-trips a DB larger than the old single-message cap in capped chunks', async () => {
    // 7,500,001 bytes: the size class the 10M-char restore_db cap rejected
    // outright (base64 of ~7.15MB already crossed it).
    const DB_BYTES = 7_500_001;
    const data = new Uint8Array(DB_BYTES);
    for (let i = 0; i < DB_BYTES; i++) data[i] = (i * 31 + 7) % 251;

    const { stagingBytes, aborted } = wireDashboardToHandler(DB_BYTES);
    const result = await restoreDb(data);

    expect(result).toEqual({ data: undefined });
    expect(aborted).toEqual([]);
    expect(stagingBytes).toEqual(data);

    // Message count: 3 chunks at the 3MiB byte budget (+ the token
    // handshakes, which are separate sendMessage calls filtered out below).
    const opCalls = vi.mocked((globalThis as any).chrome.runtime.sendMessage).mock.calls
      .map((c: unknown[]) => (c[0] as { payload: { subtype: string } }).payload);
    expect(opCalls.filter((p: { subtype: string }) => p.subtype !== 'create_confirm_token')).toHaveLength(5);
    expect(opCalls.filter((p: { subtype: string }) => p.subtype === 'restore_chunk')).toHaveLength(3);
  });

  it('keeps every single message under the per-chunk cap (VULN-008 budget)', async () => {
    const DB_BYTES = RESTORE_CHUNK_BYTES * 2 + 1;
    const data = new Uint8Array(DB_BYTES);
    for (let i = 0; i < DB_BYTES; i++) data[i] = (i * 17) % 251;

    wireDashboardToHandler(DB_BYTES);
    const result = await restoreDb(data);
    expect(result).toEqual({ data: undefined });

    const payloads = vi.mocked((globalThis as any).chrome.runtime.sendMessage).mock.calls
      .map((c: unknown[]) => (c[0] as { payload: Record<string, unknown> }).payload);
    const chunks = payloads.filter((p: Record<string, unknown>) => p.subtype === 'restore_chunk');
    for (const chunk of chunks) {
      expect(String(chunk.data).length).toBeLessThanOrEqual(MAX_RESTORE_CHUNK_BASE64);
    }
    // Byte offsets accumulate by RESTORE_CHUNK_BYTES, not base64 chars;
    // the odd tail byte gets its own third chunk.
    expect(chunks.map((p: Record<string, unknown>) => p.offset)).toEqual([0, RESTORE_CHUNK_BYTES, RESTORE_CHUNK_BYTES * 2]);
  });

  it('aborts the staging and reports the original failure when a chunk is rejected', async () => {
    const DB_BYTES = 16;
    const data = new Uint8Array(DB_BYTES);
    // Offscreen side accepts begin but refuses every append (a dead staging
    // file). The dashboard must abort the session and surface the reason.
    const failingDeps: RestoreSessionDeps = {
      restoreBegin: async () => ({ success: true, data: 'restore_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db' }),
      restoreAppendChunk: async () => ({ success: false, error: { kind: 'unknown' as const, message: 'staging file disappeared', retriable: false } }),
      restoreCommit: async () => ({ success: true, data: undefined }),
      restoreAbort: async (stagingName) => {
        aborted.push(stagingName);
        return { success: true, data: undefined };
      },
    };
    const aborted: string[] = [];
    const handler = createRestoreSessionHandler(failingDeps);
    (globalThis as any).chrome = (globalThis as any).chrome ?? {};
    (globalThis as any).chrome.runtime = (globalThis as any).chrome.runtime ?? {};
    (globalThis as any).chrome.runtime.sendMessage = vi.fn(async (message: {
      payload: { subtype: string };
    }) => {
      const { subtype } = message.payload;
      if (subtype === 'create_confirm_token') {
        return { success: true, confirmToken: TOKEN };
      }
      return handler(message.payload as unknown as DashboardSqliteRequest);
    });

    const result = await restoreDb(data);
    expect(result).toEqual({ error: 'staging file disappeared' });
    // Exactly one cleanup attempt for the one issued staging name.
    expect(aborted).toEqual(['restore_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db']);
  });
});
