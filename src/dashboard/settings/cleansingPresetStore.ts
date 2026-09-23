/**
 * cleansingPresetStore.ts (PBI 2026-09-15-05, seam migration 2026-09-23-15)
 *
 * Deep module: preset apply / migration / custom-transition ordering
 * (apply epoch, repository-locked writes, reflect guards) all hidden inside.
 *
 * Invariants:
 * - During the busy window (applyPreset reflect, migration, initial render),
 *   markCustomOnManualEdit does nothing. Manual-toggle change events do not
 *   fire on programmatic checkbox.checked assignment, but this guard covers
 *   user input landing inside the window (pinned by dashboard-cleansing-preset
 *   e2e).
 * - Preset persistence goes only through the SettingsRepository seam
 *   (presetSettingsAdapter): the single setAll delta carries both the
 *   32 rule values and the preset key inside the repository lock, so no
 *   out-of-lock top-level dual write can revert the UI to a stale value.
 * - A migration detect read racing applyPreset abandons its write when the
 *   apply epoch advanced (no stale overwrite).
 * - Legacy installs may hold the preset only as a scattered top-level key.
 *   Reads check the repository blob first and fall back to that key; the
 *   first migration write converges it into the blob. The fallback is
 *   read-only — writes never touch the top level directly.
 *
 * This module does not know the DOM. View wiring (select.value sync, 32
 * checkbox reflect) goes through subscribe() plus runReflecting().
 */

import { settingsRepository } from '../../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { ErrorCode } from '../../utils/logger/types.js';
import { logError } from '../../utils/logger/api.js';
import { CLEANSING_RULES } from '../../utils/aiSummaryCleaner/rules.js';
import { PRESETS, type PresetId, type CleansingConfig } from '../../utils/aiSummaryCleaner/presets.js';
import { observePreset, readStoredPreset, writePreset } from './presetSettingsAdapter.js';

/** 既存の 32値から preset を推定（マイグレーション用ヒューリスティック）。
 *  - deepEnabled→aggressive, news/ec→balanced, else minimal
 *  純粋関数でストレージへの副作用なし。（V2 から移動、V2 が re-export） */
export function migrateToPreset(config: Partial<CleansingConfig> | Record<string, unknown>): PresetId {
    const c = config as Record<string, unknown>;
    if (c['deepEnabled'] === true) return 'aggressive';
    if (c['newsMediaEnabled'] === true || c['ecSiteEnabled'] === true) return 'balanced';
    return 'minimal';
}

/** config がいずれかの preset と完全一致するか判定。カスタム検出用。（V2 から移動） */
export function detectPreset(config: Partial<CleansingConfig> | Record<string, unknown>): PresetId {
    for (const pid of ['minimal', 'balanced', 'aggressive'] as const) {
        const preset = PRESETS[pid];
        let match = true;
        for (const [k, v] of Object.entries(preset)) {
            if ((config as Record<string, unknown>)[k] !== v) { match = false; break; }
        }
        if (match) return pid;
    }
    return 'custom';
}

export type PresetStoreState = 'idle' | 'busy';

export interface CleansingPresetStore {
    /** Current preset through the repository seam; migrates first when unset. */
    getPreset(): Promise<PresetId>;
    /** Run migration when nothing is stored yet (idempotent). */
    ensureMigrated(): Promise<void>;
    /** Apply a preset: 32-value blob write + preset key in one locked delta + notify. */
    applyPreset(presetId: PresetId): Promise<void>;
    /** 手動トグル後の custom 遷移。busy 窓中は何もしない（ガードは内部）。 */
    markCustomOnManualEdit(): Promise<void>;
    /** preset 変更の購読（select.value の同期など View 側で使う）。 */
    subscribe(listener: (presetId: PresetId) => void): () => void;
    /** busy 中か（UI 反映がプリセット遷移と重なってはいけない呼び出し側の確認用）。 */
    isBusy(): boolean;
    /** 長い busy 窓を開ける（module load → setup + 300ms の初期描画保護）。
     *  runReflecting の finally はこの窓を閉じない。 */
    holdBusy(): void;
    /** setup 完了後 300ms で busy 窓を閉じる（旧 _initialRenderGuard 相当）。 */
    releaseInitialRenderWindow(): void;
    /** UI 反映（32 checkbox への代入など）を busy 窓の中で実行する。 */
    runReflecting<T>(fn: () => T | Promise<T>): Promise<T>;
}

