/**
 * digestBatchCheckpointStore.ts
 *
 * Production DigestCheckpointStore for the resumable weekly digest batch
 * (PBI 2026-10-22-03, batch wiring).
 *
 * 検査点: chrome.storage.local under the module-owned namespaced key
 * DIGEST_BATCH_CHECKPOINT_KEY (not StorageKeys: no shared-file edits, the
 * reminderStore.ts pattern). The payload is the id list only — the partial
 * digest never lands in storage (quota guard, the PBI's 実装 Q3). Storage is
 * untrusted (corrupt restores, older shapes): every load validates and fails
 * closed to null, with typeof guards (no any/unknown).
 *
 * 完了標識の標識統一: the completion marker IS the existing
 * REVIEW_SUMMARY_LAST_GENERATED_WEEK key ('YYYY-Www') that the weekly
 * generator (reviewSummaryGenerator.ts) already guards and writes. The batch
 * never writes it through a second seam: reads go through the same
 * blob-authoritative settings getAll() the generator checks, and writes go
 * through the same settings repo set() the generator uses after a successful
 * publish — a raw chrome.storage.local.set here would be invisible to
 * blob-authoritative getAll() in migrated profiles, which re-ran the AI
 * digest every alarm (the bug recorded in the reviewSummaryGenerator.ts
 * comment). Because both paths guard the same single key with the same
 * period value, exactly one publisher per week wins and the digest is never
 * published twice (Daily Note 二重追記なし).
 *
 * saveCompletedPeriod keeps the marker a single atomic write per period: the
 * publisher already wrote it inside publishDigest, so a matching marker is
 * skipped instead of re-written. The write only happens when a publisher
 * returned success without writing the marker (contract safety), and a
 * monotonicity guard refuses a write that would regress a newer completion
 * marker to an older period — the AI call inside publishDigest can outlive
 * the week (週替わり TOCTOU), and the weekly alarm's later run must not see
 * the older marker and re-publish the newer week.
 */

import type { DigestBatchCheckpoint, DigestCheckpointStore } from './digestBatchJob.js';
import { StorageKeys } from '../utils/storage/types.js';
import { settingsRepository, type SettingsReader, type SettingsRepository } from '../utils/storage/SettingsRepository.js';
import { CHROME_STORAGE_PORT, type StorageArea } from '../utils/ports.js';

/** Module-owned namespaced checkpoint key (not StorageKeys: no shared-file edits). */
export const DIGEST_BATCH_CHECKPOINT_KEY = 'yasumaro_digest_batch_checkpoint_v1';

export interface DigestBatchCheckpointStoreDeps {
  storage: Pick<StorageArea, 'get' | 'set' | 'remove'>;
  settingsReader: SettingsReader;
  /** Same blob-authoritative settings write seam the weekly generator uses. */
  settingsWriter: Pick<SettingsRepository, 'set'>;
}

/**
 * Persisted wire shape (fields optional: storage is untrusted, and older
 * shapes may miss fields). The types match the data the store writes — a
 * 'YYYY-Www' period key, a non-negative integer index, an integer id array —
 * and every load still validates the runtime shapes below (typeof guards,
 * fail closed to null) because storage content is untrusted.
 */
type PersistedCheckpoint = {
  periodKey?: string;
  nextIndex?: number;
  processedIds?: number[];
};

/**
 * Validates one loaded checkpoint; any shape violation yields null (fail
 * closed). periodKey must be a non-empty string, nextIndex a non-negative
 * integer, processedIds an array of integers.
 */
export function validateDigestBatchCheckpoint(
  raw: PersistedCheckpoint | null | undefined,
): DigestBatchCheckpoint | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw.periodKey !== 'string' || raw.periodKey === '') return null;
  if (typeof raw.nextIndex !== 'number' || !Number.isInteger(raw.nextIndex) || raw.nextIndex < 0) {
    return null;
  }
  if (!Array.isArray(raw.processedIds)) return null;
  const processedIds: number[] = [];
  for (const id of raw.processedIds) {
    if (typeof id !== 'number' || !Number.isInteger(id)) return null;
    processedIds.push(id);
  }
  return { periodKey: raw.periodKey, nextIndex: raw.nextIndex, processedIds };
}

