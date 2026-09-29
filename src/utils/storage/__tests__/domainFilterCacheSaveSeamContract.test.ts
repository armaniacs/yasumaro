/**
 * domainFilterCacheSaveSeamContract.test.ts
 *
 * Contract (PBI 2026-09-28-02): saving domain-related settings and rebuilding
 * the content-script cache has exactly one owner —
 * `saveSettingsAndRefreshDomainFilterCache` in `domainFilterCache.ts`. The
 * pasted `await (async (s) => { setAll(s); updateDomainFilterCache(await
 * getAll()); })(snapshot)` survived in four dashboard call sites after the
 * seam landed, and each copy also carried the delta-write violation: a
 * `getAll()` snapshot pushed back through `setAll` reverts keys a concurrent
 * writer changed, and the cache is then rebuilt from that stale snapshot.
 *
 * Source scan, not a runtime spy: an inline IIFE is defined at the call site,
 * so a behavioural suite only ever sees the storage spy, and only a static
 * scan sees a call site no test happens to exercise.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SOURCE_ROOTS = ['src', 'entrypoints'];
const SKIPPED_DIRS = new Set(['__tests__', 'node_modules', 'dist', '.kilo', '.claude', 'bench']);

const SEAM_FILE = 'src/utils/storage/domainFilterCache.ts';
const SEAM_EXPORT = 'saveSettingsAndRefreshDomainFilterCache';

/**
 * The call sites the seam was adopted at. A module listed here must reach the
 * cache rebuild through the seam, so a direct `updateDomainFilterCache` call in
 * one of them is a re-opened path around the delta contract — and the seam
 * payload must be the delta literal, never a forwarded settings snapshot.
 *
 * The Tranco consent write moved behind its own owner
 * (`src/utils/storage/trancoConsent.ts`, PBI 2026-09-29-38), so it is the
 * shared module that sits on the seam now, and the two UI call sites are
 * guarded separately below.
 */
const ADOPTED_CALL_SITES = [
  'src/utils/storage/trancoConsent.ts',
  'src/dashboard/tagsPanel.ts',
  'src/dashboard/panels/staticForm/generalSettingsPanel.ts',
];

/**
 * Call sites that write the same three consent keys indirectly. They must not
 * re-open the path around the seam with a direct cache rebuild.
 */
const DELEGATED_CONSENT_WRITERS = [
  'src/dashboard/trancoConsent.ts',
  'src/popup/trancoNotification.ts',
];

/**
 * An inline async arrow IIFE whose body pairs `setAll` with
 * `updateDomainFilterCache`, i.e. the pasted save-and-refresh sequence.
 * Whitespace-tolerant so a reformat cannot slip past the pin; brace-free so
 * an unrelated nested IIFE (retry/preset loops) is not swept in.
 */
const PASTED_SAVE_IIFE =
  /\(\s*async\s*\([^)]*\)\s*=>\s*\{[^{}]*?\.setAll\s*\([^{}]*?updateDomainFilterCache\s*\(/g;

/** The call head of a seam invocation; the payload is what follows it. */
const SEAM_CALL_OPEN = new RegExp(`${SEAM_EXPORT}\\s*\\(`, 'g');

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

function productionSources(): string[] {
  const files: string[] = [];
  for (const root of SOURCE_ROOTS) collectSourceFiles(join(projectRoot, root), files);
  return files;
}

function findPastedIifes(): string[] {
  const found: string[] = [];
  for (const file of productionSources()) {
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(PASTED_SAVE_IIFE)) {
      const line = source.slice(0, m.index).split('\n').length;
      found.push(`${relative(projectRoot, file).replaceAll('\\', '/')}:${line}`);
    }
  }
  return found.sort();
}

/**
 * Seam calls whose payload is not an inline object literal. The payload has
 * to be the delta spelled out at the call site, so a call that forwards a
 * variable is the shape a `getAll()` snapshot comes back in.
 */
function findForwardedSnapshotPayloads(source: string): string[] {
  const forwarded: string[] = [];
  for (const m of source.matchAll(SEAM_CALL_OPEN)) {
    const rest = source.slice(m.index + m[0].length).replace(/^\s+/, '');
    if (rest[0] !== '{') forwarded.push(rest.slice(0, 24));
  }
  return forwarded;
}

describe('domain filter cache save seam (PBI 2026-09-28-02)', () => {
  it('finds zero pasted save-and-refresh IIFEs in production sources', () => {
    expect(findPastedIifes()).toEqual([]);
  });

  it('still detects the pasted IIFE when one is reintroduced', () => {
    // A source scan is only a contract if it can fail. Re-run the detector on
    // the exact spelling that used to sit in trancoConsent.ts.
    const source =
      'await (async (s)=>{ await settingsRepository.setAll(s); await updateDomainFilterCache(await settingsRepository.getAll()); })(updatedSettings);';

    expect([...source.matchAll(PASTED_SAVE_IIFE)]).toHaveLength(1);
    // ...and a reformat of the same sequence, which the byte-form regex above
    // would miss if it were not whitespace-tolerant.
    const reformatted = `await (async (s) => {
        await settingsRepository.setAll(s);
        await updateDomainFilterCache(await settingsRepository.getAll());
      })(updatedSettings);`;
    expect([...reformatted.matchAll(PASTED_SAVE_IIFE)]).toHaveLength(1);
  });

  it('keeps the seam itself as the single save-and-refresh implementation', () => {
    const seam = readFileSync(join(projectRoot, ...SEAM_FILE.split('/')), 'utf-8');
    expect(seam).toMatch(new RegExp(`export\\s+async\\s+function\\s+${SEAM_EXPORT}\\b`));

    for (const rel of ADOPTED_CALL_SITES) {
      const source = readFileSync(join(projectRoot, ...rel.split('/')), 'utf-8');
      expect(source, `${rel} must save through the seam`).toContain(SEAM_EXPORT);
      expect(source, `${rel} must not re-open a direct cache rebuild`).not.toMatch(
        /\bupdateDomainFilterCache\s*\(/,
      );
    }
  });

  it('hands the seam a delta literal, never a settings snapshot variable', () => {
    const forwarded: string[] = [];
    for (const rel of ADOPTED_CALL_SITES) {
      const source = readFileSync(join(projectRoot, ...rel.split('/')), 'utf-8');
      for (const payload of findForwardedSnapshotPayloads(source)) {
        forwarded.push(`${rel}: ${payload}`);
      }
    }
    expect(forwarded).toEqual([]);

    // Detector self-test: the seam's own signature takes a parameter, so the
    // shape that must be caught is a call site forwarding a snapshot variable.
    expect(findForwardedSnapshotPayloads('await saveSettingsAndRefreshDomainFilterCache(snapshot);'))
      .toEqual(['snapshot);']);
    expect(findForwardedSnapshotPayloads('await saveSettingsAndRefreshDomainFilterCache(\n    { a: 1 },\n  );'))
      .toEqual([]);
  });

  it('keeps delegated consent writers off the direct cache-rebuild path', () => {
    for (const rel of DELEGATED_CONSENT_WRITERS) {
      const source = readFileSync(join(projectRoot, ...rel.split('/')), 'utf-8');
      expect(source, `${rel} must save consent through the shared module`).toMatch(
        /utils\/storage\/trancoConsent\.js/,
      );
      expect(source, `${rel} must not re-open a direct cache rebuild`).not.toMatch(
        /\bupdateDomainFilterCache\s*\(/,
      );
    }
  });
});
