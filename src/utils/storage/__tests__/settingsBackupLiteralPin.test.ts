import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SOURCE_ROOTS = ['src'];
const SKIPPED_DIRS = new Set(['__tests__', 'node_modules', 'dist', '.kilo', '.claude', 'bench']);

const projectRoot = resolve(import.meta.dirname, '../../../..');

function collectSourceFiles(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
}

function findLiteralHits(): string[] {
  const files: string[] = [];
  for (const root of SOURCE_ROOTS) collectSourceFiles(join(projectRoot, root), files);
  const pattern = /(['"])legacy_settings_backup\1/;
  const hits: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (pattern.test(source)) hits.push(relative(projectRoot, file));
  }
  return hits.sort();
}

describe('settings backup literal pin', () => {
  it('keeps the backup key literal in the shared module only', () => {
    expect(findLiteralHits()).toEqual(['src/utils/storage/settingsBackup.ts']);
  });

  it('routes the repository through the shared module', () => {
    const source = readFileSync(join(projectRoot, 'src/utils/storage/SettingsRepository.ts'), 'utf8');
    expect(source).toContain('./settingsBackup.js');
  });
});
