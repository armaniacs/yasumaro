/**
 * recordingFlowSeam.test.ts (PBI 2026-10-24-05: recording-flow order single seam)
 *
 * BDD Scenario 1: a recording flows through a single seam
 *   Given a page view / When recording / Then it is saved exactly as before.
 * BDD Scenario 2: adding a sink costs one place
 *   Given a new sink / When adding it / Then only the order-owning place changes.
 *
 * Pins the single order seam: RecordingOrchestrator.flowOrder() publishes the
 * full intake-to-tail order in one query, derived from the NN04 gate table
 * (pre-save) and the SavePhase fan-out table (tail). Callers learn only
 * record / preview; order knowledge lives in the seam.
 */

import { describe, it, expect } from 'vitest';
import { RECORDING_GATE_TABLE } from '../../../utils/recordingGateTable.js';
import { SAVE_SINK_ORDER } from '../savePhase.js';
import { RecordingOrchestrator } from '../RecordingOrchestrator.js';

function makeOrchestrator(): RecordingOrchestrator {
  return new RecordingOrchestrator({
    getPrivacyInfoWithCache: async () => null,
    getSettingsWithCache: async () => ({}) as never,
    obsidian: {} as never,
    aiService: null,
    sqliteClient: null,
  });
}

describe('RecordingOrchestrator', () => {
  describe('flowOrder', () => {
    it('publishes the full intake-to-tail order in one query', () => {
      const order = makeOrchestrator().flowOrder();

      expect(order).toEqual([
        'truncate',
        ...RECORDING_GATE_TABLE.map((row) => row.name),
        'privacyPipeline',
        // PBI 2026-10-23-06: rule tags merge right after the AI tags.
        'applyAutoTagRules',
        'extractSentences',
        'formatMarkdown',
        ...SAVE_SINK_ORDER,
      ]);
    });

    it('keeps the NN04 gate subsequence in canonical table order', () => {
      const order = makeOrchestrator().flowOrder();
      const tableNames = RECORDING_GATE_TABLE.map((row) => row.name);
      const gateNames = order.filter((name) => (tableNames as readonly string[]).includes(name));

      expect(gateNames).toEqual([...tableNames]);
    });

    it('ends with the SavePhase sink tail in canonical order', () => {
      const order = makeOrchestrator().flowOrder();

      expect(order.slice(-SAVE_SINK_ORDER.length)).toEqual([...SAVE_SINK_ORDER]);
    });
  });
});
