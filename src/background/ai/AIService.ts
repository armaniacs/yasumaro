export type AISummaryMode = 'full_pipeline' | 'local_only' | 'masked_cloud' | 'auto';

export interface AISummaryOptions {
  mode?: AISummaryMode;
  tagSummaryMode?: boolean;
  url?: string;
  traceId?: string;
}

export interface AISummaryResult {
  summary: string;
  tags?: string[];
  usedLocal?: boolean;
  sentTokens?: number;
  receivedTokens?: number;
  providerName?: string;
  modelName?: string;
  /** Whether the underlying provider reported success. False means the summary
   *  may be empty or contain an error message even if no exception was thrown. */
  success?: boolean;
  /** Error message from the underlying provider when success is false. */
  error?: string;
}

/**
 * Progress notification emitted while a connection test walks the provider
 * priority list. Structurally identical to AIClient's AiTestProgress; declared
 * here so AIService stays independent of the aiClient module.
 */
export interface AiTestProgress {
  /** Correlation id so a receiver only renders progress from its own run. */
  runId?: string;
  provider: string;
  model?: string;
  /** 0-based index of the slot currently being tested. */
  index: number;
  /** Total number of slots in the priority list. */
  total: number;
}

/** Outcome of testing a single provider slot. */
export interface AiProviderTestResult {
  provider: string;
  model?: string;
  success: boolean;
  message: string;
  /** Wall-clock time spent testing this provider, in milliseconds. */
  elapsedMs: number;
  debug?: {
    prompt?: string;
    response?: string;
    error?: string;
    hasContent?: boolean;
    statusCode?: number;
    availability?: string;
  };
}

/** Aggregate outcome of testing every configured provider slot. */
export interface AiConnectionTestResult {
  success: boolean;
  message: string;
  providers: AiProviderTestResult[];
}

export interface AIService {
  generateSummary(content: string, options?: AISummaryOptions): Promise<AISummaryResult>;
  getSupportedModes(): AISummaryMode[];
  /**
   * Verify that the configured AI provider is reachable and actually answers.
   *
   * Lives on AIService rather than only on AIClient so that callers never need
   * a direct AIClient reference just to test connectivity (see ADR
   * 2026-07-27). Before this existed, service-worker.ts had to reach past the
   * abstraction for the TEST_AI / TEST_CONNECTIONS handlers, which let the
   * connection-test path and the summarization path drift apart — the Gemini
   * thinking-budget bug had to be fixed twice as a result.
   */
  testConnection(
    onProgress?: (progress: AiTestProgress) => void,
    runId?: string,
  ): Promise<AiConnectionTestResult>;
}