export function createCleansingPresetStore(): CleansingPresetStore {
    let state: PresetStoreState = 'idle';
    let held = false; // long window (module load → setup + 300ms) — runReflecting must not clear it
    let migrationPromise: Promise<void> | null = null;
    let applyEpoch = 0;
    let lastNotified: PresetId | null = null;
    const listeners = new Set<(presetId: PresetId) => void>();

    const notify = (presetId: PresetId): void => {
        lastNotified = presetId;
        for (const listener of listeners) {
            try { listener(presetId); } catch { /* listener errors must not break the store */ }
        }
    };

    // External preset changes (another dashboard context writing through the
    // repository) reach subscribers via the seam. The echo of our own writes
    // matches lastNotified and is dropped, so subscribers see one event per
    // transition. No-op on seams without an observe API.
    observePreset((presetId) => {
        if (presetId !== lastNotified) notify(presetId);
    });

    const scheduleIdle = (): void => {
        // Same timing as the removed setTimeout guards: the busy window must
        // outlive the current task so same-tick checkbox bookkeeping stays
        // inside the guard. A held window (module load → setup + 300ms) is
        // never cleared by the 0ms timer.
        setTimeout(() => {
            if (state === 'busy' && !held) state = 'idle';
        }, 0);
    };

    const store: CleansingPresetStore = {
    isBusy(): boolean {
        return state !== 'idle';
    },

    holdBusy(): void {
        held = true;
        state = 'busy';
    },

    releaseInitialRenderWindow(): void {
        setTimeout(() => {
            held = false;
            if (state === 'busy') state = 'idle';
        }, 300);
    },

    runReflecting<T>(fn: () => T | Promise<T>): Promise<T> {
        state = 'busy';
        return (async () => {
            try {
                return await fn();
            } finally {
                scheduleIdle();
            }
        })();
    },

    subscribe(listener: (presetId: PresetId) => void): () => void {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        async getPreset(): Promise<PresetId> {
            await store.ensureMigrated();
            return (await readStoredPreset()) ?? 'custom';
        },

        async ensureMigrated(): Promise<void> {
            if (migrationPromise) return migrationPromise;
            migrationPromise = (async () => {
                try {
                    if (await readStoredPreset()) return;
                    const myEpoch = applyEpoch;
                    state = 'busy';
                    const all = await settingsRepository.getAll();
                    // An applyPreset started while the repository read above was in
                    // flight: its values are newer than what detectPreset would see,
                    // so the migration must not overwrite them.
                    if (myEpoch !== applyEpoch) return;
                    // Re-check before writing: a concurrent applyPreset may have
                    // written meanwhile.
                    if (await readStoredPreset()) return;
                    // Respect existing users' custom settings: without an exact
                    // preset match persist custom so no 32-value is lost (the
                    // heuristic never overwrites).
                    const exact = detectPreset(all);
                    const preset: PresetId = exact !== 'custom' ? exact : 'custom';
                    await writePreset(preset);
                    notify(preset);
                } catch (e) {
                    logError('Failed to migrate cleansing preset', { cause: e }, ErrorCode.STORAGE_WRITE_FAILURE);
                } finally {
                    scheduleIdle();
                }
            })();
            return migrationPromise;
        },

        async applyPreset(presetId: PresetId): Promise<void> {
            applyEpoch++;
            state = 'busy';
            try {
                const preset = PRESETS[presetId];
                // Delta write (PBI 2026-09-17-17) — only the keys this preset
                // owns enter the payload; a full getAll() snapshot would
                // revert unrelated keys a concurrent writer changed.
                const delta: Record<string, unknown> = {
                    [StorageKeys.CLEANSING_PRESET]: presetId,
                };
                if (presetId !== 'custom') {
                    for (const rule of CLEANSING_RULES) {
                        const optKey = `${rule.key}Enabled` as keyof CleansingConfig;
                        const val = (preset as Record<string, unknown>)[optKey as string];
                        if (typeof val === 'boolean') {
                            delta[rule.storageKey] = val;
                        }
                    }
                }
                await settingsRepository.setAll(delta);
                // Single writer: the delta above already carries the preset key
                // inside the repository lock, which is exactly where every
                // reader (select via getPreset, contentKernel via the blob)
                // looks — no out-of-lock top-level write remains.
                notify(presetId);
            } catch (e) {
                logError('Failed to apply cleansing preset', { cause: e }, ErrorCode.STORAGE_WRITE_FAILURE);
                throw e;
            } finally {
                scheduleIdle();
            }
        },

        async markCustomOnManualEdit(): Promise<void> {
            if (state !== 'idle') return; // applying / migrating / initial-render window
            try {
                const cur = await readStoredPreset();
                if (cur && cur !== 'custom') {
                    await writePreset('custom');
                    notify('custom');
                }
            } catch { // storage read failure must not break the checkbox handler
            }
        },
    };

    return store;
}
