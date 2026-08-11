/**
 * aiServiceFactory.ts
 * Centralized factory for creating the AIService composition root.
 *
 * The only place that wires LocalAIService + RemoteAIService + FallbackAIService
 * together; callers take the composed AIService rather than rebuilding it.
 */

import { AIClient } from '../aiClient.js';
import { BuiltInAIClient } from '../builtInAIClient.js';
import { FallbackAIService } from './FallbackAIService.js';
import { LocalAIService } from './LocalAIService.js';
import { RemoteAIService } from './RemoteAIService.js';
import type { AIService } from './AIService.js';

export interface CreateAIServiceOptions {
  /** Override the AI client (for testing). */
  aiClient?: AIClient;
  /** Override the built-in AI client (for testing). */
  builtInAiClient?: BuiltInAIClient;
}

/**
 * Create the default AIService composition root:
 * FallbackAIService(local=LocalAIService, remote=RemoteAIService).
 *
 * The AIClient is retained only for backward compatibility with direct
 * callers; the RemoteAIService it creates is reused as the remote service
 * so there is exactly one slot loop instance.
 */
export function createAIService(options: CreateAIServiceOptions = {}): AIService {
  const aiClient = options.aiClient || new AIClient();
  const builtInAiClient = options.builtInAiClient || new BuiltInAIClient();

  const localAiService = new LocalAIService({ localAiClient: builtInAiClient });
  const aiService = new FallbackAIService({
    local: localAiService,
    remote: aiClient.remoteAiService,
  });

  return aiService;
}
