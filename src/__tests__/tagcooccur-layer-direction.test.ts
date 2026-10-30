/**
 * tagcooccur-layer-direction.test.ts
 *
 * Layer direction pin for the tagCooccurrence relocation. src/wasm/ (the
 * Rust/WASM wrappers plus their bench and parity harnesses) and src/offscreen/
 * (the DOM/OPFS worker layer) both sit BELOW the UI, so neither tree may
 * import from src/dashboard/. Before the 2026-10-30 relocation the
 * tagCooccurrence calc layer itself lived under src/dashboard/, and
 * wasm/tag-cooccur's bench, index type imports, and parity tests
 * cross-imported it from there — the lower layer pointing UP into the
 * dashboard, the exact direction the architecture forbids.
 *
 * Task 2 moved the calc layer to src/utils/ (Layer 2), which resolves the
 * inversion: wasm and offscreen now import sideways into utils, never up into
 * dashboard. Nothing structural stops a future edit from copying the old
 * relative path back, and no runtime test would notice, so validate needs a
 * tripwire. A text pin cannot make the import illegal, so it does the things
 * that are actually checkable:
 *
 *   1. every .ts source under src/wasm/ and src/offscreen/ (their __tests__
 *      included) is scanned recursively, so a broken collector cannot pass
 *      silently, and
 *   2. no scanned line may import from under dashboard/ — static `import`,
 *      `import type`, dynamic `import()`, or `vi.mock` — and a violation is
 *      reported with its file path and line so the offending import can be
 *      identified, and
 *   3. the detector still recognizes every syntax form it exists to catch,
 *      while leaving comment mentions of the old path (JSDoc records where
 *      the layer used to live) unflagged.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, type Stats } from 'node:fs';
import { join, extname, sep } from 'node:path';

/** The two layers that sit below the UI and must never reach up into it. */
const LAYER_DIRS = ['src/wasm', 'src/offscreen'] as const;

/**
 * Static imports (plain and `import type`) and re-exports. Detection keys on
 * the string literal that follows `from '`, so a module path on the `from`
 * line of a multi-line import is still caught.
 */
const STATIC_IMPORT_RE = /from\s*(['"])([^'"]*dashboard\/[^'"]*)\1/;

/** Dynamic `import('...')`, including `await import('...')`. */
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*(['"])([^'"]*dashboard\/[^'"]*)\1/;

/** `vi.mock('...')` takes a module-path literal, same string class as a dynamic import. */
const VI_MOCK_RE = /\bvi\.mock\s*\(\s*(['"])([^'"]*dashboard\/[^'"]*)\1/;

/**
 * Comment lines carry the JSDoc that records where the calc layer used to
 * live; an executable import never starts on one of these lines.
 */
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*|\*|#|<!--)/;

/** @returns repo-relative POSIX paths of every .ts source under `dir`. */
function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st: Stats | undefined;
    try {
      st = statSync(full);
    } catch {
      continue; // broken symlink
    }
    if (st.isDirectory()) {
      collectFiles(full, acc);
    } else if (st.isFile() && extname(entry) === '.ts') {
      // POSIX separators so reported paths read the same on every platform.
      acc.push(full.split(sep).join('/'));
    }
  }
  return acc;
}

/** @returns `file:line` entries for every upward import in `lines`. */
function scanLines(lines: string[], file: string): string[] {
  const violations: string[] = [];
  for (const [i, line] of lines.entries()) {
    if (COMMENT_LINE_RE.test(line)) continue;
    const isUpwardImport =
      STATIC_IMPORT_RE.test(line) || DYNAMIC_IMPORT_RE.test(line) || VI_MOCK_RE.test(line);
    if (isUpwardImport) {
      violations.push(`${file}:${i + 1}  ${line.trim()}`);
    }
  }
  return violations;
}

function upwardImportsIn(dir: string): string[] {
  const violations: string[] = [];
  for (const file of collectFiles(dir)) {
    violations.push(...scanLines(readFileSync(file, 'utf-8').split('\n'), file));
  }
  return violations;
}

describe('tagcooccurrence layer direction', () => {
  it('scans every .ts source under the two lower layers, so a broken collector cannot pass silently', () => {
    const files = LAYER_DIRS.flatMap((dir) => collectFiles(dir));
    expect(files.length).toBeGreaterThan(100);
    // The tag-cooccur harnesses are the files this pin exists for: bench.ts
    // held the offending bench import, index.ts the type import, and the
    // parity suite its own, all pointing into dashboard/ before Task 2.
    expect(files).toContain('src/wasm/tag-cooccur/bench.ts');
    expect(files).toContain('src/wasm/tag-cooccur/index.ts');
    expect(files).toContain('src/wasm/tag-cooccur/__tests__/parity.test.ts');
    expect(files.some((f) => f.startsWith('src/offscreen/'))).toBe(true);
  });

  it('keeps wasm/ and offscreen/ free of imports into dashboard/', () => {
    const violations = LAYER_DIRS.flatMap((dir) => upwardImportsIn(dir));
    expect(
      violations,
      `upward imports from wasm/offscreen into dashboard/ — move the shared code to src/utils/ instead:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('recognizes every import syntax the pin exists to catch, and ignores comment mentions', () => {
    const samples: ReadonlyArray<{ line: string; violation: boolean }> = [
      // Static import, single quotes.
      {
        line: `import { computeTagCooccurrence } from '../../dashboard/tagCooccurrence.js';`,
        violation: true,
      },
      // Static import, double quotes.
      {
        line: `import { computeTagCooccurrence } from "../../dashboard/tagCooccurrence.js";`,
        violation: true,
      },
      // Type-only import.
      {
        line: `import type { TagNode } from '../../dashboard/tagCooccurrence.js';`,
        violation: true,
      },
      // Re-export from the dashboard layer.
      {
        line: `export { computeTagCooccurrence } from '../../dashboard/tagCooccurrence.js';`,
        violation: true,
      },
      // Dynamic import.
      {
        line: `const mod = await import('../../dashboard/tagCooccurrence.js');`,
        violation: true,
      },
      // vi.mock module path.
      {
        line: `vi.mock('../../dashboard/tagCooccurrence.js', () => ({}));`,
        violation: true,
      },
      // The relocated path is the compliant form.
      {
        line: `import { computeTagCooccurrence } from '../../utils/tagCooccurrence.js';`,
        violation: false,
      },
      // A JSDoc mention of the real production call site (a real line in
      // wasm/tag-cooccur/index.ts) must not be flagged.
      {
        line: ` * src/dashboard/panels/asyncData/tagClusterPanel.ts via`,
        violation: false,
      },
      // A comment that records the old import for history must not be flagged.
      {
        line: `// Pre-relocation: import { x } from '../../dashboard/tagCooccurrence.js';`,
        violation: false,
      },
      // dashboard/ inside a plain string with no import syntax around it.
      {
        line: `const breadcrumb = 'dashboard/index.html';`,
        violation: false,
      },
    ];

    for (const { line, violation } of samples) {
      const hits = scanLines([line], '<sample>');
      if (violation) {
        expect(hits, `must detect the upward import: ${line}`).toHaveLength(1);
      } else {
        expect(hits, `must not flag a compliant line: ${line}`).toEqual([]);
      }
    }
  });
});
