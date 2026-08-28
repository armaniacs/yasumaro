/**
 * settingsStore.ts — deprecated shim (PBI-04)
 * This file re-exports the legacy implementation for backward compatibility.
 * New code must use SettingsRepository (src/utils/storage/SettingsRepository.ts) instead.
 * The legacy implementation lives in settingsStore.legacy.ts and will be removed
 * once all 34 call sites are migrated. The eslint no-restricted-imports rule
 * errors on new imports from this path.
 * @deprecated Use SettingsRepository instead
 */
export * from './settingsStore.legacy.js';
