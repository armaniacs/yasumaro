/**
 * migration-defaults.test.ts
 * テスト: migrateJpLayoutDefault / migrateCategoryBDefault / migrateWhitelistExtractionDefault
 * 【テスト対象】: src/utils/migration.ts の各種デフォルト値移行関数（既存ユーザー/新規ユーザー分岐）
 */

import { test, expect, vi, beforeEach } from 'vitest';
import {
  migrateJpLayoutDefault,
  migrateCategoryBDefault,
  migrateWhitelistExtractionDefault
} from '../migration.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetAllMocks();

  global.chrome = {
    storage: {
      local: {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn()
      }
    },
    runtime: {
      lastError: null
    }
  } as unknown as typeof chrome;
});

describe('migrateJpLayoutDefault', () => {
  test('returns false without doing anything when already migrated', async () => {
    (global as any).chrome.storage.local.get.mockResolvedValue({
      migration_jp_layout_default_done: true
    });

    const result = await migrateJpLayoutDefault();

    expect(result).toBe(false);
    expect((global as any).chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('does not overwrite jpLayout for users who set it explicitly', async () => {
    (global as any).chrome.storage.local.get.mockResolvedValueOnce({
      ai_summary_cleansing_jp_layout: true
    });

    const result = await migrateJpLayoutDefault();

    expect(result).toBe(true);
    // jpLayoutキー自体はセットされず、migration doneのみセットされる
    expect((global as any).chrome.storage.local.set).toHaveBeenCalledWith({
      migration_jp_layout_default_done: true
    });
    expect((global as any).chrome.storage.local.set).toHaveBeenCalledTimes(1);
  });

  test('sets false for existing users with unset jpLayout and other settings present', async () => {
    (global as any).chrome.storage.local.get.mockImplementation((keys: unknown) => {
      if (keys === null) {
        return Promise.resolve({ some_other_setting: 'value' });
      }
      return Promise.resolve({});
    });

    const result = await migrateJpLayoutDefault();

    expect(result).toBe(true);
    expect((global as any).chrome.storage.local.set).toHaveBeenCalledWith({
      ai_summary_cleansing_jp_layout: false
    });
    expect((global as any).chrome.storage.local.set).toHaveBeenCalledWith({
      migration_jp_layout_default_done: true
    });
  });

  test('overwrites nothing on a fresh install with empty storage', async () => {
    (global as any).chrome.storage.local.get.mockImplementation((keys: unknown) => {
      if (keys === null) {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const result = await migrateJpLayoutDefault();

    expect(result).toBe(true);
    // jpLayoutキーはセットされず、migration doneのみ
    expect((global as any).chrome.storage.local.set).toHaveBeenCalledWith({
      migration_jp_layout_default_done: true
    });
    expect((global as any).chrome.storage.local.set).toHaveBeenCalledTimes(1);
  });
});

describe('migrateCategoryBDefault', () => {
  test('returns false without doing anything when already migrated', async () => {
    (global as any).chrome.storage.local.get.mockResolvedValue({
      migration_category_b_default_done: true
    });

    const result = await migrateCategoryBDefault();

    expect(result).toBe(false);
    expect((global as any).chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('does not overwrite users who already set any Category B key', async () => {
    (global as any).chrome.storage.local.get.mockResolvedValueOnce({
      ai_summary_cleansing_news_media: true
    });

    const result = await migrateCategoryBDefault();

    expect(result).toBe(true);
    expect((global as any).chrome.storage.local.set).toHaveBeenCalledWith({
      migration_category_b_default_done: true
    });
    expect((global as any).chrome.storage.local.set).toHaveBeenCalledTimes(1);
  });

  test('sets all 4 flags to false for existing users with unset keys and other settings present', async () => {
    (global as any).chrome.storage.local.get.mockImplementation((keys: unknown) => {
      if (keys === null) {
        return Promise.resolve({ some_other_setting: 'value' });
      }
      return Promise.resolve({});
    });

    const result = await migrateCategoryBDefault();

    expect(result).toBe(true);
    expect((global as any).chrome.storage.local.set).toHaveBeenCalledWith({
      ai_summary_cleansing_news_media: false,
      ai_summary_cleansing_ec_site: false,
      ai_summary_cleansing_qa_site: false,
      ai_summary_cleansing_video_site: false
    });
    expect((global as any).chrome.storage.local.set).toHaveBeenCalledWith({
      migration_category_b_default_done: true
    });
  });

  test('overwrites nothing on a fresh install with empty storage', async () => {
    (global as any).chrome.storage.local.get.mockImplementation((keys: unknown) => {
      if (keys === null) {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const result = await migrateCategoryBDefault();

    expect(result).toBe(true);
    expect((global as any).chrome.storage.local.set).toHaveBeenCalledWith({
      migration_category_b_default_done: true
    });
    expect((global as any).chrome.storage.local.set).toHaveBeenCalledTimes(1);
  });
});

describe('migrateWhitelistExtractionDefault', () => {
  test('returns false without doing anything when already migrated', async () => {
    (global as any).chrome.storage.local.get.mockResolvedValue({
      migration_whitelist_extraction_default_done: true
    });

    const result = await migrateWhitelistExtractionDefault();

    expect(result).toBe(false);
    expect((global as any).chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('does not overwrite users who already set whitelist_extraction_enabled', async () => {
    (global as any).chrome.storage.local.get.mockResolvedValueOnce({
      whitelist_extraction_enabled: true
    });

    const result = await migrateWhitelistExtractionDefault();

    expect(result).toBe(true);
    expect((global as any).chrome.storage.local.set).toHaveBeenCalledWith({
      migration_whitelist_extraction_default_done: true
    });
    expect((global as any).chrome.storage.local.set).toHaveBeenCalledTimes(1);
  });

  test('sets false for existing users with unset keys and other settings present', async () => {
    (global as any).chrome.storage.local.get.mockImplementation((keys: unknown) => {
      if (keys === null) {
        return Promise.resolve({ some_other_setting: 'value' });
      }
      return Promise.resolve({});
    });

    const result = await migrateWhitelistExtractionDefault();

    expect(result).toBe(true);
    expect((global as any).chrome.storage.local.set).toHaveBeenCalledWith({
      whitelist_extraction_enabled: false
    });
    expect((global as any).chrome.storage.local.set).toHaveBeenCalledWith({
      migration_whitelist_extraction_default_done: true
    });
  });

  test('overwrites nothing on a fresh install with empty storage', async () => {
    (global as any).chrome.storage.local.get.mockImplementation((keys: unknown) => {
      if (keys === null) {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const result = await migrateWhitelistExtractionDefault();

    expect(result).toBe(true);
    expect((global as any).chrome.storage.local.set).toHaveBeenCalledWith({
      migration_whitelist_extraction_default_done: true
    });
    expect((global as any).chrome.storage.local.set).toHaveBeenCalledTimes(1);
  });
});
