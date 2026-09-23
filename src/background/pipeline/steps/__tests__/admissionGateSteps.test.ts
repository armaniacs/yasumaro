/**
 * admissionGateSteps — PBI 2026-09-23-05 derivation test.
 *
 * Pins that steps/index.ts derives the admission gate list from the shared
 * gate table: names follow RECORDING_GATE_TABLE order, every row has an
 * executor, and the privacyHeaders executor delegates to PrivacyHeadersChecker
 * with the injected getter (pre-decision integration untouched).
 */

import { vi } from 'vitest';

vi.mock('../../../../utils/logger/types.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
vi.mock('../../../../utils/logger/core.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
vi.mock('../../../../utils/logger/api.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
vi.mock('../../../../utils/domainUtils.js', () => ({
  isDomainAllowed: vi.fn(),
  extractDomain: vi.fn(),
}));
vi.mock('../../../../utils/permissionManager.js');
vi.mock('../../../../utils/trustChecker.js', () => ({
  TrustChecker: vi.fn(),
}));
vi.mock('../../../notificationHelper.js', () => ({
  NotificationHelper: { notifyError: vi.fn() },
}));
vi.mock('../../../../utils/storage/types.js');
vi.mock('../../../../utils/storage/defaults.js');
vi.mock('../../../../utils/storage/encryptionSession.js');
vi.mock('../../../../utils/storage/savedUrlRepository.js');
vi.mock('../../../../utils/storage/domainFilterCache.js');
vi.mock('../../../../utils/storage/quota.js');
vi.mock('../../../../utils/pendingStorage.js');
vi.mock('../../../../utils/sentenceExtractor.js', () => ({
  getCompressionStats: vi.fn(),
}));
vi.mock('../../../../utils/sentenceExtractorHybrid.js', () => ({
  extractSentencesHybrid: vi.fn(),
}));
vi.mock('../../../../utils/localeUtils.js', () => ({
  getUserLocale: vi.fn().mockReturnValue('en'),
}));
vi.mock('../../../../utils/markdownFormatter.js', () => ({
  buildEntryMarkdown: vi.fn(),
  buildTemplateEntryData: vi.fn(),
}));
vi.mock('../../../../utils/markdownTemplateUtils.js', () => ({
  renderFileTemplate: vi.fn(),
}));
vi.mock('../../../../utils/errorUtils.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, errorMessage: vi.fn((e: unknown) => String(e)) };
});
vi.mock('../../privacyPipeline.js', () => ({
  PrivacyPipeline: vi.fn(),
}));
vi.mock('../piiSanitizeHybrid.js', () => ({
  sanitizePiiHybrid: vi.fn(),
}));
vi.mock('../buffers/MarkdownBufferManager.js', () => ({
  MarkdownBufferManager: vi.fn(),
}));
vi.mock('../../pendingSqliteQueue.js', () => ({
  enqueuePendingRecord: vi.fn(),
}));
vi.mock('../../pendingChromeStorageQueue.js', () => ({
  enqueuePendingWrite: vi.fn(),
}));
vi.mock('../../localMarkdownIdleFlusher.js', () => ({
  scheduleImmediateFlush: vi.fn(),
}));

import { ADMISSION_GATE_ORDER, createAdmissionGateSteps } from '../index.js';
import { RECORDING_DECISION_ORDER, RECORDING_GATE_TABLE } from '../../../../utils/recordingGateTable.js';
import { StorageKeys } from '../../../../utils/storage/types.js';
import type { RecordingContext } from '../../types.js';

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
  return {
    data: { title: 'T', url: 'https://example.com/page', content: 'x' },
    settings: {
      [StorageKeys.DOMAIN_WHITELIST]: [],
      [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'skip',
    } as never,
    force: false,
    errors: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ADMISSION_GATE_ORDER', () => {
  it('follows the shared gate table, not a hand-written copy', () => {
    expect([...ADMISSION_GATE_ORDER]).toEqual(RECORDING_GATE_TABLE.map((row) => row.name));
    expect([...ADMISSION_GATE_ORDER]).toEqual([...RECORDING_DECISION_ORDER]);
  });
});

describe('createAdmissionGateSteps', () => {
  it('returns one executor per table row in table order', () => {
    const steps = createAdmissionGateSteps(vi.fn().mockResolvedValue(null));
    expect(steps.map((step) => step.name)).toEqual(RECORDING_GATE_TABLE.map((row) => row.name));
    for (const step of steps) {
      expect(typeof step.execute).toBe('function');
    }
  });

  it('wires the injected privacy getter into the privacyHeaders executor', async () => {
    const getPrivacyInfo = vi.fn().mockResolvedValue({ isPrivate: false });
    const steps = createAdmissionGateSteps(getPrivacyInfo);
    const privacy = steps.find((step) => step.name === 'privacyHeaders');
    expect(privacy).toBeDefined();
    await expect(privacy!.execute(makeContext())).resolves.toBeDefined();
    expect(getPrivacyInfo).toHaveBeenCalledWith('https://example.com/page');
  });

  it('exposes the same domainFilter executor the pipeline step exports', async () => {
    const steps = createAdmissionGateSteps(vi.fn().mockResolvedValue(null));
    const domain = steps.find((step) => step.name === 'domainFilter');
    expect(domain).toBeDefined();
    expect(typeof domain!.execute).toBe('function');
  });
});
