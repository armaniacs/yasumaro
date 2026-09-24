/**
 * localeParity.test.ts — 実 locale ファイルを日常ゲートで parity 検査する
 * (PBI 2026-09-24-12)。
 *
 * compareLocaleKeys は release:check 専用 (scripts/release-checks/index.mjs) で、
 * npm test / npm run validate は実 messages.json を読んでいなかった。そのため
 * en/ja 間の漂着キー (domainAnalysis_periodLabel) が parity 機構を素通りした。
 * このテストは同じ比較器に実ファイルを流し、validate ゲートで欠落 (missing) /
 * 孤立 (extra) を両方向に検出する。ネガティブ確認: 実 en のキーを 1 つ削除した
 * コピーで missing 報告を確認済み (PBI テスト戦略、リポジトリファイルは無変更)。
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';

import { compareLocaleKeys, loadMessages } from '../release-checks/i18n-core.mjs';

const localesDir = resolve(__dirname, '..', '..', 'public', '_locales');

describe('locale parity en↔ja — 実 messages.json (PBI 2026-09-24-12)', () => {
  const en = loadMessages(localesDir, 'en');
  const ja = loadMessages(localesDir, 'ja');

  it('loads both real locale files', () => {
    expect(en, `en/messages.json not found under ${localesDir}`).not.toBeNull();
    expect(ja, `ja/messages.json not found under ${localesDir}`).not.toBeNull();
  });

  it('reports no keys missing from ja', () => {
    const { missing } = compareLocaleKeys(en, ja);
    expect(
      missing,
      `ja/messages.json に欠落しているキー: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('reports no ja-only keys missing from en', () => {
    const { extra } = compareLocaleKeys(en, ja);
    expect(
      extra,
      `en/messages.json に存在しない孤立キー: ${extra.join(', ')}`,
    ).toEqual([]);
  });
});
