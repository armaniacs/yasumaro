/**
 * Locks down which message types content scripts may reach.
 *
 * Authorization used to be enforced inside each handler, in four different
 * spellings, with four types left unguarded. It now lives in MessageRouter's
 * trust table, so this reads the policy through the router's observable
 * accessors and asserts the level of every registered type. Adding a handler
 * without a trust entry fails here, which is what makes deleting the old
 * per-handler guards safe.
 */
import { describe, it, expect } from 'vitest';
import { checkSenderTrust, type SenderTrustLevel } from '../senderTrust.js';
import { createMessageRouter } from '../MessageRouter.js';
import type { MessageRouterDeps } from '../MessageRouter.js';

const RUNTIME_ID = 'this-extension-id';

/**
 * The intended policy. Every registered type must appear here, and the source
 * must agree — a type registered with a different level fails the comparison
 * below rather than silently loosening.
 */
const EXPECTED_TRUST: Record<string, SenderTrustLevel> = {
  // A tab reporting on its own page is the legitimate source for these.
  VALID_VISIT: 'content-script-allowed',
  CONTENT_CLEANSING_EXECUTED: 'content-script-allowed',
  CHECK_DOMAIN: 'content-script-allowed',
  PING: 'content-script-allowed',

  // Everything else is popup / dashboard / offscreen only.
  FETCH_URL: 'extension-only',
  MANUAL_RECORD: 'extension-only',
  PREVIEW_RECORD: 'extension-only',
  SAVE_RECORD: 'extension-only',
  TEST_CONNECTIONS: 'extension-only',
  TEST_OBSIDIAN: 'extension-only',
  TEST_AI: 'extension-only',
  GET_PRIVACY_CACHE: 'extension-only',
  ACTIVITY_UPDATE: 'extension-only',
  SESSION_LOCK_REQUEST: 'extension-only',
  REFRESH_LOCAL_MARKDOWN_SCHEDULER: 'extension-only',
  CONSENT_STATE_CHANGED: 'extension-only',
  GENERATE_REVIEW_SUMMARY: 'extension-only',
  LOG_FORWARD: 'extension-only',
  DASHBOARD_SQLITE: 'extension-only',
};

function makeDeps(): MessageRouterDeps {
  return {
    runtimeId: RUNTIME_ID,
    recordingPipeline: { record: async () => ({ success: true }) },
    tabCache: { add: () => undefined, update: () => undefined },
    obsidian: { testConnection: async () => ({ success: true, message: 'ok' }) },
    aiService: { testConnection: async () => ({ success: true, message: 'ok' }) },
    manualRecordDeps: {} as never,
    saveRecordDeps: {} as never,
    hasPrivacyConsent: async () => true,
    buildAllowedUrls: () => new Set(),
    getSettings: async () => ({}),
    isDomainAllowed: async () => true,
    clearSettingsCache: () => undefined,
    notifyAiTestProgress: () => undefined,
    getPrivacyCache: () => null,
    updateActivity: async () => undefined,
    lockSession: async () => undefined,
    autoSavedBadgeTabs: { add: () => undefined, has: () => false },
    initExportScheduler: async () => undefined,
    updateConsentBadge: async () => undefined,
    generateWeeklySummary: async () => true,
    generateMonthlySummary: async () => true,
    dashboardSqliteHandler: () => undefined,
  };
}

const contentScriptSender = {
  id: RUNTIME_ID,
  tab: { id: 3 },
  url: 'https://example.com/page',
} as chrome.runtime.MessageSender;

const extensionPageSender = {
  id: RUNTIME_ID,
  url: `chrome-extension://${RUNTIME_ID}/dashboard.html`,
} as chrome.runtime.MessageSender;

describe('sender trust coverage', () => {
  const router = createMessageRouter(makeDeps());

  it('registers every production message type exactly once', () => {
    expect(router.getRegisteredTypes().sort()).toEqual(Object.keys(EXPECTED_TRUST).sort());
  });

  it('assigns each type the trust level this test documents', () => {
    for (const [type, expectedLevel] of Object.entries(EXPECTED_TRUST)) {
      expect(router.getTrustLevel(type)).toBe(expectedLevel);
    }
  });

  it('has no unregistered type in the documented policy', () => {
    const registered = new Set(router.getRegisteredTypes());
    for (const type of Object.keys(EXPECTED_TRUST)) {
      expect(registered.has(type)).toBe(true);
    }
  });

  describe('content-script reachability', () => {
    for (const [type, level] of Object.entries(EXPECTED_TRUST)) {
      const shouldAllow = level === 'content-script-allowed';

      it(`${shouldAllow ? 'allows' : 'blocks'} a content script for ${type}`, () => {
        const decision = checkSenderTrust(contentScriptSender, level, type, RUNTIME_ID);
        expect(decision.allowed).toBe(shouldAllow);
      });
    }
  });

  describe('extension pages', () => {
    for (const [type, level] of Object.entries(EXPECTED_TRUST)) {
      it(`allows an extension page for ${type}`, () => {
        expect(checkSenderTrust(extensionPageSender, level, type, RUNTIME_ID).allowed).toBe(true);
      });
    }
  });

  describe('external extensions', () => {
    for (const [type, level] of Object.entries(EXPECTED_TRUST)) {
      it(`blocks an external extension for ${type}`, () => {
        const sender = { id: 'other-extension' } as chrome.runtime.MessageSender;
        expect(checkSenderTrust(sender, level, type, RUNTIME_ID).allowed).toBe(false);
      });
    }
  });
});
