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
  testConnection: (override?: { apiKey?: string; protocol?: string; port?: string; host?: string }) => Promise<unknown>;
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
    // VULN-009: content-script senders must not reach the connection
    // overrides. Enforced by the registry's 'extension-only' trust level
    // (TEST_OBSIDIAN is not in CONTENT_SCRIPT_ALLOWED_TYPES).
    //
    // Form values (protocol/port/host) are forwarded so Test Connection
    // evaluates the same loopback rule as a saved config (PBI 2026-09-19-22).
    // Empty fields are dropped; an empty payload keeps the stored-settings
    // path so the pre-form behavior is preserved.
    const p = message.payload;
    const hasFormValue = [p?.apiKey, p?.protocol, p?.port, p?.host].some(
      (v) => typeof v === 'string' && v.trim() !== '',
    );
    let override: { apiKey?: string; protocol?: string; port?: string; host?: string } | undefined;
    if (hasFormValue && p) {
      override = {};
      // Guard on trimmed values so whitespace-only fields are dropped; the
      // raw value is forwarded and trimmed downstream by the validators.
      if (p.apiKey?.trim()) override.apiKey = p.apiKey;
      if (p.protocol?.trim()) override.protocol = p.protocol;
      if (p.port?.trim()) override.port = p.port;
      if (p.host?.trim()) override.host = p.host;
    }
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
