/**
 * presetSettingsAdapter.ts (PBI 2026-09-23-15)
 *
 * Thin adapter over the SettingsRepository seam for the cleansing preset key
 * and the per-site overrides key. Both callers (cleansingPresetStore,
 * perSiteOverrides) go through here instead of touching the raw storage API.
 *
 * Two non-obvious constraints shape this module:
 * - getAll() merges DEFAULT_SETTINGS, so a defaults-merged read cannot tell
 *   "stored preset" from "fresh user". The stored check reads the `settings`
 *   blob through the repository port instead, keeping the migration
 *   heuristic's exact-match-or-custom semantics unchanged.
 * - Legacy installs may hold the preset only as a scattered top-level key
 *   (pre-single-settings-object). The read path checks the blob first, then
 *   falls back to that key through the same port. The fallback is read-only:
 *   the next seam write supersedes it, so no top-level write ever remains.
 */

import { settingsRepository, type SettingsRepository } from '../../utils/storage/SettingsRepository.js';
import { StorageKeys, type DomainCleansingOverride, type Settings } from '../../utils/storage/types.js';
import type { PresetId } from '../../utils/aiSummaryCleaner/presets.js';

const PRESET_IDS: readonly string[] = ['minimal', 'balanced', 'aggressive', 'custom'];

function asPresetId(value: unknown): PresetId | undefined {
    return typeof value === 'string' && (PRESET_IDS as readonly string[]).includes(value)
        ? (value as PresetId)
        : undefined;
}

function resolveSeam(seam?: SettingsRepository): SettingsRepository {
    return seam ?? settingsRepository;
}

/**
 * Stored preset behind the seam, or undefined when never persisted.
 * Blob first (canonical location), legacy scattered top-level key second.
 * Never synthesizes the DEFAULT_SETTINGS value — callers own migration.
 */
export async function readStoredPreset(seam?: SettingsRepository): Promise<PresetId | undefined> {
    const repo = resolveSeam(seam);
    if (typeof repo.getPort === 'function') {
        const port = repo.getPort();
        const blob = await port.get(['settings']);
        const fromBlob = asPresetId((blob['settings'] as Record<string, unknown> | undefined)?.[StorageKeys.CLEANSING_PRESET]);
        if (fromBlob) return fromBlob;
        const legacy = await port.get([StorageKeys.CLEANSING_PRESET]);
        return asPresetId(legacy[StorageKeys.CLEANSING_PRESET]);
    }
    // Partial seam (older test doubles expose getAll only): the merged read
    // cannot distinguish stored from defaulted, so only a present key counts.
    if (typeof repo.getAll === 'function') {
        const all = await repo.getAll();
        const raw = (all as Record<string, unknown>)[StorageKeys.CLEANSING_PRESET];
        if (raw !== undefined) return asPresetId(raw);
        return undefined;
    }
    return undefined;
}

/** Delta write of the preset key through the repository lock. */
export async function writePreset(preset: PresetId, seam?: SettingsRepository): Promise<void> {
    const repo = resolveSeam(seam);
    if (typeof repo.set === 'function') {
        await repo.set(StorageKeys.CLEANSING_PRESET, preset);
        return;
    }
    await repo.setAll({ [StorageKeys.CLEANSING_PRESET]: preset } as Partial<Settings>);
}

/**
 * Targeted read of the per-site overrides key. Prefers the typed single-key
 * API; falls back to the bulk read on partial seams.
 */
export async function readOverrides(seam?: SettingsRepository): Promise<DomainCleansingOverride[]> {
    const repo = resolveSeam(seam);
    let raw: unknown;
    if (typeof repo.get === 'function') {
        raw = await repo.get(StorageKeys.DOMAIN_CLEANSING_OVERRIDES);
    } else {
        const all = await repo.getAll();
        raw = (all as Record<string, unknown>)[StorageKeys.DOMAIN_CLEANSING_OVERRIDES];
    }
    if (Array.isArray(raw)) return raw as DomainCleansingOverride[];
    return [];
}

/**
 * Subscribe to external preset changes through the repository seam.
 * No-op on seams without an observe API. There is no detach primitive on
 * the port, so the returned callback only silences this subscription.
 */
export function observePreset(listener: (presetId: PresetId) => void, seam?: SettingsRepository): () => void {
    const repo = resolveSeam(seam);
    let active = true;
    const forward = (changes: Partial<Settings>): void => {
        if (!active) return;
        if (!changes || !(StorageKeys.CLEANSING_PRESET in changes)) return;
        const next = asPresetId((changes as Record<string, unknown>)[StorageKeys.CLEANSING_PRESET]);
        if (next) listener(next);
    };
    if (typeof repo.observe === 'function') {
        repo.observe(forward);
    } else if (typeof repo.onChange === 'function') {
        repo.onChange(forward);
    }
    return () => { active = false; };
}
