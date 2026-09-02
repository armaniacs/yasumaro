/**
 * check-i18n.mjs / i18n-core.mjs のテスト
 *
 * 検証対象（PBI 2026-09-02-01）:
 * - compareLocaleKeys: 同期状態で extra=0（配列への `in` バグの回帰防止）/
 *   ja にのみ存在するキーは extra として検出 / en 欠落キーは missing として検出
 * - checkI18nCompleteness: 同期済みロケールで fail が出ない（BDD Scenario 1）/
 *   実差分があると fail して false を返す（Scenario 2・3、エントリはこの
 *   戻り値でプロセスを非ゼロ終了させる）/ ロケールディレクトリ欠落時は warn で継続
 * - findEmptyValues: 空翻訳の検出
 * - checkSourceI18nKeys: ソース参照キーの存在確認（既存挙動の維持）
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  loadMessages,
  getAvailableLocales,
  compareLocaleKeys,
  findEmptyValues,
  checkI18nCompleteness,
  checkSourceI18nKeys,
} from '../release-checks/i18n-core.mjs';

interface ReporterCalls {
  pass: string[];
  fail: string[];
  warn: string[];
  info: string[];
}

function makeReporter(): { reporter: Record<string, (m: string) => void>; calls: ReporterCalls } {
  const calls: ReporterCalls = { pass: [], fail: [], warn: [], info: [] };
  const reporter = {
    header: (m: string) => calls.info.push(m),
    pass: (m: string) => calls.pass.push(m),
    fail: (m: string) => calls.fail.push(m),
    warn: (m: string) => calls.warn.push(m),
    info: (m: string) => calls.info.push(m),
  };
  return { reporter, calls };
}

type Messages = Record<string, { message: string }>;

const EN_BASE: Messages = {
  extensionName: { message: 'Yasumaro' },
  appTitle: { message: 'App' },
  greeting: { message: 'Hello' },
};

const JA_SYNC: Messages = {
  extensionName: { message: 'Yasumaro' },
  appTitle: { message: 'アプリ' },
  greeting: { message: 'こんにちは' },
};

const createdDirs: string[] = [];

/** Create a temp _locales fixture directory with the given en/ja messages. */
function makeLocalesFixture(en: Messages, ja: Messages): string {
  const dir = mkdtempSync(join(tmpdir(), 'i18n-check-'));
  createdDirs.push(dir);
  mkdirSync(join(dir, 'en'), { recursive: true });
  mkdirSync(join(dir, 'ja'), { recursive: true });
  writeFileSync(join(dir, 'en', 'messages.json'), JSON.stringify(en));
  writeFileSync(join(dir, 'ja', 'messages.json'), JSON.stringify(ja));
  return dir;
}

beforeAll(() => {
  // 同期状態のフィクスチャ（BDD Scenario 1 用）
  makeLocalesFixture(EN_BASE, JA_SYNC);
});

