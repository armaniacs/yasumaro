/**
 * sqlite-security-integrity.test.ts
 * Tests for critical security and data integrity issues identified by review agents:
 *
 * 1. [Red Team High] DASHBOARD_SQLITE handler sender validation
 * 2. [Domain Logic High] obsidian_synced index references non-existent column
 * 3. [API Contract High] obsidian_synced not in SQLITE_UPDATE whitelist
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MessageHandlerRegistry } from '../background/handlers/MessageHandlerRegistry.js';
import { createMessageHandlerRegistry } from '../background/handlers/createMessageHandlerRegistry.js';

describe('SQLite Security & Data Integrity', () => {
  describe('Issue 1: DASHBOARD_SQLITE sender validation (Red Team High)', () => {
    // The invariant is that a content script cannot reach any SQLite operation
    // through DASHBOARD_SQLITE. This used to be checked by string-matching a
    // `sender.tab` guard inside service-worker.ts; the guard now lives in
    // MessageHandlerRegistry, which enforces it for every registered type. The
    // checks below exercise that behaviour instead of the guard's old location,
    // so they keep holding wherever the enforcement lives.
    const RUNTIME_ID = 'test-extension-id';

    const CONTENT_SCRIPT_SENDER = {
      id: RUNTIME_ID,
      tab: { id: 1 },
      url: 'https://evil.example/page',
    } as chrome.runtime.MessageSender;

    const DASHBOARD_SENDER = {
      id: RUNTIME_ID,
      url: `chrome-extension://${RUNTIME_ID}/dashboard.html`,
    } as chrome.runtime.MessageSender;

    /** Every subtype the dashboard SQLite protocol accepts. */
    const ALL_SUBTYPES = [
      'query', 'search', 'toggle_star', 'delete', 'update', 'get_count', 'clear_all',
      'import', 'restore_db', 'status', 'opfs_spike', 'append_to_obsidian', 'purge_now',
      'audit_log_query', 'content_purge_now', 'backup_db', 'backfill_metadata',
      'cleanup_legacy', 'migrate', 'confirm_token',
    ];

    it('registers DASHBOARD_SQLITE as extension-only', () => {
      const composition = createMessageHandlerRegistry({
        runtimeId: RUNTIME_ID,
        recordingLogic: { record: async () => ({ success: true }) },
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
      });
      expect(composition.handlers.DASHBOARD_SQLITE).toBeDefined();
      expect(composition.trustLevels.DASHBOARD_SQLITE).toBe('extension-only');
    });

    it('should reject DASHBOARD_SQLITE calls from content scripts for ALL subtypes', () => {
      const registry = new MessageHandlerRegistry(RUNTIME_ID);
      const handler = vi.fn();
      registry.register('DASHBOARD_SQLITE', handler, 'extension-only');

      for (const subtype of ALL_SUBTYPES) {
        const sendResponse = vi.fn();
        registry.dispatch(
          'DASHBOARD_SQLITE',
          { type: 'DASHBOARD_SQLITE', payload: { subtype } },
          CONTENT_SCRIPT_SENDER,
          sendResponse,
        );

        expect(sendResponse).toHaveBeenCalledWith({
          success: false,
          error: 'DASHBOARD_SQLITE is not allowed from content scripts',
        });
      }

      // No subtype reached the handler.
      expect(handler).not.toHaveBeenCalled();
    });

    it('should reject the guard BEFORE any SQLite operation runs', () => {
      const registry = new MessageHandlerRegistry(RUNTIME_ID);
      const handler = vi.fn();
      const sendResponse = vi.fn();
      registry.register('DASHBOARD_SQLITE', handler, 'extension-only');

      const handled = registry.dispatch(
        'DASHBOARD_SQLITE',
        { type: 'DASHBOARD_SQLITE', payload: { subtype: 'clear_all' } },
        CONTENT_SCRIPT_SENDER,
        sendResponse,
      );

      // dispatch returns false and never invokes the handler, so the SQLite
      // operation cannot have started.
      expect(handled).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });

    it('still allows the dashboard itself', () => {
      const registry = new MessageHandlerRegistry(RUNTIME_ID);
      const handler = vi.fn();
      const sendResponse = vi.fn();
      registry.register('DASHBOARD_SQLITE', handler, 'extension-only');

      registry.dispatch(
        'DASHBOARD_SQLITE',
        { type: 'DASHBOARD_SQLITE', payload: { subtype: 'query' } },
        DASHBOARD_SENDER,
        sendResponse,
      );

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should NOT have subtype-specific sender checks (unified guard)', () => {
      const handlerSource = readFileSync(
        join(process.cwd(), 'src/background/handlers/dashboardSqliteHandlers.ts'),
        'utf8',
      );
      expect(handlerSource.includes('sender.tab')).toBe(false);
    });
  });

  describe('Issue 2: obsidian_synced schema consistency (Domain Logic High)', () => {
    let schemaSource: string;

    beforeEach(() => {
      const filePath = join(process.cwd(), 'src/offscreen/schema.ts');
      schemaSource = readFileSync(filePath, 'utf8');
    });

    it('should define obsidian_synced column in CREATE TABLE if index references it', () => {
      const schemaMatch = schemaSource.match(
        /export const SCHEMA_SQL\s*=\s*`([\s\S]*?)`;/
      );
      expect(schemaMatch).toBeTruthy();
      const schema = schemaMatch![1];

      const hasObsidianIndex = schema.includes('idx_logs_obsidian') &&
        schema.includes('obsidian_synced');
      const hasObsidianColumn = /CREATE TABLE[\s\S]*?obsidian_synced\s+INTEGER/.test(schema);

      if (hasObsidianIndex) {
        expect(hasObsidianColumn).toBe(true);
      }
    });

    it('should include obsidian_synced in BrowsingLogRecord type', () => {
      const typesPath = join(process.cwd(), 'src/utils/sqlite-types.ts');
      const typesSource = readFileSync(typesPath, 'utf8');

      const hasField = /obsidian_synced\s*\?\s*:\s*number/.test(typesSource);
      expect(hasField).toBe(true);
    });
  });

  describe('Issue 3: obsidian_synced in SQLITE_UPDATE whitelist (API Contract High)', () => {
    let offscreenSource: string;

    beforeEach(() => {
      const filePath = join(process.cwd(), 'src/offscreen/offscreen.ts');
      offscreenSource = readFileSync(filePath, 'utf8');
    });

    it('should include obsidian_synced in the SQLITE_UPDATE allowed fields whitelist', () => {
      const updateHandlerMatch = offscreenSource.match(
        /SQLITE_UPDATE[\s\S]*?for\s*\(\s*const\s+key\s+of\s+\[([\s\S]*?)\]/
      );
      expect(updateHandlerMatch).toBeTruthy();
      const whitelistStr = updateHandlerMatch![1];

      expect(whitelistStr).toContain('obsidian_synced');
    });

    it('whitelist should contain all fields that ObsidianSyncService may update', () => {
      const updateHandlerMatch = offscreenSource.match(
        /SQLITE_UPDATE[\s\S]*?for\s*\(\s*const\s+key\s+of\s+\[([\s\S]*?)\]/
      );
      expect(updateHandlerMatch).toBeTruthy();
      const whitelistStr = updateHandlerMatch![1];

      const expectedFields = [
        'url', 'title', 'summary', 'tags', 'domain',
        'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted',
        'obsidian_synced',
      ];

      for (const field of expectedFields) {
        expect(whitelistStr).toContain(`'${field}'`);
      }
    });
  });
});
