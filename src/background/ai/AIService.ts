export type AISummaryMode = 'full_pipeline' | 'local_only' | 'masked_cloud' | 'auto';

export interface AISummaryOptions {
  mode?: AISummaryMode;
  tagSummaryMode?: boolean;
  url?: string;
}

export interface AISummaryResult {
  summary: string;
  tags?: string[];
  usedLocal?: boolean;
  sentTokens?: number;
  receivedTokens?: number;
  providerName?: string;
  modelName?: string;
}

export interface AIService {
  generateSummary(content: string, options?: AISummaryOptions): Promise<AISummaryResult>;
  getSupportedModes(): AISummaryMode[];
}
