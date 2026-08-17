/**
 * aiServiceFactory.ts
 * Centralized factory for creating the AIService composition root.
 *
 * The only place that wires LocalAIService + RemoteAIService + FallbackAIService
 * together; callers take the composed AIService rather than rebuilding it.
 */

import { BuiltInAIClient } from '../builtInAIClient.js';
import { FallbackAIService } from './FallbackAIService.js';
import { LocalAIService } from './LocalAIService.js';
import { RemoteAIService } from './RemoteAIService.js';
import type { AIService } from './AIService.js';

export interface CreateAIServiceOptions {
  /** Override the remote AI service (for testing). */
  remoteAiService?: RemoteAIService;
  /** Override the built-in AI client (for testing). */
  builtInAiClient?: BuiltInAIClient;
}

/**
 * Create the default AIService composition root:
 * FallbackAIService(local=LocalAIService, remote=RemoteAIService).
 */
export function createAIService(options: CreateAIServiceOptions = {}): AIService {
  const remoteAiService = options.remoteAiService || new RemoteAIService();
  const builtInAiClient = options.builtInAiClient || new BuiltInAIClient();

  const localAiService = new LocalAIService({ localAiClient: builtInAiClient });
  const aiService = new FallbackAIService({
    local: localAiService,
    remote: remoteAiService,
  });

  return aiService;
}
