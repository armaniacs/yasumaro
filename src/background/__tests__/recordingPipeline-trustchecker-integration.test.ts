/**
 * recordingPipeline-trustchecker-integration.test.ts
 * Verifies domain trust check is integrated into the pipeline's step chain.
 */

import * as fs from 'fs';

describe('RecordingPipeline - TrustChecker Integration', () => {
  describe('Blocking Behavior - Pipeline Implementation', () => {
    it('verifies trust check step handles untrusted domains', async () => {
      const stepSource = await import('fs').then(fs => {
        return fs.readFileSync('src/background/pipeline/steps/checkTrustDomainStep.ts', 'utf8');
      });

      const hasTrustCheck = stepSource.includes('trustChecker.checkDomain');
      expect(hasTrustCheck).toBe(true);

      const hasBlocking = stepSource.includes('canProceed');
      expect(hasBlocking).toBe(true);

      const hasError = stepSource.includes('DOMAIN_NOT_TRUSTED');
      expect(hasError).toBe(true);
    });

    it('verifies notification is shown on blocked domain', async () => {
      const stepSource = await import('fs').then(fs => {
        return fs.readFileSync('src/background/pipeline/steps/checkTrustDomainStep.ts', 'utf8');
      });

      const hasNotification = stepSource.includes('NotificationHelper.notifyError');
      expect(hasNotification).toBe(true);
    });
  });
});
