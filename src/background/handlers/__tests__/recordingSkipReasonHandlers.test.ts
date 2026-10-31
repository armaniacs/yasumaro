/**
 * recordingSkipReasonHandlers.test.ts
 *
 * RECORDING_SKIP_REASON relay integration (PBI 2026-10-31-01).
 *
 * Content scripts cannot reach chrome.storage.session (empirically confirmed
 * in e2eProbeRelay.ts), so the condition-not-met skip decided by the
 * pre-pipeline visit gate travels as a runtime message and the service
 * worker owns the session leg. This suite pins the round trip: the handler
 * persists the reason into chrome.storage.session and the popup reads it
 * back — across a service-worker restart, since the SW is stateless and
 * re-reads the session area.
 *
 * The validator is the unknown-key allowlist gate: the handler stores a
 * normalized record into extension state, so a payload key outside the
 * contract must be rejected, not stored.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRecordingSkipReasonHandler } from '../recordingSkipReasonHandlers.js';
import { RecordingSkipReasonValidator } from '../../../messaging/validators.js';
import type { RecordingSkipReasonMessage } from '../../messageTypes.js';
import { SKIP_REASON_SESSION_KEY, readLastSkipReason } from '../../../utils/skipReason.js';

function stubSession(store: Record<string, unknown>): {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn((key?: string | string[] | null) => {
    if (typeof key === 'string') {
      return Promise.resolve(key in store ? { [key]: store[key] } : {});
    }
    return Promise.resolve({ ...store });
  });
  const set = vi.fn((items: Record<string, unknown>) => {
    Object.assign(store, items);
    return Promise.resolve();
  });
  vi.stubGlobal('chrome', { storage: { session: { get, set } } });
  return { get, set };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function runHandler(
  message: RecordingSkipReasonMessage,
  store: Record<string, unknown>,
): Promise<{ response: unknown; set: ReturnType<typeof vi.fn> }> {
  const { set } = stubSession(store);
  const handler = createRecordingSkipReasonHandler();
  const sendResponse = vi.fn();
  await handler(message, {} as chrome.runtime.MessageSender, sendResponse);
  return { response: sendResponse.mock.calls[0]?.[0], set };
}

describe('createRecordingSkipReasonHandler (PBI 2026-10-31-01)', () => {
  it('persists the relayed reason into chrome.storage.session and acks', async () => {
    const store: Record<string, unknown> = {};
    const message: RecordingSkipReasonMessage = {
      type: 'RECORDING_SKIP_REASON',
      payload: { reason: 'condition-not-met' },
    };

    const { response, set } = await runHandler(message, store);

    expect(response).toEqual({ success: true });
    expect(set).toHaveBeenCalledWith({
      [SKIP_REASON_SESSION_KEY]: { reason: 'condition-not-met', count: 1 },
    });
  });

  it('accumulates the count when the same reason is relayed again (同日重複の回数)', async () => {
    const store: Record<string, unknown> = {};
    await runHandler(
      { type: 'RECORDING_SKIP_REASON', payload: { reason: 'duplicate' } },
      store,
    );
    await runHandler(
      { type: 'RECORDING_SKIP_REASON', payload: { reason: 'duplicate' } },
      store,
    );

    expect(store[SKIP_REASON_SESSION_KEY]).toEqual({ reason: 'duplicate', count: 2 });
  });

  it('resets the count when a different reason is relayed', async () => {
    const store: Record<string, unknown> = {};
    await runHandler(
      { type: 'RECORDING_SKIP_REASON', payload: { reason: 'condition-not-met' } },
      store,
    );
    await runHandler(
      { type: 'RECORDING_SKIP_REASON', payload: { reason: 'duplicate' } },
      store,
    );

    expect(store[SKIP_REASON_SESSION_KEY]).toEqual({ reason: 'duplicate', count: 1 });
  });

  it('keeps the record readable across a service-worker restart (stateless SW)', async () => {
    const store: Record<string, unknown> = {};
    await runHandler(
      { type: 'RECORDING_SKIP_REASON', payload: { reason: 'condition-not-met' } },
      store,
    );

    // A restarted service worker has no in-memory state: the popup reader
    // re-reads the session area through a fresh accessor.
    stubSession(store);
    await expect(readLastSkipReason()).resolves.toEqual({
      reason: 'condition-not-met',
      count: 1,
    });
  });

  it('stores reason type and count only — no URL, title, or content in the session area', async () => {
    const store: Record<string, unknown> = {};
    await runHandler(
      { type: 'RECORDING_SKIP_REASON', payload: { reason: 'pipeline-error' } },
      store,
    );

    const stored = store[SKIP_REASON_SESSION_KEY] as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(['count', 'reason']);
    expect(Object.values(stored)).not.toContain('https://example.com');
    expect(JSON.stringify(stored)).not.toContain('url');
    expect(JSON.stringify(stored)).not.toContain('title');
    expect(JSON.stringify(stored)).not.toContain('content');
  });

  it('is fail-safe: a session write failure acks a refusal instead of throwing', async () => {
    stubSession({});
    const chromeRef = globalThis as { chrome?: { storage?: { session?: { get: unknown; set: unknown } } } };
    if (chromeRef.chrome?.storage?.session) {
      chromeRef.chrome.storage.session.set = vi.fn(() => Promise.reject(new Error('quota')));
    }

    // Run the handler against the patched session (not runHandler, which
    // would rebuild the stub and drop the rejection).
    const handler = createRecordingSkipReasonHandler();
    const sendResponse = vi.fn();
    await handler(
      { type: 'RECORDING_SKIP_REASON', payload: { reason: 'duplicate' } },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'skip reason recording failed' });
  });
});

describe('RecordingSkipReasonValidator', () => {
  const validator = new RecordingSkipReasonValidator();

  it('passes a valid message through', () => {
    const message = { type: 'RECORDING_SKIP_REASON', payload: { reason: 'condition-not-met' } };
    expect(validator.validate(message)).toBe(message);
  });

  it('rejects a reason code outside the shared vocabulary', () => {
    expect(() =>
      validator.validate({ type: 'RECORDING_SKIP_REASON', payload: { reason: 'something-else' } }),
    ).toThrow();
  });

  it('rejects a payload key outside the contract (unknown-key allowlist)', () => {
    expect(() =>
      validator.validate({
        type: 'RECORDING_SKIP_REASON',
        // テスト内の意図的な不正ペイロード: URL を持たせても保存させない
        payload: { reason: 'condition-not-met', url: 'https://example.com' } as never,
      }),
    ).toThrow();
  });

  it('rejects a missing payload', () => {
    expect(() => validator.validate({ type: 'RECORDING_SKIP_REASON' })).toThrow();
  });
});
