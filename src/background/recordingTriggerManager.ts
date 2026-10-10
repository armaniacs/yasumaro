/**
 * recordingTriggerManager.ts
 * Manages recording trigger settings and provides shouldRecord() evaluation.
 * Integrates with chrome.alarms for periodic snapshots.
 */

import { StorageKeys } from '../utils/storage/types.js';
import { DEFAULT_MIN_SCROLL_DEPTH, DEFAULT_MIN_VISIT_DURATION } from '../utils/visitThresholds.js';
import { settingsRepository } from '../utils/storage/SettingsRepository.js';
import { decideRecordingTrigger } from './pipeline/recordingDecision.js';

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
   * Evaluate whether an event should trigger recording.
   * Verdict は pipeline/recordingDecision.decideRecordingTrigger に委譲
   * （storage 読みの I/O はここに残す）。
   */
  async shouldRecord(event: RecordingEvent): Promise<boolean> {
    const triggers = await this.loadTriggers();

    if (event.type === 'scroll_idle') {
      // Read user-configured thresholds from the settings blob — the only
      // writer (recordingConditionsSettings) saves through the repository.
      // A previous top-level read always missed and fell back to defaults.
      const {
        [StorageKeys.MIN_SCROLL_DEPTH]: minScrollDepth = DEFAULT_MIN_SCROLL_DEPTH,
        [StorageKeys.MIN_VISIT_DURATION]: minVisitDuration = DEFAULT_MIN_VISIT_DURATION,
      } = await settingsRepository.getMany([StorageKeys.MIN_SCROLL_DEPTH, StorageKeys.MIN_VISIT_DURATION]);
      return decideRecordingTrigger(event, triggers, minScrollDepth, minVisitDuration * 1000);
    }

    return decideRecordingTrigger(event, triggers, 50, 5000);
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
   * Invalidate cache so next loadTriggers re-reads from storage.
   */
  invalidateCache(): void {
    this.cachedTriggers = null;
  }
}
