/**
 * cleansingPresetStore.ts (PBI 2026-09-15-05)
 *
 * 深い module: クレンジングプリセットの適用・マイグレーション・custom 遷移の
 * 順序制約（apply epoch・二重書き込み・反映ガード）をすべて内部に隠す。
 *
 * 不変条件:
 * - busy 窓（applyPreset の反映・マイグレーション・初期描画窓）の間、
 *   markCustomOnManualEdit は何もしない。手動トグルの change は UI 反映中の
 *   checkbox.checked 代入では発火しないが、ユーザー操作が busy 窓に重なった
 *   場合の退行をここで防ぐ（dashboard-cleansing-preset.spec.ts で pin 済み）。
 * - プリセット書き込みは settings blob（32値）とトップレベルキーの**両方**に
 *   反映する。select はトップレベルキーを読むため、片方だけの書き込みは
 *   UI を古い値へ戻す（これがプリセット競合バグの正体）。
 * - マイグレーションの detect 読み取りが applyPreset と重なった場合、
 *   apply epoch の増分を検知して書き込みを諦める（stale 値の上書き防止）。
 *
 * この module は DOM を知らない。View 配線（select.value の同期・32 checkbox
 * の反映）は subscribe() の購読と runReflecting() で行う。
 */

import { settingsRepository } from '../../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { ErrorCode } from '../../utils/logger/types.js';
import { logError } from '../../utils/logger/api.js';
import { CLEANSING_RULES } from '../../utils/aiSummaryCleaner/rules.js';
import { PRESETS, type PresetId, type CleansingConfig } from '../../utils/aiSummaryCleaner/presets.js';

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
    /** トップレベルキーから現在の preset を読む。未設定なら migrate して返す。 */
    getPreset(): Promise<PresetId>;
    /** マイグレーションが未実施なら実行する（冪等）。 */
    ensureMigrated(): Promise<void>;
    /** プリセット適用: 32値の blob 書き込み + トップレベルキー + 購読者通知。 */
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
    const listeners = new Set<(presetId: PresetId) => void>();

    const notify = (presetId: PresetId): void => {
        for (const listener of listeners) {
            try { listener(presetId); } catch { /* listener errors must not break the store */ }
        }
    };

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
            const stored = await chrome.storage.local.get(StorageKeys.CLEANSING_PRESET);
            return (stored[StorageKeys.CLEANSING_PRESET] as PresetId | undefined) ?? 'custom';
        },

        async ensureMigrated(): Promise<void> {
            if (migrationPromise) return migrationPromise;
            migrationPromise = (async () => {
                try {
                    const stored = await chrome.storage.local.get(StorageKeys.CLEANSING_PRESET);
                    if (stored[StorageKeys.CLEANSING_PRESET]) return;
                    const myEpoch = applyEpoch;
                    state = 'busy';
                    const all = await settingsRepository.getAll();
                    // An applyPreset started while the repository read above was in
                    // flight: its values are newer than what detectPreset would see,
                    // so the migration must not overwrite them.
                    if (myEpoch !== applyEpoch) return;
                    // Re-check before writing: a concurrent applyPreset may have
                    // written meanwhile.
                    const recheck = await chrome.storage.local.get(StorageKeys.CLEANSING_PRESET);
                    if (recheck[StorageKeys.CLEANSING_PRESET]) return;
                    // 既存ユーザーのカスタム設定を尊重: 完全一致しない場合は custom として
                    // 保存し 32値の消失を防ぐ（ヒューリスティック上書きはしない）。
                    const exact = detectPreset(all);
                    const preset: PresetId = exact !== 'custom' ? exact : 'custom';
                    await chrome.storage.local.set({ [StorageKeys.CLEANSING_PRESET]: preset });
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
                // Dual write: the select reads the top-level key while the
                // repository stores the blob — both must move together or the
                // read source goes stale and reverts the UI.
                await chrome.storage.local.set({ [StorageKeys.CLEANSING_PRESET]: presetId });
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
                const stored = await chrome.storage.local.get(StorageKeys.CLEANSING_PRESET);
                const cur = stored[StorageKeys.CLEANSING_PRESET] as string | undefined;
                if (cur && cur !== 'custom') {
                    await chrome.storage.local.set({ [StorageKeys.CLEANSING_PRESET]: 'custom' });
                    notify('custom');
                }
            } catch { // storage read failure must not break the checkbox handler
            }
        },
    };

    return store;
}
