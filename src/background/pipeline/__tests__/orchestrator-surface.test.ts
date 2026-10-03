import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecordingOrchestrator } from '../RecordingOrchestrator.js';

/**
 * orchestrator-surface.test.ts (PBI 2026-09-11-04)
 *
 * Pins the narrowed public interface: exactly `record` / `preview` /
 * `retryObsidianWrite`. The `record(mode)` wrapper, the
 * `retryObsidianWriteOnly` alias, `recordFull`, and the `RecordMode` union
 * were removed — this test fails if any of them return.
 */
describe('RecordingOrchestrator public surface', () => {
  it('exposes record / preview / retryObsidianWrite and no removed entries', () => {
    const methods = Object.getOwnPropertyNames(RecordingOrchestrator.prototype)
      .filter((name) => name !== 'constructor');
    for (const kept of ['record', 'preview', 'retryObsidianWrite']) {
      expect(methods).toContain(kept);
    }
    // TS `private` is compile-time only, so internals (create*Step,
    // execute*) still appear on the prototype — only the removed public
    // spellings must stay gone.
    for (const removed of ['recordFull', 'retryObsidian', 'retryObsidianWriteOnly']) {
      expect(methods).not.toContain(removed);
    }
  });

  it('contains no removed spellings in its own source', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'RecordingOrchestrator.ts'),
      'utf-8',
    );
    for (const banned of ['retryObsidianWriteOnly', 'RecordMode', 'recordFull', 'record(mode']) {
      expect(source).not.toContain(banned);
    }
  });

  it('keeps the canonical pre-save gate order (PBI 2026-09-28-27)', () => {
    // The hand-written preSaveSteps list is canonical (ADR
    // 2026-09-28-recording-gate-order-canonical). Pin the order so a reorder
    // is a deliberate, reviewed diff — not a silent drift.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'RecordingOrchestrator.ts'),
      'utf-8',
    );
    const names = [...source.matchAll(/name: '([a-zA-Z]+)', errorStrategy/g)].map((m) => m[1]!);
    expect(names.slice(0, 9)).toEqual([
      'truncate',
      'domainFilter',
      'permission',
      'trust',
      'privacyHeaders',
      'duplicate',
      'privacyPipeline',
      'extractSentences',
      'formatMarkdown',
    ]);
  });
});