/**
 * Reads the shared weekly completion marker through the same
 * blob-authoritative getAll() the weekly generator checks. An empty default
 * ('') reads as "not generated yet".
 */
async function readCompletedMarker(settingsReader: SettingsReader): Promise<string | null> {
  const settings = await settingsReader.getAll();
  const marker = settings[StorageKeys.REVIEW_SUMMARY_LAST_GENERATED_WEEK];
  return typeof marker === 'string' && marker !== '' ? marker : null;
}

/**
 * ISO week keys ('YYYY-Www': 4-digit year, zero-padded week) order
 * chronologically, so the numeric ordinal is the monotonicity test. null
 * when the key is not a well-formed week key (an untrusted or legacy value).
 */
function weekKeyOrdinal(key: string): number | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(key);
  if (match === null) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(week)) return null;
  return year * 100 + week;
}

export function createDigestBatchCheckpointStore(
  deps: DigestBatchCheckpointStoreDeps,
): DigestCheckpointStore {
  const { storage, settingsReader, settingsWriter } = deps;
  return {
    async loadCheckpoint(): Promise<DigestBatchCheckpoint | null> {
      const loaded = await storage.get<Record<string, PersistedCheckpoint | undefined>>([
        DIGEST_BATCH_CHECKPOINT_KEY,
      ]);
      return validateDigestBatchCheckpoint(loaded[DIGEST_BATCH_CHECKPOINT_KEY]);
    },
    async saveCheckpoint(checkpoint: DigestBatchCheckpoint): Promise<void> {
      await storage.set({ [DIGEST_BATCH_CHECKPOINT_KEY]: checkpoint });
    },
    async loadCompletedPeriod(): Promise<string | null> {
      return readCompletedMarker(settingsReader);
    },
    async saveCompletedPeriod(periodKey: string): Promise<void> {
      // 標識統一: the publisher (generateWeeklySummary) already wrote the
      // shared marker through repo.set inside publishDigest. Re-writing the
      // same value would be a second write of the single atomic marker, so a
      // matching marker is skipped; the write only happens for a publisher
      // that returned success without writing the marker.
      const current = await readCompletedMarker(settingsReader);
      if (current === periodKey) return;
      // 単調性ガード (週替わり TOCTOU, PBI 2026-10-22-03 third-party review):
      // the AI call inside publishDigest can outlive the week, and a late
      // save for an older period must not regress a newer completion marker —
      // the weekly alarm's later run would otherwise see the older marker and
      // re-publish the newer week. Only a provably newer existing marker
      // blocks the write; unknown (untrusted or legacy) shapes fall through
      // to the plain overwrite so a corrupt marker cannot wedge the batch.
      const currentOrdinal = current !== null ? weekKeyOrdinal(current) : null;
      const nextOrdinal = weekKeyOrdinal(periodKey);
      if (currentOrdinal !== null && nextOrdinal !== null && currentOrdinal > nextOrdinal) return;
      await settingsWriter.set(StorageKeys.REVIEW_SUMMARY_LAST_GENERATED_WEEK, periodKey);
    },
    async clearCheckpoint(): Promise<void> {
      await storage.remove([DIGEST_BATCH_CHECKPOINT_KEY]);
    },
  };
}

/**
 * Production wiring defaults: the checkpoint rides chrome.storage.local
 * through the shared storage port (the getter resolves the area lazily, so
 * importing this module never touches chrome) and the marker rides the
 * settings repository singleton (the same seam reviewSummaryGenerator
 * defaults to).
 */
export function createProductionDigestBatchCheckpointStore(
  settingsReader: SettingsReader,
  settingsWriter?: Pick<SettingsRepository, 'set'>,
  storage: Pick<StorageArea, 'get' | 'set' | 'remove'> = CHROME_STORAGE_PORT.local,
): DigestCheckpointStore {
  return createDigestBatchCheckpointStore({
    storage,
    settingsReader,
    settingsWriter: settingsWriter ?? settingsRepository,
  });
}
