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
import { BuiltInAiProvider } from './providers/BuiltInAiProvider.js';
import { createProviderStrategy, type CreateProviderStrategyFn } from './providerCatalog.js';
import type { Settings } from '../../utils/storage/types.js';

export interface CreateAIServiceOptions {
  /** Override the remote AI service (for testing). */
  remoteAiService?: RemoteAIService;
  /** Override the built-in AI client (for testing). */
  builtInAiClient?: BuiltInAIClient;
}

/**
 * Generation seam pinning the built-in-ai slot to the shared client instance.
 * The local path already receives that instance via LocalAIService; without
 * this seam the slot path (`built-in-ai` catalog row) would fall back to the
 * provider constructor default and build a second client with its own
 * availability cache. Every other provider id delegates to the production
 * catalog so non-built-in resolution is unchanged. Both adapters and both
 * testConnection meanings are preserved — only the instance is shared.
 */
export function createSharedBuiltInStrategy(sharedClient: BuiltInAIClient): CreateProviderStrategyFn {
  return (providerId: string, settings: Settings) => {
    if (providerId === 'built-in-ai') {
      return new BuiltInAiProvider(settings, sharedClient);
    }
    return createProviderStrategy(providerId, settings);
  };
}

/**
 * Create the default AIService composition root:
 * FallbackAIService(local=LocalAIService, remote=RemoteAIService).
 */
export function createAIService(options: CreateAIServiceOptions = {}): AIService {
  const builtInAiClient = options.builtInAiClient || new BuiltInAIClient();
  const remoteAiService =
    options.remoteAiService || new RemoteAIService({ createStrategy: createSharedBuiltInStrategy(builtInAiClient) });

  const localAiService = new LocalAIService({ localAiClient: builtInAiClient });
  const aiService = new FallbackAIService({
    local: localAiService,
    remote: remoteAiService,
  });

  return aiService;
}
