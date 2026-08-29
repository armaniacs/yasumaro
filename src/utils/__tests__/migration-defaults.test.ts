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
  test('既に移行済みの場合は何もせずfalseを返す', async () => {
    (global as any).chrome.storage.local.get.mockResolvedValue({
      migration_jp_layout_default_done: true
    });

    const result = await migrateJpLayoutDefault();

    expect(result).toBe(false);
    expect((global as any).chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('jpLayoutを既に明示的に設定しているユーザーは上書きしない', async () => {
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

  test('jpLayout未設定かつ他の設定が存在する既存ユーザーはfalseに設定される', async () => {
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

  test('ストレージが完全に空の新規インストールでは何も上書きしない', async () => {
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
  test('既に移行済みの場合は何もせずfalseを返す', async () => {
    (global as any).chrome.storage.local.get.mockResolvedValue({
      migration_category_b_default_done: true
    });

    const result = await migrateCategoryBDefault();

    expect(result).toBe(false);
    expect((global as any).chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('Category Bキーのいずれかを既に設定済みのユーザーは上書きしない', async () => {
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

  test('未設定かつ他の設定が存在する既存ユーザーは4フラグすべてfalseに設定される', async () => {
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

  test('ストレージが完全に空の新規インストールでは何も上書きしない', async () => {
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
  test('既に移行済みの場合は何もせずfalseを返す', async () => {
    (global as any).chrome.storage.local.get.mockResolvedValue({
      migration_whitelist_extraction_default_done: true
    });

    const result = await migrateWhitelistExtractionDefault();

    expect(result).toBe(false);
    expect((global as any).chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('whitelist_extraction_enabledを既に設定済みのユーザーは上書きしない', async () => {
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

  test('未設定かつ他の設定が存在する既存ユーザーはfalseに設定される', async () => {
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

  test('ストレージが完全に空の新規インストールでは何も上書きしない', async () => {
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
