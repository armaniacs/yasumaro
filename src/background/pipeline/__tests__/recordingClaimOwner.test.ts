/**
 * recordingClaimOwner.test.ts — PBI 2026-11-07-19.
 *
 * Pins the claim-owning record entry: with `acquireRecoveryClaim` the
 * orchestrator owns the pending-check → claim → run → finally-release
 * order, so no caller can mis-order acquire/release. Without the flag the
 * claim seam is untouched (byte-identical for save / valid-visit /
 * regenerate / notification-confirm / offline-retry).
 *
 * The inner record is stubbed through a call-through spy: outer flag-true
 * calls run the real envelope, inner (flag-cleared) calls record an event
 * and return a canned result. No step executes, no wall-clock wait.
 */
import { describe, it, expect, vi } from 'vitest';
import { RecordingOrchestrator, type RecordOptions } from '../RecordingOrchestrator.js';
import type { RecoveryClaimDeps } from '../RecordingOrchestrator.js';
import type { RecordingData, RecordingResult } from '../../../messaging/types.js';
import type { PendingPage } from '../../../utils/pendingStorage.js';

const RECOVERY_URL = 'https://example.com/pending-page';
const PLAIN_URL = 'https://example.com/plain-page';

function pendingPage(url: string): PendingPage {
  return { url, title: 'T', timestamp: 1, reason: 'pipeline-error', expiry: 2 };
}

function recordData(url: string, extra: Partial<RecordingData> = {}): RecordingData {
  return { title: 'T', url, content: 'body', ...extra };
}

interface Harness {
  orch: RecordingOrchestrator;
  events: string[];
  claimStore: RecoveryClaimDeps['claimStore'];
  pendingReader: ReturnType<typeof vi.fn<() => Promise<PendingPage[]>>>;
  innerResults: RecordingResult[];
  state: { throwInner: boolean };
}

/**
 * Real envelope, stubbed core: the spy lets the outer (flag-true) call run
 * the production order while inner (flag-cleared) calls only record their
 * arrival and return the next canned result.
 */
function makeHarness(opts: {
  pending: PendingPage[] | Error;
  claimGranted: boolean;
  innerResults?: RecordingResult[];
}): Harness {
  const events: string[] = [];
  const claimStore: RecoveryClaimDeps['claimStore'] = {
    claimRecoveryOwner: vi.fn(async (url: string) => {
      events.push(`claim:${url}`);
      return opts.claimGranted;
    }),
    releaseRecoveryOwner: vi.fn(async (url: string) => {
      events.push(`release:${url}`);
    }),
  };
  const pendingReader = vi.fn<() => Promise<PendingPage[]>>(async () => {
    if (opts.pending instanceof Error) throw opts.pending;
    return opts.pending;
  });
  const orch = new RecordingOrchestrator({
    getPrivacyInfoWithCache: async () => null,
    getSettingsWithCache: async () => ({}) as never,
    obsidian: {} as never,
    aiService: null,
    sqliteClient: null,
    stepDelay: async () => undefined,
    recoveryClaim: { claimStore, getPendingPages: pendingReader },
  });
  const innerResults = opts.innerResults ?? [{ success: true }];
  const originalRecord = orch.record.bind(orch);
  const state = { throwInner: false };
  vi.spyOn(orch, 'record').mockImplementation(
    async (data: RecordingData, recordOpts?: RecordOptions) => {
      if (recordOpts?.acquireRecoveryClaim === true) return originalRecord(data, recordOpts);
      events.push(`record:${data.url}`);
      if (state.throwInner) throw new Error('inner boom');
      const next = innerResults.shift();
      return next ?? { success: true };
    },
  );
  return { orch, events, claimStore, pendingReader, innerResults, state };
}

