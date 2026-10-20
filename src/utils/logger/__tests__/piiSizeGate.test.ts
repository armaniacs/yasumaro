/**
 * piiSizeGate.test.ts
 * PBI 2026-10-18-11: the PII sanitizer's ReDoS size gate (65536 code units)
 * returns the ORIGINAL text with empty maskedItems and error set. The logger
 * sinks used to branch on `maskedItems.length > 0` alone, so a gate-exceeded
 * string (e.g. a 70000-char URL carrying an email in its query) was persisted
 * unmasked into chrome.storage.local['sanitization_logs'].
 *
 * These tests pin the fixed contract through the full in-memory wiring and
 * assert the PERSISTED entries (storage adapter contents, never a buffer
 * peek): gate-exceeded values are bounded with truncateForLog and re-masked,
 * while gate-passing values keep the exact legacy shape.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { addLog, flushLogs, initLogger, resetLoggerWiring, clearPendingLogs } from '../core.js';
import { logCritical } from '../api.js';
import { InMemoryLogAdapter } from '../storageAdapter.js';
import { ImmediateFlushScheduler } from '../flushScheduler.js';
import { FakeCriticalSink } from '../criticalAlertSink.js';
import { ErrorCode } from '../types.js';
import { LOG_TRUNCATION_MARKER } from '../../logTruncate.js';

const EMAIL = 'user@example.com';
// Scenario URL from the PBI: the email sits near the head of the query, so
// truncation alone could never remove it.
const URL_PREFIX = 'https://attacker.example/?email=user@example.com&pad=';

function urlWithTotalLength(totalLength: number): string {
  return URL_PREFIX + 'a'.repeat(totalLength - URL_PREFIX.length);
}

describe('logger', () => {
  describe('PII size gate sinks (PBI 2026-10-18-11)', () => {
    let storage: InMemoryLogAdapter;

    beforeEach(() => {
      storage = new InMemoryLogAdapter();
      initLogger({ storage, scheduler: new ImmediateFlushScheduler() });
      clearPendingLogs();
    });

    afterEach(() => {
      resetLoggerWiring();
      clearPendingLogs();
    });

    /** Serialized persisted entries only — the adapter's contents, not the buffer. */
    async function persistedEntries(): Promise<string[]> {
      await flushLogs(true);
      const stored = await storage.load();
      return stored.map((entry) => JSON.stringify(entry));
    }

    it('does not persist the raw email of a size-gate-exceeded URL (Scenario 1)', async () => {
      await addLog('INFO', 'Recording completed', { url: urlWithTotalLength(70000) });

      const entries = await persistedEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!).not.toContain(EMAIL);
      expect(entries[0]!).toContain('[MASKED:email]');
      expect(entries[0]!).toContain(LOG_TRUNCATION_MARKER);
    });

    it('masks a gate-passing URL exactly as before (Scenario 2, control)', async () => {
      await addLog('INFO', 'Recording completed', { url: urlWithTotalLength(65000) });

      const entries = await persistedEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!).not.toContain(EMAIL);
      expect(entries[0]!).toContain('[MASKED:email]');
      expect(entries[0]!).toContain('"url_maskedTypes":["email"]');
      // 長さ情報の表記は従来と同一: ゲート以下では切り詰めマーカーは付かない
      expect(entries[0]!).not.toContain(LOG_TRUNCATION_MARKER);
    });

    it('keeps the gate boundary continuous at 65535/65536/65537/65538 (Scenario 3)', async () => {
      await addLog('INFO', 'boundary below', { url: urlWithTotalLength(65535) });
      await addLog('INFO', 'boundary below', { url: urlWithTotalLength(65536) });
      await addLog('INFO', 'boundary above', { url: urlWithTotalLength(65537) });
      await addLog('INFO', 'boundary above', { url: urlWithTotalLength(65538) });

      const entries = await persistedEntries();
      expect(entries).toHaveLength(4);
      const below = entries.filter((entry) => entry.includes('"message":"boundary below"'));
      const above = entries.filter((entry) => entry.includes('"message":"boundary above"'));
      expect(below).toHaveLength(2);
      expect(above).toHaveLength(2);

      for (const entry of entries) {
        expect(entry).not.toContain(EMAIL);
      }
      // 65536 以下の 2 件は純粋なマスク結果（切り詰めマーカーなし）
      for (const entry of below) {
        expect(entry).toContain('[MASKED:email]');
        expect(entry).not.toContain(LOG_TRUNCATION_MARKER);
      }
      // 65537 以上の 2 件は「マスク or 切り詰め」の扱い
      for (const entry of above) {
        expect(entry).toContain('[MASKED:email]');
        expect(entry).toContain(LOG_TRUNCATION_MARKER);
      }
    });

    it('applies the same gate to array elements in details', async () => {
      await addLog('INFO', 'Recording completed', { urls: [urlWithTotalLength(70000)] });

      const entries = await persistedEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!).not.toContain(EMAIL);
      expect(entries[0]!).toContain('[MASKED:email]');
      expect(entries[0]!).toContain(LOG_TRUNCATION_MARKER);
    });

    it('does not persist the raw email of a size-gate-exceeded message', async () => {
      await addLog('INFO', urlWithTotalLength(70000));

      const entries = await persistedEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!).not.toContain(EMAIL);
      expect(entries[0]!).toContain('[MASKED:email]');
      expect(entries[0]!).toContain(LOG_TRUNCATION_MARKER);
    });

    it('does not put the raw email in the OS notification body (Scenario 4)', async () => {
      const sink = new FakeCriticalSink();

      await logCritical(urlWithTotalLength(70000), {}, ErrorCode.UNKNOWN_ERROR, 'test', sink);

      expect(sink.raised).toHaveLength(1);
      expect(sink.raised[0]!.message).not.toContain(EMAIL);
      expect(sink.raised[0]!.message).toContain('[MASKED:email]');
      expect(sink.raised[0]!.message).toContain(LOG_TRUNCATION_MARKER);
    });
  });
});
