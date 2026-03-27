/**
 * Trust domain check step
 * Step 3: 3-step verification (Finance/Sensitive/Unverified)
 */

import { addLog, LogType } from '../../../utils/logger.js';
import { TrustChecker } from '../../../utils/trustChecker.js';
import { NotificationHelper } from '../../notificationHelper.js';
import type { RecordingContext, PipelineStepFunction, TrustCheckResult } from '../types.js';

/**
 * Check domain trust level using 3-step verification
 */
export const checkTrustDomainStep: PipelineStepFunction = async (
  context: RecordingContext
): Promise<RecordingContext> => {
  const { data, force } = context;
  const { url } = data;

  const trustChecker = new TrustChecker();
  const trustCheck = await trustChecker.checkDomain(url);

  if (!trustCheck.canProceed && !force) {
    // Domain not trusted and no force flag
    addLog(LogType.WARN, 'Domain not trusted, recording blocked', {
      url,
      reason: trustCheck.reason,
      trustLevel: trustCheck.trustResult.level
    });

    if (trustCheck.showAlert) {
      NotificationHelper.notifyError(
        `Recording Blocked: ${trustCheck.reason || 'Domain not trusted for recording'}`
      );
    }

    throw new Error('DOMAIN_NOT_TRUSTED');
  }

  const result: TrustCheckResult = {
    canProceed: trustCheck.canProceed,
    showAlert: trustCheck.showAlert,
    reason: trustCheck.reason,
    trustLevel: trustCheck.trustResult.level
  };

  return {
    ...context,
    trustCheck: result
  };
};