describe('RecordingOrchestrator recovery-claim ownership (PBI 2026-11-07-19)', () => {
  it('claims, runs, and releases in order on a recovery run', async () => {
    const h = makeHarness({ pending: [pendingPage(RECOVERY_URL)], claimGranted: true });

    const result = await h.orch.record(recordData(RECOVERY_URL), { acquireRecoveryClaim: true });

    expect(result).toEqual({ success: true });
    expect(h.events).toEqual([
      `claim:${RECOVERY_URL}`,
      `record:${RECOVERY_URL}`,
      `release:${RECOVERY_URL}`,
    ]);
  });

  it('clears the flag before the inner record so the envelope cannot re-enter', async () => {
    const h = makeHarness({ pending: [pendingPage(RECOVERY_URL)], claimGranted: true });
    const recordSpy = vi.mocked(h.orch.record);

    await h.orch.record(recordData(RECOVERY_URL), {
      settings: {} as never,
      acquireRecoveryClaim: true,
    });

    const innerCall = recordSpy.mock.calls.find(
      (call) => call[1]?.acquireRecoveryClaim !== true,
    );
    expect(innerCall?.[1]).toEqual({ settings: {}, acquireRecoveryClaim: false });
  });

  it('returns RECOVERY_CLAIMED without running when another owner holds the claim', async () => {
    const h = makeHarness({ pending: [pendingPage(RECOVERY_URL)], claimGranted: false });

    const result = await h.orch.record(recordData(RECOVERY_URL), { acquireRecoveryClaim: true });

    expect(result).toEqual({ success: false, error: 'RECOVERY_CLAIMED' });
    expect(h.events).toEqual([`claim:${RECOVERY_URL}`]);
    expect(h.claimStore.releaseRecoveryOwner).not.toHaveBeenCalled();
  });

  it('releases the claim when the inner record throws', async () => {
    const h = makeHarness({ pending: [pendingPage(RECOVERY_URL)], claimGranted: true });
    h.state.throwInner = true;

    await expect(
      h.orch.record(recordData(RECOVERY_URL), { acquireRecoveryClaim: true }),
    ).rejects.toThrow('inner boom');
    expect(h.events).toEqual([
      `claim:${RECOVERY_URL}`,
      `record:${RECOVERY_URL}`,
      `release:${RECOVERY_URL}`,
    ]);
  });

  it('bypasses the claim store entirely for non-recovery URLs', async () => {
    const h = makeHarness({ pending: [pendingPage(RECOVERY_URL)], claimGranted: true });

    const result = await h.orch.record(recordData(PLAIN_URL), { acquireRecoveryClaim: true });

    expect(result).toEqual({ success: true });
    expect(h.events).toEqual([`record:${PLAIN_URL}`]);
    expect(h.claimStore.claimRecoveryOwner).not.toHaveBeenCalled();
    expect(h.claimStore.releaseRecoveryOwner).not.toHaveBeenCalled();
  });

  it('surfaces a pending-pages read failure as a detectable error instead of running claim-free (PBI 2026-11-08-07)', async () => {
    const h = makeHarness({ pending: new Error('storage unavailable'), claimGranted: true });

    await expect(
      h.orch.record(recordData(RECOVERY_URL), { acquireRecoveryClaim: true }),
    ).rejects.toThrow('storage unavailable');
    expect(h.events).toEqual([]);
    expect(h.claimStore.claimRecoveryOwner).not.toHaveBeenCalled();
    expect(h.claimStore.releaseRecoveryOwner).not.toHaveBeenCalled();
  });

  it('wraps previewOnly requests in the same claim envelope', async () => {
    const h = makeHarness({ pending: [pendingPage(RECOVERY_URL)], claimGranted: true });
    const recordSpy = vi.mocked(h.orch.record);

    const result = await h.orch.record(recordData(RECOVERY_URL, { previewOnly: true }), {
      acquireRecoveryClaim: true,
    });

    expect(result).toEqual({ success: true });
    expect(h.events).toEqual([
      `claim:${RECOVERY_URL}`,
      `record:${RECOVERY_URL}`,
      `release:${RECOVERY_URL}`,
    ]);
    const innerCall = recordSpy.mock.calls.find(
      (call) => call[1]?.acquireRecoveryClaim !== true,
    );
    expect(innerCall?.[0].previewOnly).toBe(true);
  });

  it('never touches the claim seam without the flag', async () => {
    const h = makeHarness({ pending: [pendingPage(RECOVERY_URL)], claimGranted: true });

    await h.orch.record(recordData(RECOVERY_URL));
    await h.orch.preview(recordData(RECOVERY_URL));

    expect(h.pendingReader).not.toHaveBeenCalled();
    expect(h.claimStore.claimRecoveryOwner).not.toHaveBeenCalled();
    expect(h.claimStore.releaseRecoveryOwner).not.toHaveBeenCalled();
  });
});
