/**
 * Privacy headers check step
 * Step 4: Check privacy headers and handle accordingly
 */

import { addLog, LogType } from '../../../utils/logger.js';
import { StorageKeys } from '../../../utils/storage.js';
import { addPendingPage } from '../../../utils/pendingStorage.js';
import type { RecordingContext, PipelineStepFunction } from '../types.js';
import type { PrivacyInfo } from '../../../utils/privacyChecker.js';

// Import the RecordingLogic class method reference - will be injected
export class PrivacyHeadersChecker {
  private getPrivacyInfoWithCache: (url: string) => Promise<PrivacyInfo | null>;

  constructor(getPrivacyInfoWithCache: (url: string) => Promise<PrivacyInfo | null>) {
    this.getPrivacyInfoWithCache = getPrivacyInfoWithCache;
  }

  /**
   * Check privacy headers and handle according to settings
   */
  async execute(context: RecordingContext): Promise<RecordingContext> {
    const { data, settings, force } = context;
    const { url, title, headerValue, requireConfirmation } = data;

    // Check whitelist first
    const whitelist = settings[StorageKeys.DOMAIN_WHITELIST] || [];
    let shouldSkipPrivacyCheck = false;

    if (whitelist.length > 0) {
      const domain = this.extractDomain(url);
      if (domain && whitelist.includes(domain)) {
        addLog(LogType.DEBUG, 'Whitelisted domain, bypassing privacy check', { url, domain });
        shouldSkipPrivacyCheck = true;
      }
    }

    if (shouldSkipPrivacyCheck) {
      return context;
    }

    // Check privacy headers
    const privacyInfo = await this.getPrivacyInfoWithCache(url);

    if (!privacyInfo?.isPrivate) {
      return context;
    }

    // Private page detected
    addLog(LogType.WARN, 'Private page detected', {
      url,
      reason: privacyInfo.reason,
      requireConfirmation
    });

    // Handle based on requireConfirmation flag
    if (requireConfirmation) {
      const reason = privacyInfo.reason || 'cache-control';
      const actualHeaderValue = headerValue ||
        (reason === 'cache-control' ? privacyInfo.headers?.cacheControl || '' : '');

      await this.savePendingPage(url, title, reason, actualHeaderValue);
      throw new PrivatePageError('PRIVATE_PAGE_DETECTED', {
        reason: privacyInfo.reason,
        confirmationRequired: true
      });
    }

    // Auto-save behavior
    const autoSaveBehavior = settings[StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR] || 'save';
    const autoReason = privacyInfo.reason || 'cache-control';
    const autoHeaderValue = headerValue ||
      (autoReason === 'cache-control' ? privacyInfo.headers?.cacheControl || '' : '');

    if (autoSaveBehavior === 'skip') {
      await this.savePendingPage(url, title, autoReason, autoHeaderValue);
      throw new PrivatePageError('PRIVATE_PAGE_DETECTED', {
        reason: privacyInfo.reason
      });
    } else if (autoSaveBehavior === 'confirm') {
      await this.savePendingPage(url, title, autoReason, autoHeaderValue);
      throw new PrivatePageError('PRIVATE_PAGE_DETECTED', {
        reason: privacyInfo.reason,
        confirmationRequired: true,
        headerValue: autoHeaderValue
      });
    }

    // 'save' - continue with force warning
    if (force) {
      addLog(LogType.WARN, 'Force recording private page', {
        url,
        reason: privacyInfo.reason
      });
    } else {
      addLog(LogType.INFO, 'Auto-saving private page (behavior=save)', { url });
    }

    return context;
  }

  private extractDomain(url: string): string | null {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }

  private async savePendingPage(
    url: string,
    title: string,
    reason: string,
    headerValue: string
  ): Promise<void> {
    // Validate reason is one of allowed values
    const validReasons = ['cache-control', 'set-cookie', 'authorization'] as const;
    type ValidReason = typeof validReasons[number];
    const validReason = validReasons.includes(reason as ValidReason)
      ? (reason as ValidReason)
      : 'cache-control';

    const pendingPage = {
      url,
      title,
      timestamp: Date.now(),
      reason: validReason,
      headerValue,
      expiry: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
    };
    await addPendingPage(pendingPage);
  }
}

/**
 * Custom error class for private page detection
 */
export class PrivatePageError extends Error {
  public reason?: string;
  public confirmationRequired?: boolean;
  public headerValue?: string;

  constructor(
    message: string,
    options: { reason?: string; confirmationRequired?: boolean; headerValue?: string } = {}
  ) {
    super(message);
    this.reason = options.reason;
    this.confirmationRequired = options.confirmationRequired;
    this.headerValue = options.headerValue;
  }
}
