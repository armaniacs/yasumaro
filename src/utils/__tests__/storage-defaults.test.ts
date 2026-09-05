import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../storage/defaults.js';
import { StorageKeys } from '../storage/types.js';

describe('DEFAULT_SETTINGS.AI_PROVIDER_PRIORITY_LIST', () => {
  it('デフォルトは空配列である（getSettings側でAI_PROVIDERからの導出を行う）', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.AI_PROVIDER_PRIORITY_LIST]).toEqual([]);
  });

  it('SUMMARY_MIN_LENGTHのデフォルトは10である', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.SUMMARY_MIN_LENGTH]).toBe(10);
  });

  it('OBSIDIAN_PORTのデフォルトは27124である', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.OBSIDIAN_PORT]).toBe('27124');
  });
});

describe('DEFAULT_SETTINGS retention bounds', () => {
  it('レコード層の保持期間デフォルトは365日である（無制限放置を防止する保守的上限）', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.SQLITE_RETENTION_DAYS]).toBe(365);
  });

  it('レコード層の保持期間デフォルトはUIの選択肢と一致する（無制限/30/90/180/365）', () => {
    expect([30, 90, 180, 365]).toContain(DEFAULT_SETTINGS[StorageKeys.SQLITE_RETENTION_DAYS]);
  });
});

describe('DEFAULT_SETTINGS recording defaults (PBI 2026-09-05-10)', () => {
  it('プライバシー同意のデフォルトは OFF である（初回起動時に記録されない）', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.PRIVACY_CONSENT]).toBe(false);
  });

  it('オンボーディング完了フラグのデフォルトは false である（初回起動時にウィザードを表示）', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.ONBOARDING_WIZARD_COMPLETED]).toBe(false);
  });
});
