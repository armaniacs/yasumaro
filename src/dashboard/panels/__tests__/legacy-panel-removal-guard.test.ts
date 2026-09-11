import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Legacy panel-history removal guard (PBI 2026-09-11-09).
 *
 * The legacy panel was unreachable (catalog navigation had no route to it)
 * and was removed with its 9-module chain. This guard fails if any of the
 * removed identifiers reappear in production code or tests — a re-added
 * panel must go through the catalog + factories deliberately, not by
 * re-introducing the old modules.
 */

const FORBIDDEN = [
  /createHistoryPanel\b/,
  /initHistoryPanel\b/,
  /id:\s*'panel-history'/,
  /id="panel-history"/,
  /['"]\.?\/?historyPanel\.js['"]/,
  /['"]\.?\/?historyState\.js['"]/,
  /['"]\.?\/?historyRenderer\.js['"]/,
  /['"]\.?\/?historyPendingPanel\.js['"]/,
  /['"]\.?\/?historyTagEditModal\.js['"]/,
  /['"]\.?\/?historyEntryRow\.js['"]/,
  /['"]\.?\/?historyCleansingSync\.js['"]/,
  /['"]\.?\/?historyUtils\.js['"]/,
  /['"]\.?\/?historyBadges\.js['"]/,
];

describe('legacy panel-history removal guard (PBI 2026-09-11-09)', () => {
  it('removed panel identifiers do not reappear in src/ or testDir/', () => {
    const root = join(__dirname, '..', '..', '..', '..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name === 'graphify-out') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith('.ts')) continue;
        const rel = relative(root, full).replaceAll('\\', '/');
        // This guard file itself references the patterns; panelCatalog.test.ts
        // holds the negative assertion pin (html must NOT contain the section).
        if (rel.endsWith('legacy-panel-removal-guard.test.ts')) continue;
        if (rel.endsWith('panelCatalog.test.ts')) continue;
        const content = readFileSync(full, 'utf-8');
        for (const pattern of FORBIDDEN) {
          if (pattern.test(content)) offenders.push(`${rel}: ${pattern.source}`);
        }
      }
    };
    walk(join(root, 'src'));
    walk(join(root, 'testDir'));

    expect(offenders).toEqual([]);
  });

  it('the removed modules are gone from disk', async () => {
    const { existsSync } = await import('node:fs');
    const root = join(__dirname, '..', '..', '..');
    for (const rel of [
      'src/dashboard/panels/asyncData/historyPanel.ts',
      'src/dashboard/historyState.ts',
      'src/dashboard/historyRenderer.ts',
      'src/dashboard/historyPendingPanel.ts',
      'src/dashboard/historyTagEditModal.ts',
      'src/dashboard/historyEntryRow.ts',
      'src/dashboard/historyCleansingSync.ts',
      'src/dashboard/historyUtils.ts',
      'src/dashboard/historyBadges.ts',
    ]) {
      expect(existsSync(join(root, rel)), `${rel} must not exist`).toBe(false);
    }
  });
});
