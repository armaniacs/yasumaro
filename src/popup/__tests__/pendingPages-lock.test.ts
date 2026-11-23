// @vitest-environment wasm-quickjs-dom
/**
 * pendingPages-lock.test.ts
 * PBI 2026-11-23-03: ロック中の保留分記録追加の抑止。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIsLocked = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const mockGetPendingPages = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockRemovePendingPages = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRecordPendingPage = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true }));
const mockShowError = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage/authGuard.js', () => ({
  isLocked: mockIsLocked,
}));

vi.mock('../../utils/pendingStorage.js', () => ({
  getPendingPages: (...args: unknown[]) => mockGetPendingPages(...args),
  removePendingPages: (...args: unknown[]) => mockRemovePendingPages(...args),
}));

vi.mock('../../messaging/pendingRecordGateway.js', () => ({
  recordPendingPage: (...args: unknown[]) => mockRecordPendingPage(...args),
}));

vi.mock('../errorUtils.js', () => ({
  showSuccess: vi.fn(),
  showError: (...args: unknown[]) => mockShowError(...args),
}));

vi.mock('../../utils/i18n.js', async () => {
  const { mockGetMessage: i18nMock } = await import('../../../testDir/i18nMock.js');
  return i18nMock(vi.fn((key: string) => key));
});

import { saveSelectedPages } from '../pendingPages.js';

beforeEach(() => {
  document.body.innerHTML = `
    <div id="mainStatus"></div>
    <div id="pending-pages-list"></div>
    <input type="checkbox" class="pending-checkbox" value="https://example.com" checked />
  `;
  vi.clearAllMocks();
  mockIsLocked.mockResolvedValue(true);
  mockGetPendingPages.mockResolvedValue([{ url: 'https://example.com', title: 'Example' }]);
});

describe('saveSelectedPages (locked)', () => {
  it('記録も削除も行わず案内を表示する', async () => {
    await saveSelectedPages();

    expect(mockRecordPendingPage).not.toHaveBeenCalled();
    expect(mockRemovePendingPages).not.toHaveBeenCalled();
    expect(mockShowError).toHaveBeenCalled();
  });
});
