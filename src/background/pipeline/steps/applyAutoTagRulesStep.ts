/**
 * applyAutoTagRulesStep.ts
 *
 * Pipeline step (PBI 2026-10-23-06, BDD scenario 2): after the privacy
 * pipeline produces its tags, every enabled auto-tag rule matching the
 * record URL/title appends its tag, and the application is logged for the
 * rule undo. Assistive, never load-bearing: any failure returns the context
 * untouched (a rule problem must not stop the record), and preview runs
 * skip both the merge and the log.
 */

import { logWarn } from '../../../utils/logger/api.js';
import { normalizeTags } from '../../../utils/tagUtils.js';
import {
  matchAutoTagRules,
  mergeRuleTags,
  normalizeAutoTagRules,
  type AutoTagApplication,
} from '../../../utils/storage/autoTagRules.js';
import { appendAutoTagApplicationsById } from '../../../utils/storage/autoTagRulesRepository.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import type { TagNormalizationEntry } from '../../../utils/types.js';
import type { RecordingContext, PipelineStepFunction } from '../types.js';

/** Injectable provenance sink (unit tests); production appends to settings. */
export interface ApplyAutoTagRulesDeps {
  appendApplications?: (entries: AutoTagApplication[]) => Promise<void>;
}

export function createApplyAutoTagRulesStep(
  deps: ApplyAutoTagRulesDeps = {},
): PipelineStepFunction {
  const appendApplications = deps.appendApplications ?? appendAutoTagApplicationsById;
  return async (context: RecordingContext): Promise<RecordingContext> => {
    try {
      const { data, settings } = context;
      if (data.previewOnly) return context;
      if (!context.privacyResult) return context;
      const matches = matchAutoTagRules(
        data.url ?? '',
        data.title ?? '',
        normalizeAutoTagRules(settings[StorageKeys.AUTO_TAG_RULES]),
      );
      if (matches.length === 0) return context;

      // Rule tags ride the same normalization dictionary as AI tags, so a
      // rule and the AI fold to one entry for the same concept.
      const dict = (settings[StorageKeys.TAG_NORMALIZATION_DICT] ?? []) as TagNormalizationEntry[];
      const normalized = matches.map((match) => ({
        ruleId: match.ruleId,
        tag: normalizeTags([match.tag], dict)[0] ?? match.tag,
      }));
      const merged = mergeRuleTags(context.privacyResult.tags, normalized);
      if (merged === undefined) return context;

      const now = Date.now();
      const entries: AutoTagApplication[] = normalized
        .filter((match) => merged.some((tag) => tag.toLowerCase() === match.tag.toLowerCase()))
        .map((match) => ({ ruleId: match.ruleId, tag: match.tag, url: data.url ?? '', at: now }));
      try {
        await appendApplications(entries);
      } catch (error) {
        // Provenance loss degrades the undo, not the record: the tags stay.
        await logWarn('[AutoTagRules] application log write failed', { error: String(error) }, undefined, 'applyAutoTagRulesStep');
      }

      return {
        ...context,
        privacyResult: { ...context.privacyResult, tags: merged },
      };
    } catch (error) {
      await logWarn('[AutoTagRules] rule matching failed', { error: String(error) }, undefined, 'applyAutoTagRulesStep');
      return context;
    }
  };
}

/** Default step, wired with the production provenance sink. */
export const applyAutoTagRulesStep: PipelineStepFunction = createApplyAutoTagRulesStep();
