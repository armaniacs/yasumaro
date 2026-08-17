/**
 * resultBuilder.test.ts
 * buildErrorResult/buildResult/buildPrivatePageResult are pure result
 * construction — no chrome.notifications side effect required to test them.
 * notifyRecordingError/notifyObsidianSaveSuccess are the separate notification
 * functions the pipeline orchestrator calls explicitly.
 */
import { vi } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001' },
}));
vi.mock('../../../utils/pendingStorage.js', () => ({
  addPendingPage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../notificationHelper.js', () => ({
  NotificationHelper: { notifySuccess: vi.fn() },
}));

import { buildErrorResult, buildResult, buildPrivatePageResult, notifyRecordingError, notifyObsidianSaveSuccess } from '../resultBuilder.js';
import { addPendingPage } from '../../../utils/pendingStorage.js';
import { NotificationHelper } from '../../notificationHelper.js';
import { PrivatePageError } from '../steps/checkPrivacyHeadersStep.js';
import type { RecordingContext } from '../types.js';

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
  return {
    data: { title: 'Test Page', url: 'https://example.com', content: 'content' },
    settings: {} as any,
    force: false,
    errors: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildErrorResult', () => {
  it('does not touch chrome.notifications (no global chrome mock required)', () => {
    // No globalThis.chrome is installed in this file at all — if
    // buildErrorResult referenced chrome.notifications, this would throw.
    const context = makeContext();
    const result = buildErrorResult(context, new Error('boom'), 'formatMarkdown');

    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
    expect(result.title).toBe('Test Page');
    expect(result.url).toBe('https://example.com');
  });

  it('queues a pending-page recovery entry with reason=pipeline-error', () => {
    const context = makeContext();
    buildErrorResult(context, new Error('network down'), 'saveObsidian');

    expect(addPendingPage).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com',
        title: 'Test Page',
        reason: 'pipeline-error',
        errorMessage: 'network down',
      })
    );
  });
});

describe('buildPrivatePageResult', () => {
  it('builds a failure result without any notification side effect', () => {
    const context = makeContext();
    const error = new PrivatePageError('Private page detected', { reason: 'cache-control' });
    const result = buildPrivatePageResult(context, error);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('cache-control');
    expect(NotificationHelper.notifySuccess).not.toHaveBeenCalled();
  });
});

describe('buildResult', () => {
  it('builds a success result without any notification side effect', () => {
    const context = makeContext();
    const result = buildResult(context);

    expect(result.success).toBe(true);
    expect(result.title).toBe('Test Page');
    expect(NotificationHelper.notifySuccess).not.toHaveBeenCalled();
  });

  it('queues a pending-page recovery entry when an obsidian_sync error is recorded', () => {
    const context = makeContext({
      errors: [{
        step: 'saveObsidian',
        error: new Error('obsidian unreachable'),
        strategy: 'BEST_EFFORT' as never,
        timestamp: Date.now(),
        recoveryKind: 'obsidian_sync',
        context: { url: 'https://example.com' },
      }],
    });

    buildResult(context);

    expect(addPendingPage).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'obsidian-write-failed', errorMessage: 'obsidian unreachable' })
    );
  });
});

describe('notifyRecordingError', () => {
  it('creates a chrome notification with the failure message', () => {
    const create = vi.fn();
    (globalThis as unknown as { chrome: unknown }).chrome = {
      notifications: { create },
      i18n: { getMessage: vi.fn().mockReturnValue('') },
    };

    notifyRecordingError('Test Page', 'boom');

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Failed to record Test Page: boom',
    }));
  });
});

describe('notifyObsidianSaveSuccess', () => {
  it('delegates to NotificationHelper.notifySuccess', () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      i18n: { getMessage: vi.fn().mockReturnValue('') },
    };

    notifyObsidianSaveSuccess('Test Page');

    expect(NotificationHelper.notifySuccess).toHaveBeenCalledWith(
      expect.any(String),
      'Saved: Test Page'
    );
  });
});
