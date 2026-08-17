import type { AiTestProgress } from '../ai/AIService.js';

import type {
  TestConnectionsMessage,
  TestObsidianMessage,
  TestAiMessage,
} from '../messageTypes.js';

// ============================================================================
// Deps interfaces
// ============================================================================

export interface TestConnectionsHandlerDeps {
  testObsidian: () => Promise<{ success: boolean; message: string }>;
  testAi: () => Promise<{ success: boolean; message: string }>;
}

export interface TestObsidianHandlerDeps {
  testConnection: (override?: { apiKey?: string }) => Promise<unknown>;
}

export interface TestAiHandlerDeps {
  clearSettingsCache: () => void;
  testConnection: (onProgress?: (progress: AiTestProgress) => void, runId?: string) => Promise<unknown>;
  notifyProgress?: (progress: AiTestProgress) => void;
}

// ============================================================================
// Factory functions
// ============================================================================

export function createTestConnectionsHandler(deps: TestConnectionsHandlerDeps) {
  return async (
    _message: TestConnectionsMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    // VULN-009: TEST_* are extension-page operations.
    // Enforced by the registry's 'extension-only' trust level.
    const obsidianResult = await deps.testObsidian();
    const aiResult = await deps.testAi();
    sendResponse({ success: true, obsidian: obsidianResult, ai: aiResult });
  };
}

export function createTestObsidianHandler(deps: TestObsidianHandlerDeps) {
  return async (
    message: TestObsidianMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    // VULN-009: content-script senders must not reach the apiKey override.
    // Enforced by the registry's 'extension-only' trust level.
    const override = message.payload?.apiKey ? { apiKey: message.payload.apiKey } : undefined;
    const obsidianResult = await deps.testConnection(override);
    sendResponse({ success: true, obsidian: obsidianResult });
  };
}

export function createTestAiHandler(deps: TestAiHandlerDeps) {
  return async (
    message: TestAiMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    // VULN-009: this handler clears the settings cache, so content-script
    // senders must not reach it. Enforced by the registry's 'extension-only'
    // trust level.
    deps.clearSettingsCache();
    const aiResult = await deps.testConnection(deps.notifyProgress, message.runId);
    sendResponse({ success: true, ai: aiResult });
  };
}
