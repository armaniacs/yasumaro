/**
 * Locks down which message types content scripts may reach.
 *
 * Authorization used to be enforced inside each handler, in four different
 * spellings, with four types left unguarded. It now lives in the registry, so
 * this reads the registration table out of service-worker.ts and asserts the
 * level of every type. Adding a handler without a level fails to compile;
 * changing an existing type's level fails here, which is what makes deleting
 * the old per-handler guards safe.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { checkSenderTrust, type SenderTrustLevel } from '../senderTrust.js';

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

function readRegistrations(): Map<string, string> {
  const source = readFileSync(join(process.cwd(), 'src/background/service-worker.ts'), 'utf8');
  const found = new Map<string, string>();
  const pattern = /registry\.register\(\s*'([A-Z_]+)'\s*,\s*[^,]+,\s*'([a-z-]+)'\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    found.set(match[1]!, match[2]!);
  }
  return found;
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
  const registrations = readRegistrations();

  it('registers every message type with an explicit trust level', () => {
    expect(registrations.size).toBe(Object.keys(EXPECTED_TRUST).length);
  });

  it('assigns each type the trust level this test documents', () => {
    const actual = Object.fromEntries([...registrations.entries()].sort());
    const expected = Object.fromEntries(Object.entries(EXPECTED_TRUST).sort());
    expect(actual).toEqual(expected);
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
