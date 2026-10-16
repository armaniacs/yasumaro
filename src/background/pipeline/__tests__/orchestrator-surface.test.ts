import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECORDING_GATE_TABLE } from '../../../utils/recordingGateTable.js';
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

  it('derives the pre-save gate order from RECORDING_GATE_TABLE (PBI 2026-10-16-07)', () => {
    // Table-driven pin: the orchestrator's gate subsequence must equal the
    // table order. A precedence change is a single table edit — this test
    // fails on drift without pinning any literal order here.
    const orchestrator = new RecordingOrchestrator({
      getPrivacyInfoWithCache: async () => null,
      getSettingsWithCache: async () => ({}) as never,
      obsidian: {} as never,
      aiService: null,
      sqliteClient: null,
    });
    const names = (orchestrator as unknown as { preSaveSteps: Array<{ name: string }> })
      .preSaveSteps.map((s) => s.name);
    const tableNames = RECORDING_GATE_TABLE.map((row) => row.name);
    const gateNames = names.filter((name) => (tableNames as readonly string[]).includes(name));
    expect(gateNames).toEqual([...tableNames]);
    // truncate stays first; gates follow it contiguously.
    expect(names[0]).toBe('truncate');
    expect(names.slice(1, 1 + tableNames.length)).toEqual([...tableNames]);
  });
});
