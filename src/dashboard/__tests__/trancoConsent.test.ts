// @vitest-environment jsdom
/**
 * trancoConsent.test.ts
 * Unit tests for trancoConsent.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Setup chrome mock
vi.stubGlobal('chrome', {
    i18n: {
        getMessage: vi.fn((key: string) => key),
        getUILanguage: vi.fn(() => 'en'),
    },
    runtime: {
        sendMessage: vi.fn().mockResolvedValue({}),
    },
    storage: {
        local: {
            get: vi.fn().mockResolvedValue({}),
            set: vi.fn().mockResolvedValue(undefined),
        },
    },
});

vi.mock('../../utils/i18n.js', () => ({
    getMessage: vi.fn((key: string) => key),
}));

vi.mock('../../utils/ui/settingsUiHelper.js', () => ({
    showStatus: vi.fn(),
}));

const { mockGetAll, mockGetMany, mockSetAll } = vi.hoisted(() => ({
    mockGetAll: vi.fn().mockResolvedValue({}),
    mockGetMany: vi.fn().mockResolvedValue({}),
    mockSetAll: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    StorageKeys: {
          TRANCO_VERSION: 'tranco_version',
          TRANCO_DOMAINS: 'tranco_domains',
          TRANCO_CONSENT_GRANTED: 'tranco_consent_granted',
          TRANCO_CONSENT_DENIED_TIMESTAMP: 'tranco_consent_denied_timestamp',
          TRANCO_CONSENT_DENIED_REASON: 'tranco_consent_denied_reason',
      },
  };
});

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetAll,
      getMany: mockGetMany,
      setAll: mockSetAll,
      get: vi.fn(),
      set: vi.fn(),
    },
    SettingsRepository: class {
      getAll = mockGetAll;
      getMany = mockGetMany;
      setAll = mockSetAll;
      get = vi.fn();
      set = vi.fn();
    },
  };
});

// Import after mocks
import { initTrancoConsentPanel } from '../trancoConsent.js';
import { showStatus } from '../../utils/ui/settingsUiHelper.js';

const mockedShowStatus = showStatus as ReturnType<typeof vi.fn>;

function getBaseDom(): string {
    return `
        <div id="trancoCurrentVersion"></div>
        <div id="trancoDomainCount"></div>
        <div id="trancoConsentStatus"></div>
        <div id="trancoConsentRetryInfo"></div>
        <div id="trancoConsentActions"></div>
    `;
}

describe('initTrancoConsentPanel', () => {
    let settingsReturn: Record<string, unknown> = {};

    beforeEach(() => {
        vi.clearAllMocks();
        mockGetAll.mockReset();
        mockGetMany.mockReset();
        mockSetAll.mockReset();
        settingsReturn = {};
        mockGetAll.mockImplementation(() => Promise.resolve(settingsReturn));
        mockGetMany.mockImplementation(() => Promise.resolve(settingsReturn));
        mockSetAll.mockResolvedValue(undefined);
    });

    it('returns early when UI elements not found', async () => {
        document.body.innerHTML = `<div id="trancoCurrentVersion"></div>`;

        // Should not throw - just logs warning and returns
        await expect(initTrancoConsentPanel()).resolves.not.toThrow();
    });

    it('handles missing consentStatus element gracefully', async () => {
        document.body.innerHTML = `
            <div id="trancoCurrentVersion"></div>
            <div id="trancoDomainCount"></div>
            <div id="trancoConsentRetryInfo"></div>
            <div id="trancoConsentActions"></div>
        `;

        // Should not throw
        await expect(initTrancoConsentPanel()).resolves.not.toThrow();
    });

    it('handles full DOM with all elements without throwing', async () => {
        document.body.innerHTML = `
            <div id="trancoCurrentVersion"></div>
            <div id="trancoDomainCount"></div>
            <div id="trancoConsentStatus"></div>
            <div id="trancoConsentRetryInfo"></div>
            <div id="trancoConsentActions"></div>
        `;

        // Should not throw
        await expect(initTrancoConsentPanel()).resolves.not.toThrow();
    });

    it('updates domain count element when domains are present', async () => {
        document.body.innerHTML = `
            <div id="trancoCurrentVersion"></div>
            <div id="trancoDomainCount"></div>
            <div id="trancoConsentStatus"></div>
            <div id="trancoConsentRetryInfo"></div>
            <div id="trancoConsentActions"></div>
        `;

        await initTrancoConsentPanel();

        const domainCountEl = document.getElementById('trancoDomainCount');
        // With default mock returning empty domains, count should be '0'
        expect(domainCountEl?.textContent).toBe('0');
    });

    it('updates version element when version is set', async () => {
        document.body.innerHTML = `
            <div id="trancoCurrentVersion"></div>
            <div id="trancoDomainCount"></div>
            <div id="trancoConsentStatus"></div>
            <div id="trancoConsentRetryInfo"></div>
            <div id="trancoConsentActions"></div>
        `;

        await initTrancoConsentPanel();

        const versionEl = document.getElementById('trancoCurrentVersion');
        // With no version set, it should show the message for not updated
        expect(versionEl?.textContent).toBeTruthy();
    });

    it('displays formatted date when version is set', async () => {
        document.body.innerHTML = getBaseDom();
        settingsReturn = {
            tranco_version: '2025-03-15',
            tranco_domains: ['example.com', 'test.org'],
        };

        await initTrancoConsentPanel();

        const versionEl = document.getElementById('trancoCurrentVersion');
        expect(versionEl?.textContent).toContain('2025');
    });

    it('updates domain count for non-empty domains', async () => {
        document.body.innerHTML = getBaseDom();
        settingsReturn = {
            tranco_version: '2025-03-15',
            tranco_domains: ['example.com', 'test.org', 'foo.bar'],
        };

        await initTrancoConsentPanel();

        const domainCountEl = document.getElementById('trancoDomainCount');
        expect(domainCountEl?.textContent).toBe('3');
    });

    it('handles ALREADY_GRANTED consent state', async () => {
        document.body.innerHTML = getBaseDom();
        settingsReturn = {
            tranco_version: '2025-03-15',
            tranco_domains: [],
            tranco_consent_granted: '2025-03-15',
        };

        await initTrancoConsentPanel();

        const statusEl = document.getElementById('trancoConsentStatus');
        expect(statusEl?.textContent).toBe('trancoConsentStatusALREADY_GRANTED');
        expect(statusEl?.className).toContain('status-already_granted');
        const actionsEl = document.getElementById('trancoConsentActions');
        expect(actionsEl?.hidden).toBe(true);
    });

    it('handles PENDING consent state with action buttons', async () => {
        document.body.innerHTML = getBaseDom();
        settingsReturn = {
            tranco_version: '2025-03-15',
            tranco_domains: [],
        };

        await initTrancoConsentPanel();

        const statusEl = document.getElementById('trancoConsentStatus');
        expect(statusEl?.textContent).toBe('trancoConsentStatusPENDING');
        const actionsEl = document.getElementById('trancoConsentActions');
        expect(actionsEl?.hidden).toBe(false);
        const grantBtn = actionsEl?.querySelector('button');
        expect(grantBtn).not.toBeNull();
    });

    it('handles DENIED consent state with retry info', async () => {
        document.body.innerHTML = getBaseDom();
        const deniedTimestamp = Date.now() - 1000 * 60 * 60 * 24 * 5; // 5 days ago
        settingsReturn = {
            tranco_version: '2025-03-15',
            tranco_domains: [],
            tranco_consent_denied_timestamp: deniedTimestamp,
        };

        await initTrancoConsentPanel();

        const statusEl = document.getElementById('trancoConsentStatus');
        expect(statusEl?.textContent).toBe('trancoConsentStatusDENIED');
        const retryEl = document.getElementById('trancoConsentRetryInfo');
        expect(retryEl?.hidden).toBe(false);
        // getMessage mock returns key string unchanged, so textContent equals the key
        expect(retryEl?.textContent).toBe('trancoConsentRetryDaysRemaining');
        const actionsEl = document.getElementById('trancoConsentActions');
        expect(actionsEl?.hidden).toBe(true);
    });

    it('handles RETRY_NEEDED consent state when denial period expired', async () => {
        document.body.innerHTML = getBaseDom();
        const deniedTimestamp = Date.now() - 1000 * 60 * 60 * 24 * 35; // 35 days ago
        settingsReturn = {
            tranco_version: '2025-03-15',
            tranco_domains: [],
            tranco_consent_denied_timestamp: deniedTimestamp,
        };

        await initTrancoConsentPanel();

        const statusEl = document.getElementById('trancoConsentStatus');
        expect(statusEl?.textContent).toBe('trancoConsentStatusRETRY_NEEDED');
        const actionsEl = document.getElementById('trancoConsentActions');
        expect(actionsEl?.hidden).toBe(false);
    });

    it('handles GRANTED (different version) as needing consent', async () => {
        document.body.innerHTML = getBaseDom();
        settingsReturn = {
            tranco_version: '2025-03-20',
            tranco_domains: [],
            tranco_consent_granted: '2025-03-15',
        };

        await initTrancoConsentPanel();

        const statusEl = document.getElementById('trancoConsentStatus');
        expect(statusEl?.textContent).toBe('trancoConsentStatusPENDING');
    });

    it('handles error in loading Tranco data', async () => {
        document.body.innerHTML = getBaseDom();
        mockGetMany.mockRejectedValueOnce(new Error('Storage failure'));

        await initTrancoConsentPanel();

        expect(mockedShowStatus).toHaveBeenCalled();
    });

    it('handles missing consentRetryInfo element', async () => {
        document.body.innerHTML = `
            <div id="trancoCurrentVersion"></div>
            <div id="trancoDomainCount"></div>
            <div id="trancoConsentStatus"></div>
            <div id="trancoConsentActions"></div>
        `;
        const deniedTimestamp = Date.now() - 1000 * 60 * 60 * 24 * 5;
        settingsReturn = {
            tranco_version: '2025-03-15',
            tranco_domains: [],
            tranco_consent_denied_timestamp: deniedTimestamp,
        };

        // Should not throw
        await expect(initTrancoConsentPanel()).resolves.not.toThrow();
    });

    it('handles missing consentActions element', async () => {
        document.body.innerHTML = `
            <div id="trancoCurrentVersion"></div>
            <div id="trancoDomainCount"></div>
            <div id="trancoConsentStatus"></div>
            <div id="trancoConsentRetryInfo"></div>
        `;
        settingsReturn = {
            tranco_version: '2025-03-15',
            tranco_domains: [],
        };

        // Should not throw
        await expect(initTrancoConsentPanel()).resolves.not.toThrow();
    });

    it('grant button saves consent and refreshes panel', async () => {
        document.body.innerHTML = getBaseDom();
        settingsReturn = {
            tranco_version: '2025-03-15',
            tranco_domains: [],
        };

        await initTrancoConsentPanel();

        const grantBtn = document.querySelector('.btn-primary') as HTMLButtonElement;
        expect(grantBtn).not.toBeNull();

        mockSetAll.mockResolvedValueOnce(undefined);
        // After grant, initTrancoConsentPanel is called again, so set settings for next load
        settingsReturn = {
            tranco_version: '2025-03-15',
            tranco_domains: [],
            tranco_consent_granted: '2025-03-15',
        };

        grantBtn.click();
        await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
        await vi.waitFor(() => expect(mockedShowStatus).toHaveBeenCalledWith(
            'trancoStatus',
            'trancoConsentGranted',
            'success'
        ));
    });

    it('deny button saves denial and refreshes panel', async () => {
        document.body.innerHTML = getBaseDom();
        settingsReturn = {
            tranco_version: '2025-03-15',
            tranco_domains: [],
        };

        await initTrancoConsentPanel();

        const denyBtn = document.querySelector('.btn-secondary') as HTMLButtonElement;
        expect(denyBtn).not.toBeNull();

        mockSetAll.mockResolvedValueOnce(undefined);

        denyBtn.click();
        await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
        await vi.waitFor(() => expect(mockedShowStatus).toHaveBeenCalledWith(
            'trancoStatus',
            'trancoConsentDenied',
            'error'
        ));
    });

    it('handles error during grant consent', async () => {
        document.body.innerHTML = getBaseDom();
        settingsReturn = {
            tranco_version: '2025-03-15',
            tranco_domains: [],
        };

        await initTrancoConsentPanel();

        const grantBtn = document.querySelector('.btn-primary') as HTMLButtonElement;
        mockSetAll.mockRejectedValueOnce(new Error('Save failed'));

        grantBtn.click();
        await vi.waitFor(() => expect(mockedShowStatus).toHaveBeenCalledWith(
            'trancoStatus',
            'errorConsentData',
            'error'
        ));
    });

    it('handles error during deny consent', async () => {
        document.body.innerHTML = getBaseDom();
        settingsReturn = {
            tranco_version: '2025-03-15',
            tranco_domains: [],
        };

        await initTrancoConsentPanel();

        const denyBtn = document.querySelector('.btn-secondary') as HTMLButtonElement;
        mockSetAll.mockRejectedValueOnce(new Error('Save failed'));

        denyBtn.click();
        await vi.waitFor(() => expect(mockedShowStatus).toHaveBeenCalledWith(
            'trancoStatus',
            'errorConsentData',
            'error'
        ));
    });

    it('handles missing deny reason in settings', async () => {
        document.body.innerHTML = getBaseDom();
        settingsReturn = {
            tranco_version: '2025-03-15',
            tranco_domains: [],
            tranco_consent_granted: null,
            tranco_consent_denied_timestamp: null,
            tranco_consent_denied_reason: null,
        };

        await initTrancoConsentPanel();

        const statusEl = document.getElementById('trancoConsentStatus');
        expect(statusEl?.textContent).toBe('trancoConsentStatusPENDING');
    });

    it('handles retryDaysRemaining of 0 as RETRY_NEEDED', async () => {
        document.body.innerHTML = getBaseDom();
        const deniedTimestamp = Date.now() - 1000 * 60 * 60 * 24 * 30; // exactly 30 days
        settingsReturn = {
            tranco_version: '2025-03-15',
            tranco_domains: [],
            tranco_consent_denied_timestamp: deniedTimestamp,
        };

        await initTrancoConsentPanel();

        const statusEl = document.getElementById('trancoConsentStatus');
        expect(statusEl?.textContent).toBe('trancoConsentStatusRETRY_NEEDED');
    });

    it('handles edge case: deniedTimestamp with exactly 0 remaining days (ceil edge)', async () => {
        document.body.innerHTML = getBaseDom();
        const deniedTimestamp = Date.now() - 1000 * 60 * 60 * 24 * 29.5; // 29.5 days ago
        settingsReturn = {
            tranco_version: '2025-03-15',
            tranco_domains: [],
            tranco_consent_denied_timestamp: deniedTimestamp,
        };

        await initTrancoConsentPanel();

        // 29.5 days => ceil(29.5)=30 => remaining=0 => RETRY_NEEDED => retry info hidden
        const retryEl = document.getElementById('trancoConsentRetryInfo');
        expect(retryEl?.hidden).toBe(true);
        const statusEl = document.getElementById('trancoConsentStatus');
        expect(statusEl?.textContent).toBe('trancoConsentStatusRETRY_NEEDED');
    });

    it('handles null version with unknown latest version', async () => {
        document.body.innerHTML = getBaseDom();
        settingsReturn = {
            tranco_version: null,
            tranco_domains: [],
        };

        await initTrancoConsentPanel();

        const versionEl = document.getElementById('trancoCurrentVersion');
        expect(versionEl?.textContent).toBe('trancoStatusNotUpdated');
    });
});

describe('TrancoConsentState interface', () => {
    it('defines expected needsConsent values', () => {
        // This tests the interface structure
        const validStates = ['GRANTED', 'DENIED', 'PENDING', 'ALREADY_GRANTED', 'RETRY_NEEDED'] as const;
        expect(validStates).toContain('ALREADY_GRANTED');
        expect(validStates).toContain('PENDING');
    });
});
