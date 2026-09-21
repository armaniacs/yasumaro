/**
 * Domain filter check step
 * Step 1: Check if domain is allowed by filter settings
 */

import { LogType } from '../../../utils/logger/types.js';
import { addLog } from '../../../utils/logger/core.js';
import { isDomainAllowed } from '../../../utils/domainUtils.js';
import { decideDomainFilter } from '../recordingDecision.js';
import type { RecordingContext, PipelineStepFunction } from '../types.js';

/**
 * Check if the domain is allowed by filter settings
 * Returns error if domain is blocked and force flag is not set
 */
export const checkDomainFilterStep: PipelineStepFunction = async (
  context: RecordingContext
): Promise<RecordingContext> => {
  const { data, force } = context;
  const { url } = data;

  const isAllowed = await isDomainAllowed(url);
  // PBI 2026-09-19-08: verdict は recordingDecision.decideDomainFilter に委譲
  const verdict = decideDomainFilter(isAllowed, force);

  if (!verdict.allow) {
    // Domain is blocked and no force flag - this is a fatal error
    throw new Error(verdict.error ?? 'DOMAIN_BLOCKED');
  }

  if (!isAllowed) {
    addLog(LogType.WARN, 'Force recording blocked domain', { url, traceId: context.traceId });
    return {
      ...context,
      isDomainAllowed: false
    };
  }

  return {
    ...context,
    isDomainAllowed: true
  };
};
