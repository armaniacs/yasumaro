/**
 * messageTypeRegistry.ts
 * Leaf module holding the message-type runtime constants so the neutral
 * wire layer never imports runtime values from background. This file must
 * stay import-free; background/messageTypes.ts re-exports these values.
 */

// ----------------------------------------------------------------------------
// One-way broadcast messages (Service Worker → extension pages)
// ----------------------------------------------------------------------------
// These are intentionally NOT part of ExtensionMessage / VALID_MESSAGE_TYPES:
// VALID_MESSAGE_TYPES is the set of requests the Service Worker RECEIVES and
// validates. Broadcast messages are pushed FROM the SW and never received by
// it, so including them in that union would force every request handler to
// also deal with a type it never expects. Keeping the type here preserves the
// single source of truth for message contracts; see aiTestProgressNotifier.ts.
export const AI_TEST_PROGRESS_MESSAGE_TYPE = 'AI_TEST_PROGRESS' as const;

export const VALID_MESSAGE_TYPES = [
    'VALID_VISIT',
    'CHECK_DOMAIN',
    // GET_CONTENT is delivered to the CONTENT SCRIPT via chrome.tabs.sendMessage
    // (src/content/extractor.ts), not to the Service Worker — no
    // registry.register('GET_CONTENT', ...) exists and none is needed. It stays
    // in this list (and in ExtensionMessage) so the popup senders and the
    // content-script receiver share one typed contract; the SW's dispatcher
    // simply never sees it.
    'GET_CONTENT',
    'FETCH_URL',
    'MANUAL_RECORD',
    'PREVIEW_RECORD',
    'SAVE_RECORD',
    'REGENERATE_SUMMARY',
    'TEST_CONNECTIONS',
    'TEST_OBSIDIAN',
    'TEST_AI',
    'GET_PRIVACY_CACHE',
    'ACTIVITY_UPDATE',
    'SESSION_LOCK_REQUEST',
    'CONTENT_CLEANSING_EXECUTED',
    'PING', // Service Worker health check
    'REFRESH_LOCAL_MARKDOWN_SCHEDULER', // Re-run initExportScheduler() after a timing change is saved
    'CONSENT_STATE_CHANGED', // Re-run updateConsentBadge() after accept/decline
    'DASHBOARD_SQLITE', // Dashboard SQLite query/update operations
    'GENERATE_REVIEW_SUMMARY', // Manually trigger weekly/monthly review summary generation
    'LOG_FORWARD', // Log relay from Offscreen Document / its Worker (no direct chrome.storage access)
] as const;

/**
 * Full set of types that content scripts are allowed to send.
 * Canonical SSOT for MessageRouter's trust table — MessageRouter derives
 * its `contentScriptAllowed` Set from this array. Adding a new
 * content-script-allowed type requires editing only this array.
 */
export const CONTENT_SCRIPT_ALLOWED_TYPES = [
    'VALID_VISIT',
    'CONTENT_CLEANSING_EXECUTED',
    'CHECK_DOMAIN',
    'PING',
] as const;

export const NO_PAYLOAD_TYPES = [
    'CHECK_DOMAIN',
    'GET_CONTENT',
    'GET_PRIVACY_CACHE',
    'ACTIVITY_UPDATE',
    'SESSION_LOCK_REQUEST',
    'PING',
    'REFRESH_LOCAL_MARKDOWN_SCHEDULER',
    'CONSENT_STATE_CHANGED',
    'TEST_CONNECTIONS',
    'TEST_AI',
] as const;
