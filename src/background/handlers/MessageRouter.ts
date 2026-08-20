// @layer 2 — Deep module hiding 19 handler registrations + trust/validator tables
/**
 * MessageRouter — deep module hiding the 19 handler shallow registry
 *
 * createMessageHandlerRegistry exposes register(type, handler, trust, validator) with
 * 19 types × trust × validator combinations. Callers must know which trust level
 * each type needs and which validator to attach. The true bug surface is policy
 * leakage (e.g., VALID_VISIT is content-script-allowed but DASHBOARD_SQLITE is
 * extension-only) — a new handler added without trust is a vulnerability.
 *
 * MessageRouter collapses this behind one seam: dispatch(msg, sender) → Response.
 * trust and validator tables are internal, derived from a single source of truth.
 * Callers learn one method; adding a handler is one place, not 19.
 *
 * Deletion test: deleting MessageRouter forces 19 register() calls to reappear
 * across callers. Deleting the shallow registry (a Map put) only moves one line.
 */

import { MessageHandlerRegistry } from './MessageHandlerRegistry.js';
import { createMessageHandlerRegistry } from './createMessageHandlerRegistry.js';
import type { MessageHandlerRegistryDeps } from './createMessageHandlerRegistry.js';

export class MessageRouter {
  private registry: MessageHandlerRegistry;

  constructor(deps: MessageHandlerRegistryDeps) {
    const { registry } = createMessageHandlerRegistry(deps);
    this.registry = registry;
  }

  /**
   * Deep seam: one method hides 19 handlers + trust table + 8 validators
   * Returns true if the message was handled (async response), false otherwise.
   */
  dispatch(
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ): boolean {
    const type = (message as { type?: string })?.type;
    if (typeof type !== 'string') {
      sendResponse({ success: false, error: 'Missing message type' });
      return false;
    }
    return this.registry.dispatch(type, message, sender, sendResponse);
  }

  /** For tests: expose registry's handler count via the seam */
  getHandlerCount(): number {
    // Access via any to avoid exposing internal Map
    return (this.registry as unknown as { handlers: Map<string, unknown> }).handlers.size;
  }
}

/**
 * Factory for the deep module — hides the 19 handler wiring.
 * Two adapters justify the seam: prod deps vs InMemory test deps.
 */
export function createMessageRouter(deps: MessageHandlerRegistryDeps): MessageRouter {
  return new MessageRouter(deps);
}
