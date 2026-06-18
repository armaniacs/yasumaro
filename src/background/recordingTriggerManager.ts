/**
 * recordingTriggerManager.ts
 * Manages recording trigger settings and provides shouldRecord() evaluation.
 * Integrates with chrome.alarms for periodic snapshots.
 */

import { StorageKeys } from '../utils/storage.js';
import { addLog, LogType } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';

// ============================================================================
// Types
// ============================================================================

export interface RecordingTriggers {
  scrollAndTime: boolean;
  manualSave: boolean;
  periodicSnapshot: boolean;
}

const DEFAULT_TRIGGERS: RecordingTriggers = {
  scrollAndTime: false,
  manualSave: true,
  periodicSnapshot: false,
};

export interface RecordingEvent {
  type: 'scroll_idle' | 'manual_save' | 'snapshot';
  /** Scroll percentage (0-100). Only for scroll_idle events. */
  scrollPercent?: number;
  /** Visit duration in ms. Only for scroll_idle events. */
  visitDuration?: number;
}

// ============================================================================
// RecordingTriggerManager
// ============================================================================

export class RecordingTriggerManager {
  private cachedTriggers: RecordingTriggers | null = null;
  private storageListener: ((changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => void) | null = null;

  constructor() {
    this.setupStorageListener();
  }

  private setupStorageListener(): void {
    if (this.storageListener) return;

    this.storageListener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== 'local') return;

      if (StorageKeys.RECORDING_TRIGGERS in changes) {
        this.cachedTriggers = null;
      }
    };

    try {
      chrome.storage.onChanged.addListener(this.storageListener);
    } catch {
      this.storageListener = null;
    }
  }

  /**
   * Load trigger settings from chrome.storage.local with caching.
   */
  async loadTriggers(): Promise<RecordingTriggers> {
    if (this.cachedTriggers) return this.cachedTriggers;

    try {
      const result = await chrome.storage.local.get(StorageKeys.RECORDING_TRIGGERS);
      const raw = result[StorageKeys.RECORDING_TRIGGERS];
      if (typeof raw === 'string') {
        const parsed = JSON.parse(raw) as Partial<RecordingTriggers>;
        this.cachedTriggers = { ...DEFAULT_TRIGGERS, ...parsed };
      } else {
        this.cachedTriggers = { ...DEFAULT_TRIGGERS };
      }
    } catch {
      this.cachedTriggers = { ...DEFAULT_TRIGGERS };
    }

    return this.cachedTriggers!;
  }

  /**
   * Save trigger settings to chrome.storage.local.
   * Validates that at least one trigger is enabled before saving.
   */
  async saveTriggers(triggers: RecordingTriggers): Promise<boolean> {
    try {
      // Validate before saving to prevent silent failure (all triggers OFF)
      const validation = this.validate(triggers);
      if (!validation.valid) {
        addLog(LogType.WARN, 'Recording trigger validation failed', { error: validation.error });
        return false;
      }

      const raw = JSON.stringify(triggers);
      await chrome.storage.local.set({ [StorageKeys.RECORDING_TRIGGERS]: raw });
      this.cachedTriggers = { ...triggers };
      addLog(LogType.INFO, 'Recording triggers saved', { triggers });
      return true;
    } catch (error) {
      addLog(LogType.ERROR, 'Failed to save recording triggers', {
        error: errorMessage(error),
      });
      return false;
    }
  }

  /**
   * Evaluate whether an event should trigger recording.
   */
  async shouldRecord(event: RecordingEvent): Promise<boolean> {
    const triggers = await this.loadTriggers();

    switch (event.type) {
      case 'scroll_idle': {
        if (!triggers.scrollAndTime) return false;
        // Read user-configured thresholds from storage, fall back to defaults
        const settings = await chrome.storage.local.get([StorageKeys.MIN_SCROLL_DEPTH, StorageKeys.MIN_VISIT_DURATION]);
        const minScrollDepth = (settings[StorageKeys.MIN_SCROLL_DEPTH] as number) ?? 50;
        const minVisitDuration = (settings[StorageKeys.MIN_VISIT_DURATION] as number) ?? 5;
        if ((event.scrollPercent ?? 0) < minScrollDepth) return false;
        if ((event.visitDuration ?? 0) < minVisitDuration * 1000) return false;
        return true;
      }

      case 'manual_save':
        return triggers.manualSave;

      case 'snapshot':
        return triggers.periodicSnapshot;

      default:
        return false;
    }
  }

  /**
   * Validate that at least one trigger is enabled.
   */
  validate(triggers: RecordingTriggers): { valid: boolean; error?: string } {
    const enabled = Object.values(triggers).filter(Boolean).length;
    if (enabled === 0) {
      return { valid: false, error: 'At least one recording trigger must be enabled.' };
    }
    return { valid: true };
  }

  /**
   * Get the snapshot interval from storage.
   */
  async getSnapshotIntervalMinutes(): Promise<number> {
    try {
      const result = await chrome.storage.local.get(StorageKeys.SNAPSHOT_INTERVAL_MINUTES);
      return (result[StorageKeys.SNAPSHOT_INTERVAL_MINUTES] as number) || 5;
    } catch {
      return 5;
    }
  }

  /**
   * Save snapshot interval.
   */
  async saveSnapshotInterval(minutes: number): Promise<boolean> {
    try {
      const clamped = Math.max(1, Math.min(60, minutes));
      await chrome.storage.local.set({ [StorageKeys.SNAPSHOT_INTERVAL_MINUTES]: clamped });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Invalidate cache so next loadTriggers re-reads from storage.
   */
  invalidateCache(): void {
    this.cachedTriggers = null;
  }
}