afterAll(() => {
  for (const dir of createdDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('compareLocaleKeys', () => {
  it('returns no missing/extra when locales are in sync (array `in` regression)', () => {
    // 回帰: 旧実装は Object.keys(en)（配列）に `in` を使ったため、
    // 文字列キーが常に extra と判定されていた（PBI 2026-09-02-01）
    const { missing, extra } = compareLocaleKeys(EN_BASE, JA_SYNC);
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  it('detects a ja-only key as extra', () => {
    const ja = { ...JA_SYNC, jaOnlyKey: { message: '日本語のみ' } };
    const { missing, extra } = compareLocaleKeys(EN_BASE, ja);
    expect(missing).toEqual([]);
    expect(extra).toEqual(['jaOnlyKey']);
  });

  it('detects a key missing from the locale', () => {
    // en は greeting を含むが、JA_SYNC は greeting も含むので missing=0 になる。
    // 代わりに greeting のない ja を渡して、en のみのキーが missing になることを確認
    const en = { ...EN_BASE, greeting: EN_BASE.greeting };
    const ja = { extensionName: JA_SYNC.extensionName, appTitle: JA_SYNC.appTitle };
    const { missing, extra } = compareLocaleKeys(en, ja);
    expect(missing).toEqual(['greeting']);
    expect(extra).toEqual([]);
  });
});

describe('loadMessages', () => {
  it('extracts message values into a flat key map', () => {
    const dir = createdDirs[0];
    const en = loadMessages(dir, 'en');
    expect(en).toEqual({ extensionName: 'Yasumaro', appTitle: 'App', greeting: 'Hello' });
  });

  it('returns null when the locale file does not exist', () => {
    expect(loadMessages(createdDirs[0], 'fr')).toBeNull();
  });
});

describe('getAvailableLocales', () => {
  it('lists locale directories', () => {
    const locales = getAvailableLocales(createdDirs[0]);
    expect(locales).toHaveLength(2);
    expect(locales).toEqual(expect.arrayContaining(['en', 'ja']));
  });

  it('returns an empty array when the directory does not exist', () => {
    expect(getAvailableLocales(join(tmpdir(), 'i18n-check-does-not-exist'))).toEqual([]);
  });
});

describe('findEmptyValues', () => {
  it('detects empty translations', () => {
    // findEmptyValues は loadMessages の戻り値（flat map）を渡す
    const enMap = { extensionName: 'Yasumaro', appTitle: 'App', greeting: 'Hello' };
    const jaMap = { extensionName: 'Yasumaro', appTitle: '', greeting: 'こんにちは' };
    expect(findEmptyValues(enMap, jaMap)).toEqual(['appTitle']);
  });

  it('returns nothing when all translations are filled', () => {
    const enMap = { extensionName: 'Yasumaro', appTitle: 'App', greeting: 'Hello' };
    const jaMap = { extensionName: 'Yasumaro', appTitle: 'アプリ', greeting: 'こんにちは' };
    expect(findEmptyValues(enMap, jaMap)).toEqual([]);
  });
});

describe('checkI18nCompleteness', () => {
  it('passes with no fail reports when locales are in sync (BDD Scenario 1)', () => {
    const { reporter, calls } = makeReporter();
    const ok = checkI18nCompleteness(createdDirs[0], reporter);
    expect(ok).toBe(true);
    expect(calls.fail).toEqual([]);
    expect(calls.warn).toEqual([]);
    expect(calls.pass.some((m) => m.includes('all 3 keys present'))).toBe(true);
  });

  it('fails when a ja-only key exists (BDD Scenario 2: entry exits non-zero on false)', () => {
    const dir = makeLocalesFixture(EN_BASE, { ...JA_SYNC, jaOnlyKey: { message: '日本語のみ' } });
    const { reporter, calls } = makeReporter();
    const ok = checkI18nCompleteness(dir, reporter);
    expect(ok).toBe(false);
    expect(calls.fail.some((m) => m.includes('1 extra key(s) not in en'))).toBe(true);
    expect(calls.info.some((m) => m.includes('extra: jaOnlyKey'))).toBe(true);
  });

  it('fails when en has a key that ja does not have (BDD Scenario 3: missing kept)', () => {
    // BDD: en からキーを1つ削除 → missing として fail される
    // en fixtures は 3 キー（extensionName, appTitle, greeting）
    // ja は greeting を持たないファイルを上書き
    const dir = makeLocalesFixture(EN_BASE, JA_SYNC);
    writeFileSync(
      join(dir, 'ja', 'messages.json'),
      JSON.stringify({ extensionName: JA_SYNC.extensionName, appTitle: JA_SYNC.appTitle }),
    );
    const { reporter, calls } = makeReporter();
    const ok = checkI18nCompleteness(dir, reporter);
    expect(ok).toBe(false);
    expect(calls.fail.some((m) => m.includes('missing 1 key(s)'))).toBe(true);
    expect(calls.info.some((m) => m.includes('missing: greeting'))).toBe(true);
  });

  it('warns and passes when the locales directory itself is absent', () => {
    const { reporter, calls } = makeReporter();
    const ok = checkI18nCompleteness(join(tmpdir(), 'i18n-check-does-not-exist'), reporter);
    expect(ok).toBe(true);
    expect(calls.warn.some((m) => m.includes('No _locales directory found'))).toBe(true);
    // 誤記修正: メッセージは実パス（dist ではなく public/_locales）を指す
    expect(calls.warn.some((m) => m.includes('dist'))).toBe(false);
  });

  it('reports extra keys as fail even alongside missing keys', () => {
    // en は extensionName のみ（1 キー）。ja は appTitle + jaOnlyKey（2 キー）。
    // missing = ['extensionName']（1件）、extra = ['appTitle','jaOnlyKey']（2件）
    const en = { extensionName: EN_BASE.extensionName };
    const ja = { appTitle: JA_SYNC.appTitle, jaOnlyKey: { message: 'x' } };
    const dir = makeLocalesFixture(en, ja);
    const { reporter, calls } = makeReporter();
    const ok = checkI18nCompleteness(dir, reporter);
    expect(ok).toBe(false);
    expect(calls.fail.some((m) => m.includes('missing 1 key(s)'))).toBe(true);
    expect(calls.fail.some((m) => m.includes('2 extra key(s) not in en'))).toBe(true);
  });
});

describe('checkSourceI18nKeys', () => {
  it('passes when all referenced keys exist in en', () => {
    const { reporter, calls } = makeReporter();
    const ok = checkSourceI18nKeys(createdDirs[0], createdDirs[0], reporter);
    expect(ok).toBe(true);
    expect(calls.fail).toEqual([]);
    expect(calls.pass.some((m) => m.includes('All i18n keys in source code exist'))).toBe(true);
  });

  it('fails when a referenced key is missing from en', () => {
    // data-i18n="..." パターンにマッチする .ts ファイルを作成
    const srcDir = mkdtempSync(join(tmpdir(), 'i18n-src-'));
    createdDirs.push(srcDir);
    writeFileSync(
      join(srcDir, 'widget.ts'),
      "const x = 'data-i18n=\"nonexistentKey\"';\n",
    );
    const { reporter, calls } = makeReporter();
    const ok = checkSourceI18nKeys(srcDir, createdDirs[0], reporter);
    expect(ok).toBe(false);
    expect(calls.fail[0]).toContain('used in source but missing from en/messages.json');
    expect(calls.info.some((m) => m.includes('missing: nonexistentKey'))).toBe(true);
  });
});
