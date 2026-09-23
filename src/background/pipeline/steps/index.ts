/**
 * Pipeline steps index
 * Export all pipeline steps
 */

export { truncateContentStep } from './truncateContentStep.js';
export { checkDomainFilterStep } from './checkDomainFilterStep.js';
export { checkPermissionStep } from './checkPermissionStep.js';
export { checkTrustDomainStep } from './checkTrustDomainStep.js';
export { PrivacyHeadersChecker, PrivatePageError } from './checkPrivacyHeadersStep.js';
export { checkDuplicateStep, DuplicateError } from './checkDuplicateStep.js';
export { processPrivacyPipelineStep } from './processPrivacyPipelineStep.js';
export { extractSentencesStep } from './extractSentencesStep.js';
export { formatMarkdownStep } from './formatMarkdownStep.js';
export { saveToObsidianStep } from './saveToObsidianStep.js';
export { saveLocalMarkdownStep } from './saveLocalMarkdownStep.js';
export { saveMetadataStep } from './saveMetadataStep.js';
export { saveSqliteStep, RegenerateUpdateError } from './saveSqliteStep.js';

import { RECORDING_GATE_TABLE, type RecordingGate } from '../../../utils/recordingGateTable.js';
import type { PipelineStepFunction } from '../types.js';
import type { PrivacyInfo } from '../../../utils/privacyChecker.js';
import { checkDomainFilterStep } from './checkDomainFilterStep.js';
import { checkPermissionStep } from './checkPermissionStep.js';
import { checkTrustDomainStep } from './checkTrustDomainStep.js';
import { PrivacyHeadersChecker } from './checkPrivacyHeadersStep.js';
import { checkDuplicateStep } from './checkDuplicateStep.js';

/**
 * Admission gate order, derived from the shared gate table (PBI 2026-09-23-05).
 * The hand-written precedence copy this replaces lived in RecordingOrchestrator;
 * gate order now has exactly one owner.
 */
export const ADMISSION_GATE_ORDER: readonly RecordingGate[] = RECORDING_GATE_TABLE.map(
  (row) => row.name
);

export interface AdmissionGateStep {
  name: RecordingGate;
  execute: PipelineStepFunction;
}

/**
 * Admission gate executors in table order (PBI 2026-09-23-05). The exhaustive
 * Record keyed by RecordingGate turns a table-only row addition into a
 * compile error until its step adapter is registered here — step・index の
 * 個別編集なしには完結しないが、順序の複製は存在しない。
 */
export function createAdmissionGateSteps(
  getPrivacyInfoWithCache: (url: string) => Promise<PrivacyInfo | null>
): AdmissionGateStep[] {
  const impls: Record<RecordingGate, PipelineStepFunction> = {
    domainFilter: checkDomainFilterStep,
    permission: checkPermissionStep,
    trust: checkTrustDomainStep,
    privacyHeaders: (context) =>
      new PrivacyHeadersChecker(getPrivacyInfoWithCache).execute(context),
    duplicate: checkDuplicateStep,
  };
  return RECORDING_GATE_TABLE.map((row) => ({ name: row.name, execute: impls[row.name] }));
}
