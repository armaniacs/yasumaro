/**
 * Permission check step
 * Step 2: Check host_permissions and record denied visits
 */

import { addLog, LogType } from '../../../utils/logger.js';
import { extractDomain } from '../../../utils/domainUtils.js';
import { getPermissionManager } from '../../../utils/permissionManager.js';
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
    let domain: string;
    try {
      domain = extractDomain(url) || new URL(url).hostname;
    } catch {
      addLog(LogType.ERROR, 'Failed to extract domain from URL', { url });
      throw new Error('INVALID_URL');
    }

    await permissionManager.recordDeniedVisit(domain);
    addLog(LogType.WARN, 'Permission required for recording', { url, domain });
    throw new Error('PERMISSION_REQUIRED');
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
