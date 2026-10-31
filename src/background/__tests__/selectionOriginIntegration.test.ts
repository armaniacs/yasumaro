/**
 * Selection-origin integration (PBI 2026-10-31-03).
 *
 * Drives the REAL RecordingOrchestrator (13 steps + save phase) with a
 * contentOrigin-carrying record request and asserts the saved SQLite row
 * carries content_origin='selection' — and that a normal page record stays
 * NULL. The wire seams (payload → validator → envelope → request builder)
 * are pinned in selectionOriginWire.test.ts / recordRequestBuilder.test.ts;
 * this file closes the chain at the store boundary.
 */
import { PerUrlMutexMap } from '../pipeline/perUrlMutex.js';
import { RecordingCache } from './helpers/recordingCache.js';
import { makeRecordingLogic } from './helpers/makeRecordingLogic.js';
import * as storageSavedUrls from '../../utils/storage/savedUrlRepository.js';
import * as domainUtils from '../../utils/domainUtils.js';
import * as privacy from '../privacyPipeline.js';
import { COLUMN_NAMES, buildInsertRecordFields } from '../../offscreen/schema.js';

const mockGetAll = vi.hoisted(() => vi.fn());
const mockSetAll = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetAll,
      setAll: mockSetAll,
      getMany: vi.fn(),
    },
    SettingsRepository: class {
      getAll = mockGetAll;
      setAll = mockSetAll;
      getMany = vi.fn();
    },
  };
});
vi.mock('../../utils/storage/savedUrlRepository.js');
vi.mock('../../utils/domainUtils.js');
vi.mock('../privacyPipeline.js');

describe('selection-origin integration (PBI 2026-10-31-03)', () => {
  const mockObsidian = {
    appendToDailyNote: vi.fn().mockResolvedValue(undefined),
  };
  const mockAiClient = {
    getSupportedModes: vi.fn().mockReturnValue(['local_only', 'full_pipeline']),
    generateSummary: vi.fn().mockResolvedValue('Cloud summary'),
  };

  function makeSqliteClient() {
    const inserts: Record<string, unknown>[] = [];
    const mutate = vi.fn(async (request: { type: string; record?: Record<string, unknown> }) => {
      if (request.type === 'insert' && request.record) {
        inserts.push(request.record);
      }
      return { success: true, data: { id: inserts.length } };
    });
    return { mutate, inserts };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    if (!chrome.notifications) {
      chrome.notifications = { create: vi.fn() } as unknown as typeof chrome.notifications;
    }
    RecordingCache.invalidatePrivacyCache();
    RecordingCache.invalidateSettingsCache();
    RecordingCache.invalidateUrlCache();

    mockGetAll.mockResolvedValue({
      privacy_mode: 'full_pipeline',
      pii_sanitize_logs: true,
      domain_whitelist: [],
      auto_save_privacy_behavior: 'save',
      content_storage_enabled: true,
    });
    // @ts-expect-error - vi.fn() type narrowing issue
    storageSavedUrls.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
    // @ts-expect-error - vi.fn() type narrowing issue
    storageSavedUrls.setSavedUrlsWithTimestamps.mockResolvedValue(undefined);
    // @ts-expect-error - vi.fn() type narrowing issue
    domainUtils.isDomainAllowed.mockResolvedValue(true);
    // @ts-expect-error - vi.fn() type narrowing issue
    privacy.PrivacyPipeline.mockImplementation(function (this: { process: unknown }) {
      this.process = vi.fn().mockResolvedValue({ summary: 'Test summary', maskedCount: 0 });
    });
  });

  it('saves a selection-origin record with content_origin="selection"', async () => {
    const sqlite = makeSqliteClient();
    const logic = makeRecordingLogic(mockObsidian, mockAiClient, sqlite);

    const result = await logic.record({
      title: 'Example',
      url: 'https://example.com/article',
      content: 'selected paragraph',
      force: true,
      contentOrigin: 'selection',
    });

    expect(result.success).toBe(true);
    expect(sqlite.inserts).toHaveLength(1);
    const record = sqlite.inserts[0] as Record<string, unknown>;
    expect(record.content_origin).toBe('selection');
    expect(record.content).toBe('selected paragraph');
  });

  it('keeps a normal page record NULL (no marker)', async () => {
    const sqlite = makeSqliteClient();
    const logic = makeRecordingLogic(mockObsidian, mockAiClient, sqlite);

    const result = await logic.record({
      title: 'Example',
      url: 'https://example.com/page',
      content: 'page body',
      force: true,
    });

    expect(result.success).toBe(true);
    expect(sqlite.inserts).toHaveLength(1);
    const record = sqlite.inserts[0] as Record<string, unknown>;
    // The mapper normalizes the marker to null (`?? null`), the same
    // semantics as navSourceUrl/searchQuery.
    expect(record.content_origin).toBeNull();
  });

  it('lands content_origin at the schema INSERT position', async () => {
    const sqlite = makeSqliteClient();
    const logic = makeRecordingLogic(mockObsidian, mockAiClient, sqlite);

    await logic.record({
      title: 'Example',
      url: 'https://example.com/article',
      content: 'selected paragraph',
      force: true,
      contentOrigin: 'selection',
    });

    const record = sqlite.inserts[0] as Record<string, unknown>;
    const fields = buildInsertRecordFields(record as never, 'example.com');
    const keys = Object.keys(fields);
    // The row codec and the INSERT statement both zip against COLUMN_NAMES —
    // a misplaced column would write the marker into a neighbor cell.
    expect(keys).toEqual([...COLUMN_NAMES]);
    expect(keys[keys.length - 1]).toBe('content_origin');
    expect(fields.content_origin).toBe('selection');
  });
});
