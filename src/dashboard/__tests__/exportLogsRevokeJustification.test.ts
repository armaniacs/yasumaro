// @vitest-environment jsdom
/**
 * Pins the revoke-URL decision across the three download sites.
 *
 * downloadBlob's anchor-click path (a.click() + download attribute) is
 * fire-and-forget: the page gets no promise or event for the download, so
 * there is no settle point to revoke on and the site keeps a bounded 60s
 * timer instead. The chrome.downloads.download sites
 * (generalSettings/connectionTests.ts, markdownExport.ts) revoke on settle
 * because their promise resolves once the blob fetch has started. This suite
 * pins (1) that the WHY stays codified at all three sites, so the timer
 * cannot be deleted quietly or a timer re-introduced where a settle point
 * exists, (2) that the timer path revokes exactly once, after the delay, and
 * (3) that the other anchor-click sites (encryptedBackupPanel, ublockImport)
 * stay unified on downloadBlob instead of re-adding a local sync revoke.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { downloadBlob, DOWNLOAD_REVOKE_DELAY_MS } from '../exportLogsService.js';
import { useTimerClock } from '../../../testDir/waitPolicy.js';

// vitest.setup.ts stubs import.meta, so import.meta.url is unavailable; the
// vitest config sets test.root to the repo, which is also process.cwd().
const REPO_ROOT = process.cwd();

/**
 * One rationale, three sites: exportLogsService carries the timer-side WHY,
 * the other two carry the settle-side WHY and name exportLogsService's
 * constraint. Rewording or deleting a WHY is a deliberate change that must
 * update this table with evidence.
 */
const WHY_SITES = [
  {
    file: 'src/dashboard/exportLogsService.ts',
    markers: [
      'fire-and-forget',
      'no settle point to revoke on',
      '60s is a deliberate upper bound',
      'releasing the object URL instead of leaking it',
    ],
  },
  {
    file: 'src/dashboard/generalSettings/connectionTests.ts',
    markers: [
      'Revoke on settle, not on a delay',
      'keeps a blob alive for fetches in progress',
      'leaked on every failure path',
    ],
  },
  {
    file: 'src/dashboard/markdownExport.ts',
    markers: [
      'WHY settle-driven instead of a fixed timer',
      'exportLogsService keeps a 60s timer only because its anchor-click path has no completion signal to await',
    ],
  },
];

/**
 * Strips line-comment prefixes and collapses whitespace so a marker matches
 * regardless of how its sentence wraps across comment lines.
 */
function normalizedSource(relativePath: string): string {
  const raw = readFileSync(join(REPO_ROOT, relativePath), 'utf-8');
  return raw
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/\s?/, '').replace(/^\s*\*{1,2}\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');
}

describe('revoke justification codified at all three download sites', () => {
  it.each(WHY_SITES)('$file states the revoke WHY', ({ file, markers }) => {
    const source = normalizedSource(file);
    for (const marker of markers) {
      expect(source, `${file} must keep the WHY marker: "${marker}"`).toContain(marker);
    }
  });
});

/**
 * Anchor-click sites unified on the SSOT helper: each must import
 * downloadBlob from exportLogsService and must not carry a local
 * revokeObjectURL — a synchronous revoke kills a download before the browser
 * persists it (PBI 2026-10-03-19). markdownExport.ts and
 * generalSettings/connectionTests.ts are settle-driven chrome.downloads paths
 * with a different completion signal; they are intentionally out of scope.
 */
const UNIFIED_ANCHOR_SITES = [
  {
    file: 'src/dashboard/encryptedBackupPanel.ts',
    importLine: "import { downloadBlob } from './exportLogsService.js';",
  },
  {
    file: 'src/dashboard/settings/ublockImport/index.ts',
    importLine: "import { downloadBlob } from '../../exportLogsService.js';",
  },
];

describe('anchor-click download sites unified on exportLogsService.downloadBlob', () => {
  it.each(UNIFIED_ANCHOR_SITES)('$file delegates to downloadBlob with no local revoke', ({ file, importLine }) => {
    const raw = readFileSync(join(REPO_ROOT, file), 'utf-8');
    expect(raw, `${file} must delegate to the SSOT downloadBlob`).toContain(importLine);
    expect(raw).toContain('downloadBlob(');
    expect(raw, `${file} must keep no local revokeObjectURL`).not.toMatch(/revokeObjectURL/);
  });
});

describe('downloadBlob revoke timing (anchor-click path)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('revokes exactly once, after the delay — never synchronously', () => {
    useTimerClock();
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:revoke-justification');
    vi.spyOn(document.body, 'appendChild').mockImplementation((n) => n);
    vi.spyOn(document.body, 'removeChild').mockImplementation((n) => n);

    downloadBlob(new Blob(['x'], { type: 'application/octet-stream' }), 'log.db');

    // A synchronous revoke can abort the download before the browser
    // persists the blob.
    expect(revokeSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DOWNLOAD_REVOKE_DELAY_MS - 1);
    expect(revokeSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith('blob:revoke-justification');
  });

  it('keeps the revoke delay at the codified 60s floor', () => {
    // The user story is about downloads that outlast the delay: a smaller
    // bound revokes ahead of slow environments again. Shrinking it must
    // update this pin with evidence; raising it is a deliberate change.
    expect(DOWNLOAD_REVOKE_DELAY_MS).toBeGreaterThanOrEqual(60_000);
  });
});
