// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForMock } from '../../../testDir/waitPolicy.js';

const { mockGetCurrentTab, mockCheckPageStatus, mockGetAll, mockSetAll } = vi.hoisted(() => ({
  mockGetCurrentTab: vi.fn(),
  mockCheckPageStatus: vi.fn(),
  mockGetAll: vi.fn(),
  mockSetAll: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../tabUtils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tabUtils.js')>();
  return {
    ...actual,
    getCurrentTab: mockGetCurrentTab,
    getActiveTabUrl: async () => (await mockGetCurrentTab())?.url ?? null,
  };
});

vi.mock('../statusChecker.js', () => ({ checkPageStatus: mockCheckPageStatus }));

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: { getAll: mockGetAll, setAll: mockSetAll },
  };
});

vi.mock('../../utils/permissionManager.js', () => ({
  isAllUrlsPermitted: vi.fn().mockResolvedValue(true),
  isHostPermitted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn(),
  recordDeniedVisit: vi.fn(),
  requestAllUrls: vi.fn(),
}));

vi.mock('../../utils/trustChecker.js', () => ({
  getTrustLevelDisplay: vi.fn().mockResolvedValue(null),
  checkDomainTrust: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../utils/logger/api.js', () => ({
  logError: vi.fn(),
  ErrorCode: { INTERNAL_ERROR: 'INT_001' },
}));
vi.mock('../../utils/logger/types.js', () => ({
  logError: vi.fn(),
  ErrorCode: { INTERNAL_ERROR: 'INT_001' },
}));
vi.mock('../../utils/logger/core.js', () => ({
  logError: vi.fn(),
  ErrorCode: { INTERNAL_ERROR: 'INT_001' },
}));

import { initStatusPanel } from '../statusPanel.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const enMessages = JSON.parse(
  readFileSync(join(repoRoot, 'public', '_locales', 'en', 'messages.json'), 'utf-8'),
) as Record<string, { message: string }>;
const jaMessages = JSON.parse(
  readFileSync(join(repoRoot, 'public', '_locales', 'ja', 'messages.json'), 'utf-8'),
) as Record<string, { message: string }>;

function localeMessage(table: Record<string, { message: string }>, key: string): string {
  const entry = table[key];
  if (!entry) throw new Error(`missing locale key: ${key}`);
  return entry.message;
}

let activeLocale: 'en' | 'ja' = 'en';

function stubChrome(): void {
  const tables = { en: enMessages, ja: jaMessages };
  vi.stubGlobal('chrome', {
    i18n: {
      getMessage: (key: string) => tables[activeLocale][key]?.message ?? '',
    },
    tabs: { query: vi.fn().mockResolvedValue([]), sendMessage: vi.fn() },
    runtime: { lastError: null, sendMessage: vi.fn() },
  });
}

function setupDom(): void {
  document.body.innerHTML = [
    '<div id="statusPanel">',
    '  <div id="statusDomainIcon"></div>',
    '  <span id="statusDomainLabel"></span>',
    '  <div id="statusPrivacyIcon"></div>',
    '  <span id="statusPrivacyLabel"></span>',
    '  <div id="statusDomainState"></div>',
    '  <div id="statusDomainMode"></div>',
    '  <div id="statusPrivacyContent"></div>',
    '  <div id="statusCacheContent"></div>',
    '  <div id="statusLastSavedContent"></div>',
    '  <div id="statusCleansingContent"></div>',
    '  <div id="statusTrustContent"></div>',
    '  <div id="statusModeBadge"></div>',
    '  <button id="statusToggleBtn" aria-expanded="false"></button>',
    '  <div id="statusDetails"></div>',
    '  <span id="statusToggleText"></span>',
    '  <div id="permissionRequestArea" class="hidden"></div>',
    '  <div id="permissionDeniedMessage" class="hidden"></div>',
    '  <button id="statusAddDomain"></button>',
    '  <button id="statusAddPath"></button>',
    '</div>',
    '<div id="mainStatus"></div>',
  ].join('\n');
}

async function initPrivatePanel(): Promise<void> {
  setupDom();
  mockCheckPageStatus.mockResolvedValue({
    domainFilter: { allowed: true, mode: 'disabled' },
    privacy: { isPrivate: true, hasCache: true, reason: 'cache-control' },
    cache: { hasCache: false },
    lastSaved: { exists: false },
  });
  await initStatusPanel();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAll.mockResolvedValue({ privacy_mode: 'full_pipeline', domain_whitelist: [] });
  mockGetCurrentTab.mockResolvedValue({ url: 'https://example.com/page', id: 1 });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('statusPanel invalid URL locales', () => {
  describe('locale pin', () => {
    it('registers statusInvalidUrl in both locales with non-empty copy', () => {
      expect(localeMessage(enMessages, 'statusInvalidUrl')).toBeTruthy();
      expect(localeMessage(jaMessages, 'statusInvalidUrl')).toBeTruthy();
    });
  });

  describe('addPath no-domain branch', () => {
    it('shows the Japanese copy for an unparseable URL', async () => {
      activeLocale = 'ja';
      stubChrome();
      await initPrivatePanel();
      mockGetCurrentTab.mockResolvedValue({ url: 'not a url', id: 1 });
      document.getElementById('statusAddPath')!.click();
      await waitForMock(() => {
        expect(document.getElementById('mainStatus')!.textContent).toBe(
          localeMessage(jaMessages, 'statusInvalidUrl'),
        );
      });
    });

    it('shows the English copy for an unparseable URL', async () => {
      activeLocale = 'en';
      stubChrome();
      await initPrivatePanel();
      mockGetCurrentTab.mockResolvedValue({ url: 'not a url', id: 1 });
      document.getElementById('statusAddPath')!.click();
      await waitForMock(() => {
        expect(document.getElementById('mainStatus')!.textContent).toBe(
          localeMessage(enMessages, 'statusInvalidUrl'),
        );
      });
    });

    it('falls back to the English default when the key is missing', async () => {
      vi.stubGlobal('chrome', {
        i18n: { getMessage: () => '' },
        tabs: { query: vi.fn().mockResolvedValue([]), sendMessage: vi.fn() },
        runtime: { lastError: null, sendMessage: vi.fn() },
      });
      await initPrivatePanel();
      mockGetCurrentTab.mockResolvedValue({ url: 'not a url', id: 1 });
      document.getElementById('statusAddPath')!.click();
      await waitForMock(() => {
        expect(document.getElementById('mainStatus')!.textContent).toBe('Invalid URL');
      });
    });
  });
});
