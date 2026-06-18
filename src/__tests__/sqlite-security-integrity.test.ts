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

describe('SQLite Security & Data Integrity', () => {
  describe('Issue 1: DASHBOARD_SQLITE sender validation (Red Team High)', () => {
    // After PBI-104 refactor: handleDashboardSqlite is in dashboardSqliteHandlers.ts
    // The sender.tab guard is enforced at the call site in service-worker.ts
    let serviceWorkerSource: string;
    let handlerSource: string;

    beforeEach(() => {
      serviceWorkerSource = readFileSync(join(process.cwd(), 'src/background/service-worker.ts'), 'utf8');
      handlerSource = readFileSync(join(process.cwd(), 'src/background/handlers/dashboardSqliteHandlers.ts'), 'utf8');
    });

    it('should reject DASHBOARD_SQLITE calls from content scripts (sender.tab present) for ALL subtypes', () => {
      // The guard lives in service-worker.ts at the call site
      const dashboardSqliteBlock = serviceWorkerSource.match(
        /if\s*\(\s*message\.type\s*===\s*['"]DASHBOARD_SQLITE['"]\s*\)[\s\S]*?return;\s*\}/
      );
      expect(dashboardSqliteBlock).toBeTruthy();
      const block = dashboardSqliteBlock![0];

      const hasEarlySenderGuard = /if\s*\(\s*sender\.tab\b/.test(block);
      expect(hasEarlySenderGuard).toBe(true);
    });

    it('should NOT have subtype-specific sender.tab checks (unified guard)', () => {
      // The extracted handler in dashboardSqliteHandlers.ts should NOT contain sender.tab checks
      // because the guard is unified at the service-worker call site
      const hasSenderTabInHandler = handlerSource.includes('sender.tab');
      expect(hasSenderTabInHandler).toBe(false);
    });

    it('should have sender.tab guard BEFORE any SQLite operation', () => {
      // In service-worker.ts, the sender.tab check must come before handleDashboardSqlite call
      const dashboardSection = serviceWorkerSource.match(
        /message\.type\s*===\s*['"]DASHBOARD_SQLITE['"][\s\S]*?handleDashboardSqlite/
      );
      expect(dashboardSection).toBeTruthy();
      const section = dashboardSection![0];

      const guardPos = section.indexOf('sender.tab');
      const callPos = section.indexOf('handleDashboardSqlite');

      expect(guardPos).toBeGreaterThan(-1);
      expect(callPos).toBeGreaterThan(-1);
      expect(guardPos).toBeLessThan(callPos);
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
