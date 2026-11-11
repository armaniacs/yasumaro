/**
 * consentToctou regression guard (PBI 2026-11-12-01; promoted from the NV-1
 * verification probe).
 *
 * SCOPE (回帰ガードであり発火デモではない):
 * - 本テストは実 `record()` 経路を検証する: per-URL mutex 待機 → mutex 獲得
 *   直後の `isConsentGranted` 再読 → 撤回時は `privacy_consent_required`
 *   拒否、維持時は `executeInternal` への配送。旧 probe (stub 配線の自己
 *   観測: consent store / settingsReadConsents / consentAtExecution は自作
 *   スタブで、本番 seam 未配線) から昇格した。
 * - 注入点は本番と同じ: `compositionManifest` の recordingPipeline factory
 *   が `isConsentGranted: () => hasPrivacyConsent()` を渡す位置に、本テスト
 *   は可変ストアを読むフェイクを注入する。settings blob 外の同意は
 *   `getSettingsWithCache` 再読では観測できないため、この専用 seam が必須
 *   である (settings 再読では代用不可)。
 * - `executeInternal` の中身 (13 steps + 5-sink save tail) はスタブのまま:
 *   呼ばれたら sink フェイクを発火させることで、ゲートが配送を止めた場合
 *   に sink が沈黙することまで証明する。ステップ自体の成否は
 *   RecordingPipeline.test.ts 系の責務であり、ここでは配送の有無だけを
 *   assert する。
 * - 「intake で1回」側 (RecordingAdmission.admit が intake 時に同意を1回
 *   読むこと) は本ガードの対象外: recordingAdmission.test.ts 側の責務。
 *
 * No wall-clock waits — mutex hold/release is fully deterministic via a
 * Promise.withResolvers gate (same style as
 * recordingOrchestrator-settingsRefresh.test.ts).
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
  consentReads: { count: number };
  /** Stubbed sinks: call counts prove whether the save tail fired. */
  sinks: { ai: ReturnType<typeof vi.fn>; sqlite: ReturnType<typeof vi.fn>; obsidian: ReturnType<typeof vi.fn> };
  cacheReads: { count: number };
  seenMarkers: string[];
  /** Dispatch observation: the stubbed core records its invocation. */
  executeSpy: ReturnType<typeof vi.spyOn>;
}

function makeHarness(mutexMap: PerUrlMutexMap, marker: { value: string }): ProbeHarness {
  const consentStore = { granted: true };
  const consentReads = { count: 0 };
  const sinks = {
    ai: vi.fn(async () => ({ summary: 's' })),
    sqlite: vi.fn(async () => ({ success: true })),
    obsidian: vi.fn(async () => ({ success: true })),
  };
  const cacheReads = { count: 0 };
  const seenMarkers: string[] = [];
  const orch = new RecordingOrchestrator({
    getPrivacyInfoWithCache: async () => null,
    getSettingsWithCache: (async () => {
      cacheReads.count += 1;
      seenMarkers.push(marker.value);
      return {};
    }) as never,
    // Same injection point the composition manifest wires to
    // `hasPrivacyConsent()`; the mutable store lets the test flip consent
    // mid-wait deterministically.
    isConsentGranted: (async () => {
      consentReads.count += 1;
      return consentStore.granted;
    }) as () => Promise<boolean>,
    obsidian: { appendNote: sinks.obsidian } as never,
    aiService: { summarize: sinks.ai } as never,
    sqliteClient: { insert: sinks.sqlite } as never,
    perUrlMutexMap: mutexMap,
    stepDelay: async () => undefined,
  });
  // The stub stands in for the 13 steps + save tail: if the post-mutex gate
  // dispatches, the sink fakes fire (pre-fix behaviour); if the gate
  // refuses, nothing below runs.
  const executeSpy = vi.spyOn(
    orch as unknown as Record<string, (data: RecordingData, settings: unknown) => Promise<RecordingResult>>,
    'executeInternal',
  ).mockImplementation(async () => {
    await sinks.ai();
    await sinks.sqlite();
    await sinks.obsidian();
    return { success: true };
  });
  return { orch, consentStore, consentReads, sinks, cacheReads, seenMarkers, executeSpy };
}

