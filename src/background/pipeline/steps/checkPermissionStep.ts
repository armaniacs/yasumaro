/**
 * Permission check step
 * Step 2: Check host_permissions and record denied visits
 */

import { LogType } from '../../../utils/logger/types.js';
import { addLog } from '../../../utils/logger/core.js';
import { extractDomain } from '../../../utils/domainUtils.js';
import { getPermissionManager } from '../../../utils/permissionManager.js';
import { decideGate } from '../../../utils/recordingGateTable.js';
import type { RecordingContext, PipelineStepFunction, PermissionCheckResult } from '../types.js';

/**
 * Check host permissions for the URL
 * Records denied visit if permission is not granted
 */
export const checkPermissionStep: PipelineStepFunction = async (
  context: RecordingContext
): Promise<RecordingContext> => {
  const { data } = context;
  const { url } = data;

  const permissionManager = getPermissionManager();
  const permitted = await permissionManager.isHostPermitted(url);

  if (!permitted) {
    // Permission denied - extract domain and record
    let domain: string | null;
    try {
      domain = extractDomain(url) || new URL(url).hostname;
    } catch {
      addLog(LogType.ERROR, 'Failed to extract domain from URL', { url, traceId: context.traceId });
      throw new Error('INVALID_URL');
    }

    // PBI 2026-09-19-08: verdict は recordingDecision.decidePermission に委譲
    // PBI 2026-09-23-05: shared gate table row への adapter（I/O はこの step に残す）
    const verdict = decideGate('permission', { permitted, domain });
    if (!verdict.allow) {
      if (verdict.error === 'INVALID_URL') {
        addLog(LogType.ERROR, 'Failed to extract domain from URL', { url, traceId: context.traceId });
        throw new Error('INVALID_URL');
      }
      await permissionManager.recordDeniedVisit(domain);
      addLog(LogType.WARN, 'Permission required for recording', { url, domain, traceId: context.traceId });
      throw new Error('PERMISSION_REQUIRED');
    }
  }

  const result: PermissionCheckResult = {
    permitted: true,
    domain: extractDomain(url) || new URL(url).hostname
  };

  return {
    ...context,
    permissionCheck: result
  };
};
