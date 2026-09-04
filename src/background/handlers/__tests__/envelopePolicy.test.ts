/**
 * envelopePolicy.test.ts
 * The envelope accept/reject matrix is driven through the interface with
 * fake restore/migration adapters — no router, no chrome beyond the sender
 * shape.
 */
import { describe, it, expect, vi } from 'vitest';
import { checkEnvelope, INVALID_MESSAGE_ERROR } from '../envelopePolicy.js';
import { CURRENT_PROTOCOL_VERSION } from '../../messageTypes.js';

function makeDeps() {
  return {
    runDeferredStartupMigrations: vi.fn(async () => {}),
    initializeTabCache: vi.fn(async () => {}),
  };
}

function sender(tabId?: number): chrome.runtime.MessageSender {
  return (tabId === undefined ? {} : { tab: { id: tabId } }) as chrome.runtime.MessageSender;
}

describe('checkEnvelope', () => {
  it('rejects non-object envelopes', async () => {
    for (const raw of [null, undefined, 42, 'PING']) {
      const outcome = await checkEnvelope(raw, sender(), makeDeps());
      expect(outcome).toEqual({ accepted: false, response: INVALID_MESSAGE_ERROR });
    }
  });

  it('rejects unknown or missing types', async () => {
    for (const raw of [{}, { type: 42 }, { type: 'NOPE', payload: {} }]) {
      const outcome = await checkEnvelope(raw, sender(), makeDeps());
      expect(outcome.accepted).toBe(false);
    }
  });

  it('rejects missing payload for payload-bearing types', async () => {
    const outcome = await checkEnvelope(
      { type: 'MANUAL_RECORD', protocolVersion: CURRENT_PROTOCOL_VERSION },
      sender(7),
      makeDeps(),
    );
    expect(outcome).toEqual({ accepted: false, response: INVALID_MESSAGE_ERROR });
  });

  it('rejects version mismatch with warn detail', async () => {
    const deps = makeDeps();
    const outcome = await checkEnvelope(
      { type: 'PING', protocolVersion: CURRENT_PROTOCOL_VERSION + 999 },
      sender(),
      deps,
    );
    expect(outcome.accepted).toBe(false);
    if (outcome.accepted) return;
    expect(outcome.response).toEqual({ success: false, error: 'Protocol version mismatch' });
    expect(outcome.versionMismatch).toEqual({
      expected: CURRENT_PROTOCOL_VERSION,
      actual: CURRENT_PROTOCOL_VERSION + 999,
      type: 'PING',
    });
    // Rejected before migrations.
    expect(deps.runDeferredStartupMigrations).not.toHaveBeenCalled();
  });

  it('skips migrations for test/diagnostic types', async () => {
    for (const type of ['TEST_CONNECTIONS', 'TEST_OBSIDIAN', 'TEST_AI', 'CHECK_DOMAIN']) {
      const deps = makeDeps();
      const outcome = await checkEnvelope(
        { type, protocolVersion: CURRENT_PROTOCOL_VERSION, payload: {} },
        sender(),
        deps,
      );
      expect(outcome.accepted).toBe(true);
      expect(deps.runDeferredStartupMigrations).not.toHaveBeenCalled();
      expect(deps.initializeTabCache).not.toHaveBeenCalled();
    }
  });

  it('runs migrations + tab-cache init for normal types, in order', async () => {
    const order: string[] = [];
    const deps = {
      runDeferredStartupMigrations: vi.fn(async () => {
        order.push('migrations');
      }),
      initializeTabCache: vi.fn(async () => {
        order.push('tabcache');
      }),
    };
    const outcome = await checkEnvelope(
      { type: 'MANUAL_RECORD', protocolVersion: CURRENT_PROTOCOL_VERSION, payload: {} },
      sender(7),
      deps,
    );
    expect(outcome.accepted).toBe(true);
    expect(order).toEqual(['migrations', 'tabcache']);
  });

  it('answers null for CONTENT_CLEANSING_EXECUTED without a tab', async () => {
    const deps = makeDeps();
    const outcome = await checkEnvelope(
      { type: 'CONTENT_CLEANSING_EXECUTED', protocolVersion: CURRENT_PROTOCOL_VERSION, payload: {} },
      sender(),
      deps,
    );
    expect(outcome).toEqual({ accepted: false, response: null });
  });

  it('accepts CONTENT_CLEANSING_EXECUTED with a tab', async () => {
    const outcome = await checkEnvelope(
      { type: 'CONTENT_CLEANSING_EXECUTED', protocolVersion: CURRENT_PROTOCOL_VERSION, payload: {} },
      sender(9),
      makeDeps(),
    );
    expect(outcome.accepted).toBe(true);
  });
});
