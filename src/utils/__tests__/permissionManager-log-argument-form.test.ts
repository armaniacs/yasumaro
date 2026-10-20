/**
 * permissionManager-log-argument-form.test.ts
 * Pins the canonical log argument form for PermissionManager (PBI 2026-10-20-01).
 *
 * logWarn/logError/logInfo signature: (message, details, errorCode?, source?).
 * Canonical form: message = human-readable description, source = module name.
 * These calls previously shipped the module name in message and the
 * description in source (swapped), which broke diagnostics-panel search and
 * ErrorCode aggregation on the message side. This test mocks the logger API
 * and asserts the canonical form on PermissionManager failure paths.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../logger/api.js', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
  logSanitize: vi.fn(),
  logCritical: vi.fn(),
}));

import { logWarn } from '../logger/api.js';
import { PermissionManager } from '../permissionManager.js';
import { InMemoryStoragePort } from '../storage/storagePort.js';

type PermissionsStub = { contains: Mock; request: Mock };

function chromePermissions(): PermissionsStub {
  return (globalThis as unknown as { chrome: { permissions: PermissionsStub } }).chrome.permissions;
}

describe('PermissionManager - canonical log argument form (PBI 2026-10-20-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs the description in message and the module name in source on failure paths', async () => {
    const manager = new PermissionManager(new InMemoryStoragePort());

    // isHostPermitted: chrome.permissions.contains rejects
    (chromePermissions().contains as Mock).mockRejectedValueOnce(new Error('permissions API error'));
    await manager.isHostPermitted('https://example.com/path');
    expect(logWarn).toHaveBeenCalledWith(
      'Failed to check host permission',
      expect.objectContaining({ url: 'https://example.com/path' }),
      undefined,
      'PermissionManager'
    );

    // requestPermission: chrome.permissions.request rejects
    (chromePermissions().request as Mock).mockRejectedValueOnce(new Error('request API error'));
    await manager.requestPermission('https://example.com/path');
    expect(logWarn).toHaveBeenLastCalledWith(
      'Failed to request permission',
      expect.objectContaining({ url: 'https://example.com/path' }),
      undefined,
      'PermissionManager'
    );

    // recordDeniedVisit: invalid domain rejected
    await manager.recordDeniedVisit('exa_mple.com');
    expect(logWarn).toHaveBeenLastCalledWith(
      'Invalid domain rejected',
      expect.objectContaining({ domain: 'exa_mple.com' }),
      undefined,
      'PermissionManager'
    );

    // recordDeniedVisit: storage read rejects (non-conflict errors are not retried)
    const getSpy = vi.spyOn(InMemoryStoragePort.prototype, 'get').mockRejectedValue(new Error('Storage unavailable'));
    try {
      await manager.recordDeniedVisit('example.com');
      expect(logWarn).toHaveBeenLastCalledWith(
        'Failed to record denied visit',
        expect.objectContaining({ domain: 'example.com' }),
        undefined,
        'PermissionManager'
      );
    } finally {
      getSpy.mockRestore();
    }

    // The module name must never travel in the message slot; source is last.
    for (const call of (logWarn as Mock).mock.calls) {
      expect(call[0]).not.toBe('PermissionManager');
      expect(call[call.length - 1]).toBe('PermissionManager');
    }
  });
});