describe('NV-1 consent TOCTOU guard (PBI 2026-11-12-01)', () => {
  it('default path: mid-wait withdrawal is refused and no sink fires', async () => {
    const mutexMap = new PerUrlMutexMap();
    const gate = Promise.withResolvers<void>();
    const occupying = mutexMap.runExclusive(PROBE_URL, () => gate.promise);
    const marker = { value: 'v1-consented' };
    const h = makeHarness(mutexMap, marker);

    const pending = h.orch.record(recordData());
    // Withdraw consent while the recording waits for the mutex.
    h.consentStore.granted = false;
    marker.value = 'v2-withdrawn';
    gate.resolve();
    await occupying;
    const result = await pending;

    expect(result).toEqual({
      success: false,
      error: 'privacy_consent_required',
      reason: 'privacy_consent_required',
      title: 'T',
      url: PROBE_URL,
    });
    // The gate re-read consent after acquiring the mutex and stopped the
    // dispatch: the core and every sink stay silent.
    expect(h.consentReads.count).toBe(1);
    expect(h.executeSpy).not.toHaveBeenCalled();
    expect(h.sinks.ai).not.toHaveBeenCalled();
    expect(h.sinks.sqlite).not.toHaveBeenCalled();
    expect(h.sinks.obsidian).not.toHaveBeenCalled();
  });

  it('caller-owned-settings path (manual/save): mid-wait withdrawal is refused', async () => {
    const mutexMap = new PerUrlMutexMap();
    const gate = Promise.withResolvers<void>();
    const occupying = mutexMap.runExclusive(PROBE_URL, () => gate.promise);
    const h = makeHarness(mutexMap, { value: 'from-caller' });

    const pending = h.orch.record(recordData(), { settings: {} as never });
    h.consentStore.granted = false;
    gate.resolve();
    await occupying;
    const result = await pending;

    expect(result).toEqual({
      success: false,
      error: 'privacy_consent_required',
      reason: 'privacy_consent_required',
      title: 'T',
      url: PROBE_URL,
    });
    // Caller-owned settings: no cache read, but the same gate still refuses.
    expect(h.consentReads.count).toBe(1);
    expect(h.cacheReads.count).toBe(0);
    expect(h.executeSpy).not.toHaveBeenCalled();
    expect(h.sinks.ai).not.toHaveBeenCalled();
    expect(h.sinks.sqlite).not.toHaveBeenCalled();
    expect(h.sinks.obsidian).not.toHaveBeenCalled();
  });

  it('consent maintained: the recording still runs with fresh post-wait settings', async () => {
    const mutexMap = new PerUrlMutexMap();
    const gate = Promise.withResolvers<void>();
    const occupying = mutexMap.runExclusive(PROBE_URL, () => gate.promise);
    const marker = { value: 'v1-consented' };
    const h = makeHarness(mutexMap, marker);

    const pending = h.orch.record(recordData());
    marker.value = 'v2-still-consented';
    gate.resolve();
    await occupying;
    const result = await pending;

    expect(result).toEqual({ success: true });
    expect(h.consentReads.count).toBe(1);
    expect(h.executeSpy).toHaveBeenCalledTimes(1);
    // Post-mutex freshness (PBI 2026-11-08-07) still holds through the gate.
    expect(h.seenMarkers).toEqual(['v2-still-consented']);
    expect(h.sinks.ai).toHaveBeenCalledTimes(1);
    expect(h.sinks.sqlite).toHaveBeenCalledTimes(1);
    expect(h.sinks.obsidian).toHaveBeenCalledTimes(1);
  });

  it('preview path: mid-wait withdrawal is refused and nothing renders', async () => {
    const mutexMap = new PerUrlMutexMap();
    const gate = Promise.withResolvers<void>();
    const occupying = mutexMap.runExclusive(PROBE_URL, () => gate.promise);
    const h = makeHarness(mutexMap, { value: 'preview' });

    const pending = h.orch.preview(recordData());
    // Withdraw consent while the preview waits for the mutex.
    h.consentStore.granted = false;
    gate.resolve();
    await occupying;
    const result = await pending;

    expect(result).toEqual({
      success: false,
      error: 'privacy_consent_required',
      reason: 'privacy_consent_required',
      title: 'T',
      url: PROBE_URL,
    });
    expect(h.consentReads.count).toBe(1);
    expect(h.executeSpy).not.toHaveBeenCalled();
    expect(h.sinks.ai).not.toHaveBeenCalled();
    expect(h.sinks.sqlite).not.toHaveBeenCalled();
    expect(h.sinks.obsidian).not.toHaveBeenCalled();
  });

  it('retryObsidianWrite path: mid-wait withdrawal refuses the re-write', async () => {
    const mutexMap = new PerUrlMutexMap();
    const gate = Promise.withResolvers<void>();
    const occupying = mutexMap.runExclusive(PROBE_URL, () => gate.promise);
    const h = makeHarness(mutexMap, { value: 'retry' });
    const saveRetrySpy = vi.spyOn(
      (h.orch as unknown as { savePhase: { saveRetry: (...args: never[]) => Promise<unknown> } }).savePhase,
      'saveRetry',
    );

    const pending = h.orch.retryObsidianWrite({ title: 'T', url: PROBE_URL, summary: 's' });
    // Withdraw consent while the retry waits for the mutex.
    h.consentStore.granted = false;
    gate.resolve();
    await occupying;
    const result = await pending;

    // False keeps the offline-queue job instead of writing without consent.
    expect(result).toBe(false);
    expect(h.consentReads.count).toBe(1);
    expect(saveRetrySpy).not.toHaveBeenCalled();
    expect(h.sinks.obsidian).not.toHaveBeenCalled();
  });
});
