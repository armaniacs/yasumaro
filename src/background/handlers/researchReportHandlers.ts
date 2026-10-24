/**
 * researchReportHandlers.ts
 *
 * PBI 2026-10-23-09: 調査レポート一発生成 (EXPORT_RESEARCH_REPORT). The panel
 * conditions pick the selection rows and the background assembles the
 * four-section Markdown (要旨・時系列・引用・未読穴), then delivers it through
 * the existing paths (local markdown download + optional Obsidian daily note).
 *
 * 作法: the generator is injected (composition root owns it); this module
 * owns no transport. 縮退の出口: a generator failure returns a failure with a
 * reason — never a fake success.
 */

import type { ResearchReportGenerator } from '../researchReportGenerator.js';
import type { ResearchReportScope } from '../../messaging/responseCanonical.js';
import { normalizeReportScope } from '../../messaging/responseCanonical.js';

export interface ResearchReportHandlerDeps {
  /** Report generation + delivery, created once by the composition root. */
  researchReportGenerator: ResearchReportGenerator;
}

/**
 * EXPORT_RESEARCH_REPORT handler factory. Generator-local mutex inside the
 * generator keeps one report at a time; repeat clicks return the failure
 * reason from the in-flight run instead of racing it.
 */
export function createResearchReportHandler(deps: ResearchReportHandlerDeps) {
  return async (
    message: { type: 'EXPORT_RESEARCH_REPORT'; payload?: { scope?: ResearchReportScope; sendToObsidian?: boolean } },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    try {
      const payload = message.payload ?? {};
      // Scope shaping is owned by the canonical normalizer (same rules the
      // validator checks): the handler no longer re-inspects field by field.
      // An empty scope is a whole-history report, which the generator caps.
      const scope = normalizeReportScope(payload.scope);
      const outcome = await deps.researchReportGenerator.generate({
        scope,
        sendToObsidian: payload.sendToObsidian === true,
      });
      sendResponse(outcome);
    } catch (error: unknown) {
      sendResponse({ success: false, error: error instanceof Error ? error.message : 'report_failed' });
    }
  };
}
