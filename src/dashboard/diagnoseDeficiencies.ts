/**
 * diagnoseDeficiencies.ts
 * Pure function for SQLite capability deficiency diagnosis.
 *
 * Takes environment capabilities and DB state as input,
 * returns an array of deficiency items with severity and recommended actions.
 * No side effects — fully testable in isolation.
 */

import type { VfsStrategy } from '../offscreen/opfsCapabilities.js';

/** Input for the deficiency diagnosis function. */
export interface DiagnosticInput {
  /** Whether navigator.storage.getDirectory() is available. */
  opfsDirectory: boolean;
  /** Whether FileSystemFileHandle.prototype.createSyncAccessHandle is available. */
  syncAccessHandle: boolean;
  /** Whether the Worker constructor is available. */
  worker: boolean;
  /** Whether the database was successfully initialized. */
  initialized: boolean;
  /** Whether using FallbackStorage (chrome.storage.local). */
  fallback: boolean;
  /** Whether FTS5 virtual table is available. */
  fts5: boolean;
  /** Error message from last failed init (if any). */
  initError?: string;
  /** Detected VFS strategy. */
  vfsStrategy: VfsStrategy;
}

/** Severity levels for deficiency items. */
export type DeficiencySeverity = 'none' | 'low' | 'medium' | 'high';

/** A single deficiency item returned by the diagnosis. */
export interface DeficiencyItem {
  /** Unique identifier for the deficiency (e.g., 'no-opfs', 'no-fts5'). */
  id: string;
  /** Severity level. */
  severity: DeficiencySeverity;
  /** i18n key for the summary message (shown in collapsed view). */
  summaryKey: string;
  /** i18n key for the detailed message (shown in expanded view). */
  detailKey: string;
  /** i18n key for the recommended action. */
  recommendedActionKey: string;
}

/**
 * Diagnose SQLite capability deficiencies based on environment and DB state.
 *
 * This is a pure function with no side effects. All inputs are provided
 * explicitly, and the output is a deterministic array of deficiency items.
 *
 * @param input - Environment capabilities and DB state
 * @returns Array of deficiency items (empty if no deficiencies)
 */
export function diagnoseDeficiencies(input: DiagnosticInput): DeficiencyItem[] {
  const items: DeficiencyItem[] = [];

  // OPFS not available AND using fallback storage (IDB or chrome.storage.local).
  // When IDB is working, OPFS absence is not a deficiency.
  if (!input.opfsDirectory && input.fallback) {
    items.push({
      id: 'no-opfs',
      severity: 'high',
      summaryKey: 'diagDeficiencyNoOpfsSummary',
      detailKey: 'diagDeficiencyNoOpfsDetail',
      recommendedActionKey: 'diagDeficiencyNoOpfsAction',
    });
  }

  // SyncAccessHandle not available (but OPFS directory is)
  if (!input.syncAccessHandle && input.opfsDirectory) {
    items.push({
      id: 'no-sync-access-handle',
      severity: 'medium',
      summaryKey: 'diagDeficiencyNoSyncHandleSummary',
      detailKey: 'diagDeficiencyNoSyncHandleDetail',
      recommendedActionKey: 'diagDeficiencyNoSyncHandleAction',
    });
  }

  // Worker not available (but OPFS directory is)
  if (!input.worker && input.opfsDirectory) {
    items.push({
      id: 'no-worker',
      severity: 'medium',
      summaryKey: 'diagDeficiencyNoWorkerSummary',
      detailKey: 'diagDeficiencyNoWorkerDetail',
      recommendedActionKey: 'diagDeficiencyNoWorkerAction',
    });
  }

  // FTS5 not available
  if (!input.fts5 && input.initialized) {
    // Different message depending on whether it's OPFS sync build or IDB
    if (input.vfsStrategy === 'opfs-sync-worker') {
      items.push({
        id: 'opfs-no-fts5',
        severity: 'low',
        summaryKey: 'diagDeficiencyOpfsNoFts5Summary',
        detailKey: 'diagDeficiencyOpfsNoFts5Detail',
        recommendedActionKey: 'diagDeficiencyOpfsNoFts5Action',
      });
    } else {
      items.push({
        id: 'no-fts5',
        severity: 'low',
        summaryKey: 'diagDeficiencyNoFts5Summary',
        detailKey: 'diagDeficiencyNoFts5Detail',
        recommendedActionKey: 'diagDeficiencyNoFts5Action',
      });
    }
  }

  // Initialization failed
  if (!input.initialized && input.initError) {
    items.push({
      id: 'init-failed',
      severity: 'high',
      summaryKey: 'diagDeficiencyInitFailedSummary',
      detailKey: 'diagDeficiencyInitFailedDetail',
      recommendedActionKey: 'diagDeficiencyInitFailedAction',
    });
  }

  // Not initialized (no error — might just need reload)
  if (!input.initialized && !input.initError) {
    items.push({
      id: 'not-initialized',
      severity: 'medium',
      summaryKey: 'diagDeficiencyNotInitializedSummary',
      detailKey: 'diagDeficiencyNotInitializedDetail',
      recommendedActionKey: 'diagDeficiencyNotInitializedAction',
    });
  }

  // Fallback mode active
  if (input.fallback) {
    items.push({
      id: 'fallback-mode',
      severity: 'high',
      summaryKey: 'diagDeficiencyFallbackSummary',
      detailKey: 'diagDeficiencyFallbackDetail',
      recommendedActionKey: 'diagDeficiencyFallbackAction',
    });
  }

  return items;
}
