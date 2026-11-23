/**
 * gen-oxlintrc-ssot.test.ts
 *
 * PBI 2026-11-23-08: oxlint用の例外2件は生成側 (scripts/gen-oxlintrc.mjs) に
 * 直書きせず、定義書側 (eslint.config.js) の資料 `oxlintReconciliations` に
 * 一本化する。生成側は資料を読むだけにする。
 *
 * - 生成物を `--stdout` で取得し照合する（ファイル書き込みなしの統合試験）
 * - 資料の形が崩れていたら生成は fail-closed で止まる
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { oxlintReconciliations } from '../../eslint.config.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const generator = join(root, 'scripts', 'gen-oxlintrc.mjs');

function generateStdout(): string {
  return execFileSync('node', [generator, '--stdout'], { encoding: 'utf8', cwd: root });
}

describe('oxlintReconciliations (SSOT資料の形状)', () => {
  it('例外2件が定義書側の資料として読める', () => {
    expect(Array.isArray(oxlintReconciliations)).toBe(true);
    expect(oxlintReconciliations).toHaveLength(2);
    for (const entry of oxlintReconciliations) {
      expect(Array.isArray(entry.files)).toBe(true);
      expect(entry.files.length).toBeGreaterThan(0);
      expect(typeof entry.rules).toBe('object');
      expect(Object.keys(entry.rules ?? {}).length).toBeGreaterThan(0);
      expect(typeof entry.reason).toBe('string');
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('gen-oxlintrc.mjs (生成物の照合)', () => {
  it('生成物に定義書側の例外2件が反映される', () => {
    const oxlintrc = JSON.parse(generateStdout());
    const byFile = (file: string) =>
      oxlintrc.overrides.filter((o: { files?: string[] }) => o.files?.includes(file));

    const audit = byFile('src/messaging/auditLogGateway.ts');
    expect(audit).toHaveLength(1);
    expect(audit[0].rules).toEqual({ 'no-restricted-imports': 'off' });

    const loopTests = [
      'src/background/ai/__tests__/providerCatalog.test.ts',
      'src/background/ai/__tests__/provider-catalog-derivation.test.ts',
      'src/utils/storage/__tests__/provider-domain-ssot.derivation.test.ts',
      'src/utils/storage/__tests__/providerAllowlist.test.ts',
    ];
    for (const file of loopTests) {
      const hit = byFile(file);
      expect(hit).toHaveLength(1);
      expect(hit[0].rules).toEqual({ 'vitest/expect-expect': 'off' });
      expect(hit[0].plugins).toContain('vitest');
    }
  });

  it('コミット済みの生成物と --stdout が一致する（食い違い検出）', () => {
    const committed = readFileSync(join(root, '.oxlintrc.json'), 'utf8');
    expect(generateStdout()).toBe(committed);
  });

  it('生成側に個別の例外記述が残らない', () => {
    const source = readFileSync(generator, 'utf8');
    expect(source).not.toContain('auditLogGateway');
    expect(source).not.toContain('providerCatalog');
    expect(source).not.toContain('providerAllowlist');
  });
});

describe('fail-closed (資料の形が崩れたら生成を止める)', () => {
  it('資料が壊れていると生成が非ゼロ終了する', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'gen-oxlintrc-ssot-'));
    const sandboxScripts = join(sandbox, 'scripts');
    mkdirSync(sandboxScripts, { recursive: true });
    copyFileSync(generator, join(sandboxScripts, 'gen-oxlintrc.mjs'));
    const broken =
      readFileSync(join(root, 'eslint.config.js'), 'utf8') +
      '\noxlintReconciliations.push({ files: "not-an-array", rules: 42 });\n';
    writeFileSync(join(sandbox, 'eslint.config.js'), broken);
    expect(() =>
      execFileSync('node', [join(sandboxScripts, 'gen-oxlintrc.mjs'), '--stdout'], {
        encoding: 'utf8',
        cwd: sandbox,
      }),
    ).toThrow();
  });
});
