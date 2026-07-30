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

export interface AIService {
  generateSummary(content: string, options?: AISummaryOptions): Promise<AISummaryResult>;
  getSupportedModes(): AISummaryMode[];
}
