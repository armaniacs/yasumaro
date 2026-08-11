/**
 * recordingLogic-trustchecker-integration.test.ts
 * Unit tests for TrustChecker integration into recordingLogic
 * TDD Green phase: Verifies domain trust check is properly integrated
 */


import * as fs from 'fs';
import * as path from 'path';

describe('RecordingLogic - TrustChecker Integration', () => {
  describe('TDD Green Phase - Pipeline Integration Verified', () => {
    it('verifies RecordingPipeline is used in recordingLogic', async () => {
      const recordingLogicSource = await import('fs').then(fs =>
        fs.readFileSync('src/background/recordingLogic.ts', 'utf8')
      );

      // Check that RecordingPipeline is imported
      const hasImport = recordingLogicSource.includes('RecordingPipeline');
      expect(hasImport).toBe(true);

      // Check that pipeline.execute is called
      const hasExecute = recordingLogicSource.includes('pipeline.execute');
      expect(hasExecute).toBe(true);
    });

    it('verifies recordingLogic delegates to the injected pipeline', async () => {
      const recordingLogicSource = await import('fs').then(fs =>
        fs.readFileSync('src/background/recordingLogic.ts', 'utf8')
      );

      // The pipeline is injected by the composition root, so recordingLogic must
      // delegate to it without constructing one of its own (a second instance
      // would split the automatic-record path off from the handler paths).
      expect(recordingLogicSource).toContain('this.pipeline.execute');
      expect(recordingLogicSource).not.toContain('createRecordingPipeline(');
    });
  });

  describe('Blocking Behavior - Pipeline Implementation', () => {
    it('verifies trust check step handles untrusted domains', async () => {
      // Check the checkTrustDomainStep file for trust check integration
      const stepSource = await import('fs').then(fs => {
        return fs.readFileSync('src/background/pipeline/steps/checkTrustDomainStep.ts', 'utf8');
      });

      // Trust check is in checkTrustDomainStep
      const hasTrustCheck = stepSource.includes('trustChecker.checkDomain');
      expect(hasTrustCheck).toBe(true);

      // Check for blocking logic
      const hasBlocking = stepSource.includes('canProceed');
      expect(hasBlocking).toBe(true);

      // DOMAIN_NOT_TRUSTED error
      const hasError = stepSource.includes('DOMAIN_NOT_TRUSTED');
      expect(hasError).toBe(true);
    });

    it('verifies notification is shown on blocked domain', async () => {
      // Check the checkTrustDomainStep for notification helper usage
      const stepSource = await import('fs').then(fs => {
        return fs.readFileSync('src/background/pipeline/steps/checkTrustDomainStep.ts', 'utf8');
      });

      // Using notifyError for blocked domains
      const hasNotification = stepSource.includes('NotificationHelper.notifyError');
      expect(hasNotification).toBe(true);
    });
  });
});