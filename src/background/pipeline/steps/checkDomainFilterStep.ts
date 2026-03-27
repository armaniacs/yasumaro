/**
 * Domain filter check step
 * Step 1: Check if domain is allowed by filter settings
 */

import { addLog, LogType } from '../../../utils/logger.js';
import { isDomainAllowed } from '../../../utils/domainUtils.js';
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

  if (!isAllowed) {
    if (force) {
      addLog(LogType.WARN, 'Force recording blocked domain', { url });
      return {
        ...context,
        isDomainAllowed: false
      };
    }

    // Domain is blocked and no force flag - this is a fatal error
    throw new Error('DOMAIN_BLOCKED');
  }

  return {
    ...context,
    isDomainAllowed: true
  };
};
