/**
 * Recording Pipeline
 * Orchestrates the recording process through a series of pipeline steps
 */

import { addLog, LogType } from '../../utils/logger.js';
import { ErrorStrategy, type RecordingContext, type PipelineStep, type PipelineError } from './types.js';
import {
  truncateContentStep,
  checkDomainFilterStep,
  checkPermissionStep,
  checkTrustDomainStep,
  PrivacyHeadersChecker,
  PrivatePageError,
  checkDuplicateStep,
  DuplicateError,
  processPrivacyPipelineStep,
  formatMarkdownStep,
  saveToObsidianStep,
  saveMetadataStep
} from './steps/index.js';
import type { RecordingData, RecordingResult } from '../../messaging/types.js';
import type { ObsidianClient } from '../obsidianClient.js';
import type { AIClient } from '../aiClient.js';

/**
 * Delay helper for retry strategy
 */
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Recording Pipeline class
 * Manages the execution of recording steps with configurable error strategies
 */
export class RecordingPipeline {
  private steps: PipelineStep[];
  private getPrivacyInfoWithCache: (url: string) => Promise<any>;
  private obsidian: ObsidianClient;
  private aiClient: AIClient | null;

  constructor(
    getPrivacyInfoWithCache: (url: string) => Promise<any>,
    obsidian: ObsidianClient,
    aiClient: AIClient | null = null
  ) {
    this.getPrivacyInfoWithCache = getPrivacyInfoWithCache;
    this.obsidian = obsidian;
    this.aiClient = aiClient;

    // Define pipeline steps with their error strategies
    this.steps = [
      {
        name: 'truncate',
        errorStrategy: ErrorStrategy.FATAL,
        execute: truncateContentStep
      },
      {
        name: 'domainFilter',
        errorStrategy: ErrorStrategy.FATAL,
        execute: checkDomainFilterStep
      },
      {
        name: 'permission',
        errorStrategy: ErrorStrategy.FATAL,
        execute: checkPermissionStep
      },
      {
        name: 'trust',
        errorStrategy: ErrorStrategy.FATAL,
        execute: checkTrustDomainStep
      },
      {
        name: 'privacyHeaders',
        errorStrategy: ErrorStrategy.FATAL,
        execute: this.createPrivacyHeadersStep()
      },
      {
        name: 'duplicate',
        errorStrategy: ErrorStrategy.FATAL,
        execute: checkDuplicateStep
      },
      {
        name: 'privacyPipeline',
        errorStrategy: ErrorStrategy.RETRY,
        maxRetries: 3,
        execute: processPrivacyPipelineStep
      },
      {
        name: 'formatMarkdown',
        errorStrategy: ErrorStrategy.FATAL,
        execute: formatMarkdownStep
      },
      {
        name: 'saveObsidian',
        errorStrategy: ErrorStrategy.RETRY,
        maxRetries: 3,
        execute: this.createSaveToObsidianStep()
      },
      {
        name: 'saveMetadata',
        errorStrategy: ErrorStrategy.BEST_EFFORT,
        execute: saveMetadataStep
      }
    ];
  }

  /**
   * Create privacy headers step with injected dependency
   */
  private createPrivacyHeadersStep() {
    const checker = new PrivacyHeadersChecker(this.getPrivacyInfoWithCache);
    return (context: RecordingContext) => checker.execute(context);
  }

  /**
   * Create save to Obsidian step with injected dependency
   */
  private createSaveToObsidianStep() {
    return (context: RecordingContext) => saveToObsidianStep(context, this.obsidian);
  }

  /**
   * Execute the pipeline with initial data
   */
  async execute(data: RecordingData, settings: any): Promise<RecordingResult> {
    // Create initial context
    let context: RecordingContext = {
      data,
      settings,
      force: data.force || false,
      aiClient: this.aiClient,
      errors: []
    };

    // Execute each step
    for (const step of this.steps) {
      try {
        context = await this.executeWithStrategy(step, context);

        // previewOnly: privacyPipeline ステップ完了後に早期リターン
        if (data.previewOnly && context.result && step.name === 'privacyPipeline') {
          return context.result;
        }
      } catch (error) {
        // Handle special error types
        if (error instanceof PrivatePageError) {
          return this.buildPrivatePageResult(context, error);
        }

        if (error instanceof DuplicateError) {
          return {
            success: true,
            skipped: true,
            reason: error.reason,
            title: data.title,
            url: data.url
          };
        }

        // Handle error based on strategy
        if (step.errorStrategy === ErrorStrategy.FATAL || step.errorStrategy === ErrorStrategy.RETRY) {
          return this.buildErrorResult(context, error as Error, step.name);
        }

        // SILENT / BEST_EFFORT - log and continue
        const pipelineError: PipelineError = {
          step: step.name,
          error: error as Error,
          strategy: step.errorStrategy,
          timestamp: Date.now()
        };

        context.errors.push(pipelineError);

        addLog(LogType.WARN, `Pipeline step ${step.name} failed with ${step.errorStrategy} strategy`, {
          error: (error as Error).message,
          url: data.url
        });
      }
    }

    // Build final result
    return this.buildResult(context);
  }

  /**
   * Execute a step with retry logic if configured
   */
  private async executeWithStrategy(
    step: PipelineStep,
    context: RecordingContext
  ): Promise<RecordingContext> {
    let retries = 0;

    while (true) {
      try {
        return await step.execute(context);
      } catch (error) {
        if (step.errorStrategy === ErrorStrategy.RETRY && retries < (step.maxRetries || 0)) {
          retries++;
          const delayMs = Math.pow(2, retries) * 1000; // Exponential backoff
          addLog(LogType.INFO, `Retrying step ${step.name} (attempt ${retries}/${step.maxRetries})`, {
            delayMs,
            url: context.data.url
          });
          await delay(delayMs);
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * Build result for private page detection
   */
  private buildPrivatePageResult(context: RecordingContext, error: PrivatePageError): RecordingResult {
    return {
      success: false,
      error: error.message,
      reason: error.reason,
      confirmationRequired: error.confirmationRequired,
      headerValue: error.headerValue,
      title: context.data.title,
      url: context.data.url
    };
  }

  /**
   * Build error result
   */
  private buildErrorResult(context: RecordingContext, error: Error, stepName: string): RecordingResult {
    addLog(LogType.ERROR, `Pipeline failed at step ${stepName}`, {
      error: error.message,
      url: context.data.url
    });

    // Create error notification
    const { title } = context.data;
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Recording Failed',
      message: `Failed to record ${title}: ${error.message}`
    });

    return {
      success: false,
      error: error.message,
      title: context.data.title,
      url: context.data.url
    };
  }

  /**
   * Build final success result
   */
  private buildResult(context: RecordingContext): RecordingResult {
    const { data, privacyResult, aiDuration, errors } = context;

    // Log any non-fatal errors
    if (errors.length > 0) {
      addLog(LogType.INFO, 'Pipeline completed with non-fatal errors', {
        url: data.url,
        errorCount: errors.length,
        errorSteps: errors.map(e => e.step)
      });
    }

    return {
      success: true,
      summary: privacyResult?.summary,
      maskedCount: privacyResult?.maskedCount,
      tags: privacyResult?.tags,
      sentTokens: privacyResult?.sentTokens,
      receivedTokens: privacyResult?.receivedTokens,
      originalTokens: privacyResult?.originalTokens,
      cleansedTokens: privacyResult?.cleansedTokens,
      aiDuration,
      title: data.title,
      url: data.url
    };
  }
}
