/**
 * consentToctou.probe.test.ts — NV-1 (同意TOCTOU) verification probe.
 *
 * SCOPE (発火デモであり回帰ガードではない):
 * - 本probeの実証目的は、mutex待機中の同意撤回が後段に伝わらないこと
 *   (同意再読ゼロ: default pathは撤回後の値を読むだけ・caller-owned pathは
 *   再読なし) である。
 * - sink発火 (AI / SQLite / Obsidian の stub が呼ばれること) 自体は
 *   executeInternal全面モックというstub配線の帰結であり、同語反復である。
 *   consentStore / settingsReadConsents / consentAtExecution は自作スタブの
 *   自己観測に過ぎず、本番seam (hasPrivacyConsent / Settings /
 *   RecordingAdmission) には未配線である。
 * - したがって将来 executeInternalInner 内に同意ゲートを追加しても本probeは
 *   passし続ける。回帰ガード化には修正PBI側で実execute経路のテストへ
 *   昇格させること。
 * - 「intakeで1回」側 (RecordingAdmission.admit が intake 時に同意を1回
 *   読むこと) は本probeでは実証しない。admit自体を呼んでおらず、軽い裏付け
 *   として record() → executeInternal が1回だけ呼ばれることのみassertする。
 *   intakeゲートの本証は recordingAdmission.test.ts 側の責務である。
 *
 * Hypothesis: RecordingAdmission.admit checks hasPrivacyConsent once at
 * intake; RecordingOrchestrator.record then runs the per-URL mutex wait +
 * 13-step pipeline with no consent re-read, so a withdrawal mid-wait does
 * not stop execution (firing expected).
 *
 * Method: occupy the per-URL mutex, start orch.record(), flip the consent
 * store to withdrawn mid-wait, release the mutex, and observe whether the
 * stubbed sinks (AI / SQLite / Obsidian) still fire. No real endpoints,
 * no wall-clock waits — mutex hold/release is fully deterministic via a
 * Promise.withResolvers gate (same style as
 * recordingOrchestrator-settingsRefresh.test.ts). executeInternal is the
 * observation seam: the stub stands in for the 13 steps and invokes the
 * sink stubs exactly as the save tail would.
 */
import { describe, it, expect, vi } from 'vitest';
import { RecordingOrchestrator } from '../RecordingOrchestrator.js';
import { PerUrlMutexMap } from '../perUrlMutex.js';
import type { RecordingData, RecordingResult } from '../../../messaging/types.js';

const PROBE_URL = 'https://example.com/nv1-toctou-probe';

function recordData(): RecordingData {
  return { title: 'T', url: PROBE_URL, content: 'body' };
}

interface ProbeHarness {
  orch: RecordingOrchestrator;
  /** Intake-time consent store; flipped to withdrawn mid-wait. */
  consentStore: { granted: boolean };
  /** Stubbed sinks: call counts prove whether the save tail fired. */
  sinks: { ai: ReturnType<typeof vi.fn>; sqlite: ReturnType<typeof vi.fn>; obsidian: ReturnType<typeof vi.fn> };
  /** Consent value observed at execution time (inside the mutex). */
  consentAtExecution: boolean[];
  /** Consent value observed at each post-wait settings read. */
  settingsReadConsents: boolean[];
  cacheReads: { count: number };
  /** Light backing for the "intake runs once" side: record() → 1 execution. */
  executeSpy: ReturnType<typeof vi.spyOn>;
}

function makeHarness(mutexMap: PerUrlMutexMap): ProbeHarness {
  const consentStore = { granted: true };
  const sinks = {
    ai: vi.fn(async () => ({ summary: 's' })),
    sqlite: vi.fn(async () => ({ success: true })),
    obsidian: vi.fn(async () => ({ success: true })),
  };
  const consentAtExecution: boolean[] = [];
  const settingsReadConsents: boolean[] = [];
  const cacheReads = { count: 0 };
  const orch = new RecordingOrchestrator({
    getPrivacyInfoWithCache: async () => null,
    getSettingsWithCache: (async () => {
      cacheReads.count += 1;
      settingsReadConsents.push(consentStore.granted);
      return {};
    }) as never,
    obsidian: { appendNote: sinks.obsidian } as never,
    aiService: { summarize: sinks.ai } as never,
    sqliteClient: { insert: sinks.sqlite } as never,
    perUrlMutexMap: mutexMap,
    stepDelay: async () => undefined,
  });
  // Observation seam: stands in for the 13 steps + 5-sink save tail.
  // Crucially it performs NO consent re-read — mirroring
  // executeInternalInner, which contains no hasPrivacyConsent /
  // isRecordingAllowed reference (verified by source grep).
  const executeSpy = vi.spyOn(
    orch as unknown as Record<string, (data: RecordingData, settings: unknown) => Promise<RecordingResult>>,
    'executeInternal',
  ).mockImplementation(async () => {
    consentAtExecution.push(consentStore.granted);
    await sinks.ai();
    await sinks.sqlite();
    await sinks.obsidian();
    return { success: true };
  });
  return { orch, consentStore, sinks, consentAtExecution, settingsReadConsents, cacheReads, executeSpy };
}

describe('NV-1 consent TOCTOU probe', () => {
  it('default path: mid-wait withdrawal does NOT stop execution (sinks fire)', async () => {
    const mutexMap = new PerUrlMutexMap();
    const gate = Promise.withResolvers<void>();
    const occupying = mutexMap.runExclusive(PROBE_URL, () => gate.promise);
    const h = makeHarness(mutexMap);

    const pending = h.orch.record(recordData());
    // Withdraw consent while the recording waits for the mutex.
    h.consentStore.granted = false;
    gate.resolve();
    await occupying;
    const result = await pending;

    expect(result).toEqual({ success: true });
    // Post-wait settings read is fresh (sees withdrawn) — yet execution proceeds.
    expect(h.cacheReads.count).toBe(1);
    expect(h.settingsReadConsents).toEqual([false]);
    expect(h.consentAtExecution).toEqual([false]);
    // Intake runs once: a single record() produces a single execution.
    expect(h.executeSpy).toHaveBeenCalledTimes(1);
    expect(h.sinks.ai).toHaveBeenCalledTimes(1);
    expect(h.sinks.sqlite).toHaveBeenCalledTimes(1);
    expect(h.sinks.obsidian).toHaveBeenCalledTimes(1);
  });

  it('caller-owned-settings path (manual/save): mid-wait withdrawal does NOT stop execution', async () => {
    const mutexMap = new PerUrlMutexMap();
    const gate = Promise.withResolvers<void>();
    const occupying = mutexMap.runExclusive(PROBE_URL, () => gate.promise);
    const h = makeHarness(mutexMap);

    const pending = h.orch.record(recordData(), { settings: {} as never });
    h.consentStore.granted = false;
    gate.resolve();
    await occupying;
    const result = await pending;

    expect(result).toEqual({ success: true });
    // Caller-owned settings: no cache re-read at all, consent never consulted.
    expect(h.cacheReads.count).toBe(0);
    expect(h.settingsReadConsents).toEqual([]);
    expect(h.consentAtExecution).toEqual([false]);
    // Intake runs once: a single record() produces a single execution.
    expect(h.executeSpy).toHaveBeenCalledTimes(1);
    expect(h.sinks.ai).toHaveBeenCalledTimes(1);
    expect(h.sinks.sqlite).toHaveBeenCalledTimes(1);
    expect(h.sinks.obsidian).toHaveBeenCalledTimes(1);
  });
});
