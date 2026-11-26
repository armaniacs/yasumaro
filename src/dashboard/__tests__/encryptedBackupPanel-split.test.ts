// @vitest-environment wasm-quickjs-dom
/**
 * encryptedBackupPanel-split.test.ts (PBI 2026-11-23-02)
 *
 * Outside-In failure tests for split-backup panel I/O: the manifest plus its
 * parts are selected together, the panel reads the manifest first, and only
 * a complete set reaches the password prompt. Missing parts, order errors and
 * over-limit selections each get a cause-identifying message before any KDF
 * work starts. The single-envelope path is pinned unchanged.
 *
 * No real crypto runs here: the service module is mocked (shape-level fake
 * envelopes only), the limits registry is shrunk via module mock so the size
 * gates need no multi-megabyte allocations, and waiting uses waitForMock /
 * drainMacrotask (never fixed sleeps).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../encryptedBackupService.js', () => ({
  exportEncryptedBackup: vi.fn(),
  importEncryptedBackup: vi.fn(),
  exportEncryptedSplitBackup: vi.fn(),
  importEncryptedSplitBackup: vi.fn(),
  isEncryptedBackupFile: vi.fn(),
  isEncryptedSplitBackupFile: vi.fn(),
}));

vi.mock('../masterPassword.js', () => ({
  showPasswordAuthModal: vi.fn(),
  setPasswordAuthProgress: vi.fn(),
}));

vi.mock('../../utils/limits.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/limits.js')>();
  return {
    ...actual,
    MAX_BACKUP_FILE_BYTES: 5_000,
    MAX_BACKUP_ENVELOPE_BASE64_LENGTH: 100,
    MAX_ENVELOPE_BASE64_LENGTH: 60,
  };
});

import {
  exportEncryptedBackup,
  importEncryptedBackup,
  exportEncryptedSplitBackup,
  importEncryptedSplitBackup,
  isEncryptedBackupFile,
  isEncryptedSplitBackupFile,
} from '../encryptedBackupService.js';
import { showPasswordAuthModal } from '../masterPassword.js';
import {
  initEncryptedBackupPanel,
  isSplitManifestFile,
  isSplitPartFile,
  findMissingPartIndices,
  buildSplitDownloadNames,
  MAX_SPLIT_PART_COUNT_FOR_PANEL,
} from '../encryptedBackupPanel.js';
import { SplitBackupError } from '../encryptedBackupSplitCodec.js';
import { waitForMock, drainMacrotask } from '../../../testDir/waitPolicy.js';

function setDom(): void {
  document.body.innerHTML = `
    <button id="exportEncryptedBackupBtn"></button>
    <button id="importEncryptedBackupBtn"></button>
    <input type="file" id="importEncryptedBackupFileInput" />
    <div id="encryptedBackupStatus"></div>
    <div id="passwordAuthProgress" role="status" aria-live="polite"></div>
  `;
}

function fakeEnvelope(data: string): Record<string, unknown> {
  return {
    version: 2,
    kdf: 'pbkdf2',
    hash: 'SHA-256',
    iterations: 600000,
    salt: 's',
    iv: 'i',
    data,
  };
}

function manifestFileJson(total: number, dataChars = 'm'): string {
  return JSON.stringify({
    kind: 'yasumaro-split-backup-manifest',
    formatVersion: 1,
    total,
    manifest: fakeEnvelope(dataChars),
  });
}

function partFileJson(index: number, total: number, dataChars = 'p'): string {
  return JSON.stringify({
    kind: 'yasumaro-split-backup-part',
    formatVersion: 1,
    index,
    total,
    part: fakeEnvelope(dataChars),
  });
}

function selectFiles(contents: string[]): void {
  const fileInput = document.getElementById('importEncryptedBackupFileInput') as HTMLInputElement;
  const files = contents.map((content, i) => new File([content], `pick-${i}.json`, { type: 'application/json' }));
  Object.defineProperty(fileInput, 'files', { value: files, configurable: true });
  fileInput.dispatchEvent(new Event('change'));
}

function selectTrackedFiles(contents: string[]): { textSpies: ReturnType<typeof vi.fn>[] } {
  const fileInput = document.getElementById('importEncryptedBackupFileInput') as HTMLInputElement;
  const textSpies = contents.map((content) => vi.fn(async () => content));
  const files = contents.map((content, i) => ({ size: content.length, text: textSpies[i]!, name: `pick-${i}.json` }));
  Object.defineProperty(fileInput, 'files', { value: files, configurable: true });
  fileInput.dispatchEvent(new Event('change'));
  return { textSpies };
}

function statusText(): string {
  return document.getElementById('encryptedBackupStatus')!.textContent ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  setDom();
});

describe('encryptedBackupPanel split import (Outside-In)', () => {
  it('restores from a manifest selected together with all parts, parts reordered by index', async () => {
    vi.mocked(isEncryptedBackupFile).mockReturnValue(false);
    vi.mocked(isEncryptedSplitBackupFile).mockReturnValue(false);
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, action) => {
      void action('correct-password').catch(() => {});
    });
    vi.mocked(importEncryptedSplitBackup).mockResolvedValue({ success: true, skippedKeys: [] });

    initEncryptedBackupPanel();
    // Parts arrive out of order; the manifest is read first and the container
    // handed to the service must be index-ordered.
    selectFiles([manifestFileJson(2), partFileJson(1, 2, 'p1'), partFileJson(0, 2, 'p0')]);

    await waitForMock(() => expect(importEncryptedSplitBackup).toHaveBeenCalledTimes(1));
    expect(showPasswordAuthModal).toHaveBeenCalledWith('import', expect.any(Function));
    const container = vi.mocked(importEncryptedSplitBackup).mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(container['kind']).toBe('encrypted-split-backup');
    const parts = container['parts'] as Record<string, unknown>[];
    expect(parts).toHaveLength(2);
    expect((parts[0]!['data'] as string)).toBe('p0');
    expect((parts[1]!['data'] as string)).toBe('p1');
    expect(container['manifest']).toMatchObject({ data: 'm' });

    await waitForMock(() => expect(statusText()).toBe('Restored from backup'));
    expect(importEncryptedBackup).not.toHaveBeenCalled();
  });

  it('reports the missing part numbers before asking for a password', async () => {
    vi.mocked(isEncryptedBackupFile).mockReturnValue(false);
    vi.mocked(isEncryptedSplitBackupFile).mockReturnValue(false);

    initEncryptedBackupPanel();
    selectFiles([manifestFileJson(3), partFileJson(0, 3), partFileJson(2, 3)]);

    await waitForMock(() => expect(statusText()).toContain('1'));
    expect(statusText()).toContain('missing part');
    expect(showPasswordAuthModal).not.toHaveBeenCalled();
    expect(importEncryptedSplitBackup).not.toHaveBeenCalled();
  });

  it('distinguishes an order error from a missing part when two parts share an index', async () => {
    vi.mocked(isEncryptedBackupFile).mockReturnValue(false);
    vi.mocked(isEncryptedSplitBackupFile).mockReturnValue(false);

    initEncryptedBackupPanel();
    selectFiles([manifestFileJson(2), partFileJson(0, 2, 'a'), partFileJson(0, 2, 'b')]);

    await waitForMock(() => expect(statusText()).toContain('inconsistent'));
    expect(statusText()).not.toContain('missing part');
    expect(showPasswordAuthModal).not.toHaveBeenCalled();
    expect(importEncryptedSplitBackup).not.toHaveBeenCalled();
  });

  it('distinguishes the over-limit case when the manifest declares more parts than allowed', async () => {
    vi.mocked(isEncryptedBackupFile).mockReturnValue(false);
    vi.mocked(isEncryptedSplitBackupFile).mockReturnValue(false);
    expect(MAX_SPLIT_PART_COUNT_FOR_PANEL).toBeGreaterThan(0);

    initEncryptedBackupPanel();
    selectFiles([manifestFileJson(MAX_SPLIT_PART_COUNT_FOR_PANEL + 1)]);

    await waitForMock(() => expect(statusText()).toContain('size limit'));
    expect(showPasswordAuthModal).not.toHaveBeenCalled();
    expect(importEncryptedSplitBackup).not.toHaveBeenCalled();
  });

  it('asks for the manifest when only part files are selected', async () => {
    vi.mocked(isEncryptedBackupFile).mockReturnValue(false);
    vi.mocked(isEncryptedSplitBackupFile).mockReturnValue(false);

    initEncryptedBackupPanel();
    selectFiles([partFileJson(0, 2), partFileJson(1, 2)]);

    await waitForMock(() => expect(statusText()).toContain('manifest'));
    expect(showPasswordAuthModal).not.toHaveBeenCalled();
    expect(importEncryptedSplitBackup).not.toHaveBeenCalled();
  });

  it('rejects an over-cap part envelope before the password prompt', async () => {
    vi.mocked(isEncryptedBackupFile).mockReturnValue(false);
    vi.mocked(isEncryptedSplitBackupFile).mockReturnValue(false);

    initEncryptedBackupPanel();
    // Mocked generic cap is 60 chars; 61 trips the pre-decrypt length gate.
    selectFiles([manifestFileJson(1), partFileJson(0, 1, 'x'.repeat(61))]);

    await waitForMock(() => expect(statusText()).toContain('size limit'));
    expect(showPasswordAuthModal).not.toHaveBeenCalled();
    expect(importEncryptedSplitBackup).not.toHaveBeenCalled();
  });

  it('stops reading further files once a part exceeds the generic cap (sequential read)', async () => {
    vi.mocked(isEncryptedBackupFile).mockReturnValue(false);
    vi.mocked(isEncryptedSplitBackupFile).mockReturnValue(false);

    initEncryptedBackupPanel();
    // Mocked generic cap is 60 chars; the part at position 1 trips the
    // pre-decrypt length gate, so the file after it must never be read.
    const { textSpies } = selectTrackedFiles([
      manifestFileJson(3),
      partFileJson(0, 3),
      partFileJson(1, 3, 'x'.repeat(61)),
      partFileJson(2, 3),
    ]);

    await waitForMock(() => expect(statusText()).toContain('size limit'));
    expect(showPasswordAuthModal).not.toHaveBeenCalled();
    expect(importEncryptedSplitBackup).not.toHaveBeenCalled();
    await drainMacrotask();
    expect(textSpies[3]).not.toHaveBeenCalled();
  });

  it('stops reading part files once the manifest declares more parts than allowed', async () => {
    vi.mocked(isEncryptedBackupFile).mockReturnValue(false);
    vi.mocked(isEncryptedSplitBackupFile).mockReturnValue(false);
    expect(MAX_SPLIT_PART_COUNT_FOR_PANEL).toBeGreaterThan(0);

    initEncryptedBackupPanel();
    const { textSpies } = selectTrackedFiles([
      manifestFileJson(MAX_SPLIT_PART_COUNT_FOR_PANEL + 1),
      partFileJson(0, MAX_SPLIT_PART_COUNT_FOR_PANEL + 1),
    ]);

    await waitForMock(() => expect(statusText()).toContain('size limit'));
    expect(showPasswordAuthModal).not.toHaveBeenCalled();
    expect(importEncryptedSplitBackup).not.toHaveBeenCalled();
    await drainMacrotask();
    expect(textSpies[1]).not.toHaveBeenCalled();
  });

  it('keeps a tampered part rejected with the restore failure shown', async () => {
    vi.mocked(isEncryptedBackupFile).mockReturnValue(false);
    vi.mocked(isEncryptedSplitBackupFile).mockReturnValue(false);
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, action) => {
      void action('correct-password').catch(() => {});
    });
    vi.mocked(importEncryptedSplitBackup).mockResolvedValue({
      success: false,
      error: 'Decryption failed: Split backup part 1 failed authentication',
    });

    initEncryptedBackupPanel();
    selectFiles([manifestFileJson(2), partFileJson(0, 2), partFileJson(1, 2, 'tampered')]);

    await waitForMock(() => expect(importEncryptedSplitBackup).toHaveBeenCalledTimes(1));
    await waitForMock(() => expect(statusText()).toContain('failed authentication'));
  });

  it('treats a lone manifest wrapper as incomplete, never as a single backup', async () => {
    vi.mocked(isEncryptedBackupFile).mockReturnValue(false);
    vi.mocked(isEncryptedSplitBackupFile).mockReturnValue(false);

    initEncryptedBackupPanel();
    selectFiles([manifestFileJson(2)]);

    await waitForMock(() => expect(statusText()).toContain('missing part'));
    expect(importEncryptedBackup).not.toHaveBeenCalled();
    expect(showPasswordAuthModal).not.toHaveBeenCalled();
  });
});

describe('encryptedBackupPanel single path pin', () => {
  it('routes a single envelope to the single import and never touches the split import', async () => {
    vi.mocked(isEncryptedBackupFile).mockReturnValue(true);
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, action) => {
      void action('correct-password').catch(() => {});
    });
    vi.mocked(importEncryptedBackup).mockResolvedValue({ success: true, skippedKeys: [] });

    initEncryptedBackupPanel();
    selectFiles([JSON.stringify(fakeEnvelope('d'))]);

    await waitForMock(() => expect(isEncryptedBackupFile).toHaveBeenCalledTimes(1));
    await waitForMock(() => expect(importEncryptedBackup).toHaveBeenCalledTimes(1));
    expect(vi.mocked(importEncryptedBackup).mock.calls[0]![0]).toMatchObject({ data: 'd' });
    await drainMacrotask();
    expect(importEncryptedSplitBackup).not.toHaveBeenCalled();
    expect(exportEncryptedSplitBackup).not.toHaveBeenCalled();
  });
});

describe('encryptedBackupPanel split export', () => {
  it('downloads the manifest and every part with a shared filename stem when the envelope exceeds the cap', async () => {
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, action) => {
      void action('my-password');
    });
    // Mocked backup cap is 100 chars; 101 forces the split export.
    vi.mocked(exportEncryptedBackup).mockResolvedValue(fakeEnvelope('x'.repeat(101)) as never);
    vi.mocked(exportEncryptedSplitBackup).mockResolvedValue({
      kind: 'encrypted-split-backup',
      formatVersion: 1,
      manifest: fakeEnvelope('m'),
      parts: [fakeEnvelope('p0'), fakeEnvelope('p1')],
    } as never);
    const downloaded: string[] = [];
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      if (node instanceof HTMLAnchorElement) downloaded.push(node.download);
      return node;
    });
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

    try {
      initEncryptedBackupPanel();
      document.getElementById('exportEncryptedBackupBtn')!.dispatchEvent(new Event('click'));

      await waitForMock(() => expect(exportEncryptedSplitBackup).toHaveBeenCalledTimes(1));
      await waitForMock(() => expect(downloaded).toHaveLength(3));

      const [manifestName, ...partNames] = downloaded;
      expect(manifestName).toMatch(/\.manifest\.encrypted\.json$/);
      const stem = manifestName!.replace(/\.manifest\.encrypted\.json$/, '');
      expect(partNames).toHaveLength(2);
      expect(partNames[0]).toBe(`${stem}.part-0-of-2.encrypted.json`);
      expect(partNames[1]).toBe(`${stem}.part-1-of-2.encrypted.json`);
      await waitForMock(() => expect(statusText()).toContain('split backup'));
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('never claims split export success; it prompts download verification (browsers may block multi-downloads)', async () => {
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, action) => {
      void action('my-password');
    });
    vi.mocked(exportEncryptedBackup).mockResolvedValue(fakeEnvelope('x'.repeat(101)) as never);
    vi.mocked(exportEncryptedSplitBackup).mockResolvedValue({
      kind: 'encrypted-split-backup',
      formatVersion: 1,
      manifest: fakeEnvelope('m'),
      parts: [fakeEnvelope('p0'), fakeEnvelope('p1')],
    } as never);
    const downloaded: string[] = [];
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      if (node instanceof HTMLAnchorElement) downloaded.push(node.download);
      return node;
    });
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

    try {
      initEncryptedBackupPanel();
      document.getElementById('exportEncryptedBackupBtn')!.dispatchEvent(new Event('click'));

      await waitForMock(() => expect(exportEncryptedSplitBackup).toHaveBeenCalledTimes(1));
      await waitForMock(() => expect(downloaded).toHaveLength(3));
      await waitForMock(() => expect(statusText().length).toBeGreaterThan(0));

      // Anchor clicks are fire-and-forget: completion is unobservable, and the
      // browser may suppress all but the first download. The panel must not
      // assert completion ('created'); it must ask the user to confirm.
      expect(statusText()).not.toContain('created');
      expect(statusText()).toContain('split backup');
      expect(statusText()).toMatch(/confirm|verify|check/i);
      expect(statusText()).toMatch(/block/i);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('shows the restorable-limit guidance when split export hits the joined-length gate', async () => {
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, action) => {
      action('my-password').then(
        () => {},
        () => {},
      );
    });
    // Mocked backup cap is 100 chars; 101 forces the split export.
    vi.mocked(exportEncryptedBackup).mockResolvedValue(fakeEnvelope('x'.repeat(101)) as never);
    // The gate error carries the budget detail so the panel can render the
    // oversize amount and the limit (Phase 5 integration: the localized
    // template takes {size}/{limit}).
    vi.mocked(exportEncryptedSplitBackup).mockRejectedValue(
      new SplitBackupError(
        'split-backup-too-large',
        'Split backup joined body exceeds the backup file budget (60000000 chars)',
        undefined,
        { joinedBodyChars: 60_000_000, capChars: 52_428_800 },
      ),
    );
    const downloaded: string[] = [];
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      if (node instanceof HTMLAnchorElement) downloaded.push(node.download);
      return node;
    });
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

    try {
      initEncryptedBackupPanel();
      document.getElementById('exportEncryptedBackupBtn')!.dispatchEvent(new Event('click'));

      await waitForMock(() =>
        expect(statusText()).toBe(
          'This history DB exceeds the restorable limit even in split form (joined size ~43 MB, limit 38 MB). Organize your history and try again.',
        ),
      );
      // A rejected creation must not download any manifest or part file.
      expect(downloaded).toHaveLength(0);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('keeps the generic create-failed message for other split export errors', async () => {
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, action) => {
      action('my-password').then(
        () => {},
        () => {},
      );
    });
    vi.mocked(exportEncryptedBackup).mockResolvedValue(fakeEnvelope('x'.repeat(101)) as never);
    vi.mocked(exportEncryptedSplitBackup).mockRejectedValue(
      new SplitBackupError('too-many-parts', 'Split backup needs 17 parts, above the cap of 16'),
    );

    initEncryptedBackupPanel();
    document.getElementById('exportEncryptedBackupBtn')!.dispatchEvent(new Event('click'));

    await waitForMock(() =>
      expect(statusText()).toBe(
        'Failed to create backup: Split backup needs 17 parts, above the cap of 16',
      ),
    );
  });

  it('keeps a within-cap export as a single download', async () => {
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, action) => {
      void action('my-password');
    });
    vi.mocked(exportEncryptedBackup).mockResolvedValue(fakeEnvelope('ok') as never);
    const downloaded: string[] = [];
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      if (node instanceof HTMLAnchorElement) downloaded.push(node.download);
      return node;
    });
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

    try {
      initEncryptedBackupPanel();
      document.getElementById('exportEncryptedBackupBtn')!.dispatchEvent(new Event('click'));

      await waitForMock(() => expect(exportEncryptedBackup).toHaveBeenCalledTimes(1));
      await waitForMock(() => expect(downloaded).toHaveLength(1));
      await drainMacrotask();
      expect(exportEncryptedSplitBackup).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('encryptedBackupPanel split pure helpers', () => {
  describe('isSplitManifestFile', () => {
    it('accepts a manifest wrapper and rejects single envelopes and junk', () => {
      expect(isSplitManifestFile(JSON.parse(manifestFileJson(2)))).toBe(true);
      expect(isSplitManifestFile(fakeEnvelope('d'))).toBe(false);
      expect(isSplitManifestFile(JSON.parse(partFileJson(0, 2)))).toBe(false);
      expect(isSplitManifestFile(null)).toBe(false);
      expect(isSplitManifestFile({ kind: 'yasumaro-split-backup-manifest' })).toBe(false);
    });
  });

  describe('isSplitPartFile', () => {
    it('accepts a part wrapper and rejects single envelopes and junk', () => {
      expect(isSplitPartFile(JSON.parse(partFileJson(0, 2)))).toBe(true);
      expect(isSplitPartFile(fakeEnvelope('d'))).toBe(false);
      expect(isSplitPartFile(JSON.parse(manifestFileJson(2)))).toBe(false);
      expect(isSplitPartFile(null)).toBe(false);
      expect(isSplitPartFile({ kind: 'yasumaro-split-backup-part', index: 0 })).toBe(false);
    });
  });

  describe('findMissingPartIndices', () => {
    it('lists every absent index at the boundaries', () => {
      expect(findMissingPartIndices([], 3)).toEqual([0, 1, 2]);
      expect(findMissingPartIndices([0, 1, 2], 3)).toEqual([]);
      expect(findMissingPartIndices([2, 0], 3)).toEqual([1]);
      expect(findMissingPartIndices([0, 0, 2], 3)).toEqual([1]);
      expect(findMissingPartIndices([0], 1)).toEqual([]);
    });
  });

  describe('buildSplitDownloadNames', () => {
    it('unifies the manifest and part names on one stem', () => {
      const names = buildSplitDownloadNames('yasumaro-backup-20261123-120000.encrypted.json', 2);
      expect(names.manifestName).toBe('yasumaro-backup-20261123-120000.manifest.encrypted.json');
      expect(names.partNames).toEqual([
        'yasumaro-backup-20261123-120000.part-0-of-2.encrypted.json',
        'yasumaro-backup-20261123-120000.part-1-of-2.encrypted.json',
      ]);
    });
  });
});
