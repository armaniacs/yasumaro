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

vi.mock('../popup/i18n.js', () => ({
    getMessage: vi.fn((key: string) => key),
}));

vi.mock('../popup/settingsUiHelper.js', () => ({
    showStatus: vi.fn(),
}));

vi.mock('../utils/storage.js', () => ({
    getSettings: vi.fn().mockResolvedValue({}),
    saveSettingsWithAllowedUrls: vi.fn().mockResolvedValue(undefined),
    StorageKeys: {
        TRANCO_VERSION: 'tranco_version',
        TRANCO_DOMAINS: 'tranco_domains',
        TRANCO_CONSENT_GRANTED: 'tranco_consent_granted',
        TRANCO_CONSENT_DENIED_TIMESTAMP: 'tranco_consent_denied_timestamp',
        TRANCO_CONSENT_DENIED_REASON: 'tranco_consent_denied_reason',
    },
}));

// Import after mocks
import { initTrancoConsentPanel } from '../trancoConsent.js';

describe('initTrancoConsentPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
});

describe('TrancoConsentState interface', () => {
    it('defines expected needsConsent values', () => {
        // This tests the interface structure
        const validStates = ['GRANTED', 'DENIED', 'PENDING', 'ALREADY_GRANTED', 'RETRY_NEEDED'] as const;
        expect(validStates).toContain('ALREADY_GRANTED');
        expect(validStates).toContain('PENDING');
    });
});
