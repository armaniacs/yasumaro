// @vitest-environment jsdom
/**
 * archiveWording.test.ts
 * PBI 2026-09-06-06: the archive panel description must describe phase A as
 * a *backup* (copy — the main DB is untouched), not 退避 (which reads as a
 * move), and must present deletion as an optional next step.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');

function readLocale(locale: string): Record<string, { message: string }> {
  return JSON.parse(
    fs.readFileSync(path.join(root, `public/_locales/${locale}/messages.json`), 'utf8'),
  );
}

describe('archive panel wording (PBI 2026-09-06-06)', () => {
  it('ja description uses バックアップ copy semantics and the next-step deletion framing', () => {
    const text = readLocale('ja').archivePanelDescription!.message;
    expect(text).toContain('バックアップします');
    expect(text).toContain('フェーズ2（次ステップ）でローカルDBから削除も可能です');
    expect(text).toContain('任意のSQLiteツールで開けます');
    expect(text).not.toContain('退避');
  });

  it('en description uses Backs up copy semantics (not "then remove")', () => {
    const text = readLocale('en').archivePanelDescription!.message;
    expect(text).toContain('Backs up browsing history');
    expect(text).toContain('In phase 2 (next step), you can also delete it from the local database');
    expect(text).toContain('any SQLite tool');
    expect(text).not.toContain('then remove it from the local database');
  });
});
