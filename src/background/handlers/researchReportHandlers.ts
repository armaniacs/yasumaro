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

export interface ResearchReportHandlerDeps {
  /** Report generation + delivery, created once by the composition root. */
  researchReportGenerator: ResearchReportGenerator;
}

/** Scope shape after validation (the panel's own condition subset). */
interface ReportScope {
  search?: string;
  tag?: string;
  since?: number;
  until?: number;
}

/**
 * EXPORT_RESEARCH_REPORT handler factory. Generator-local mutex inside the
 * generator keeps one report at a time; repeat clicks return the failure
 * reason from the in-flight run instead of racing it.
 */
export function createResearchReportHandler(deps: ResearchReportHandlerDeps) {
  return async (
    message: { type: 'EXPORT_RESEARCH_REPORT'; payload?: { scope?: ReportScope; sendToObsidian?: boolean } },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    try {
      const payload = message.payload ?? {};
      const rawScope = payload.scope ?? {};
      // The scope degrades to the fields that are actually set (縮退の出口):
      // an empty scope is a whole-history report, which the generator caps.
      const scope: ReportScope = {};
      if (typeof rawScope.search === 'string' && rawScope.search.trim().length > 0) {
        scope.search = rawScope.search.trim();
      }
      if (typeof rawScope.tag === 'string' && rawScope.tag.trim().length > 0) {
        scope.tag = rawScope.tag.trim();
      }
      if (typeof rawScope.since === 'number' && Number.isFinite(rawScope.since)) {
        scope.since = rawScope.since;
      }
      if (typeof rawScope.until === 'number' && Number.isFinite(rawScope.until)) {
        scope.until = rawScope.until;
      }
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
