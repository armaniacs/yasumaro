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
    let serviceWorkerSource: string;

    beforeEach(() => {
      const filePath = join(process.cwd(), 'src/background/service-worker.ts');
      serviceWorkerSource = readFileSync(filePath, 'utf8');
    });

    it('should reject DASHBOARD_SQLITE calls from content scripts (sender.tab present) for ALL subtypes', () => {
      const handleFnMatch = serviceWorkerSource.match(
        /async function handleDashboardSqlite\([\s\S]*?\n\}/
      );
      expect(handleFnMatch).toBeTruthy();
      const handleFn = handleFnMatch![0];

      const hasEarlySenderGuard = /if\s*\(\s*sender\.tab\s*\)/.test(handleFn);
      expect(hasEarlySenderGuard).toBe(true);

      const guardPos = handleFn.indexOf('sender.tab');
      const switchPos = handleFn.indexOf('switch (subtype)');
      expect(guardPos).toBeLessThan(switchPos);
    });

    it('should NOT have subtype-specific sender.tab checks (unified guard)', () => {
      const handleFnMatch = serviceWorkerSource.match(
        /async function handleDashboardSqlite\([\s\S]*?\n\}/
      );
      expect(handleFnMatch).toBeTruthy();
      const handleFn = handleFnMatch![0];

      const clearAllMatch = handleFn.match(/case\s+'clear_all'[\s\S]*?break;/);
      expect(clearAllMatch).toBeTruthy();
      const clearAllBlock = clearAllMatch![0];

      const hasDuplicateGuard = clearAllBlock.includes('sender.tab');
      expect(hasDuplicateGuard).toBe(false);
    });

    it('should have sender.tab guard BEFORE any SQLite operation', () => {
      const handleFnMatch = serviceWorkerSource.match(
        /async function handleDashboardSqlite\([\s\S]*?\n\}/
      );
      expect(handleFnMatch).toBeTruthy();
      const handleFn = handleFnMatch![0];

      const guardPos = handleFn.indexOf('sender.tab');
      const firstSqliteCall = handleFn.indexOf('sqliteClient.');

      expect(guardPos).toBeGreaterThan(-1);
      expect(firstSqliteCall).toBeGreaterThan(-1);
      expect(guardPos).toBeLessThan(firstSqliteCall);
    });
  });

  describe('Issue 2: obsidian_synced schema consistency (Domain Logic High)', () => {
    let sqliteSource: string;

    beforeEach(() => {
      const filePath = join(process.cwd(), 'src/offscreen/sqlite.ts');
      sqliteSource = readFileSync(filePath, 'utf8');
    });

    it('should define obsidian_synced column in CREATE TABLE if index references it', () => {
      const schemaMatch = sqliteSource.match(
        /const SCHEMA_SQL\s*=\s*`([\s\S]*?)`;/
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
