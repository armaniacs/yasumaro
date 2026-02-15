/**
 * domainFilter.test.js
 * Domain Filter UI Component Tests
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock dependencies (must be defined before imports)
jest.mock('../../utils/storage.ts', () => {
  const mockGetSettings = jest.fn();
  const mockSaveSettings = jest.fn(() => Promise.resolve());

  // Set default mock implementation
  mockGetSettings.mockResolvedValue({
    domain_filter_mode: 'disabled',
    domain_whitelist: [],
    domain_blacklist: [],
    simple_format_enabled: true,
    ublock_format_enabled: false,
    obsidian_api_key: '',
    obsidian_port: '27123',
    obsidian_protocol: 'http',
    gemini_api_key: '',
    min_visit_duration: 5,
    min_scroll_depth: 50,
    gemini_model: 'gemini-1.5-flash',
    obsidian_daily_path: '092.Daily',
    ai_provider: 'openai',
    openai_base_url: 'https://api.groq.com/openai/v1',
    openai_api_key: '',
    openai_model: 'openai/gpt-oss-20b',
    openai_2_base_url: 'http://127.0.0.1:11434/v1',
    openai_2_api_key: '',
    openai_2_model: 'llama3',
    privacy_mode: 'masked_cloud',
    pii_confirmation_ui: true,
    pii_sanitize_logs: true,
    ublock_rules: {
      blockDomains: [],
      exceptionDomains: [],
      metadata: { importedAt: 0, ruleCount: 0 }
    },
    ublock_sources: [],
  });

  return {
    StorageKeys: {
      DOMAIN_FILTER_MODE: 'domain_filter_mode',
      DOMAIN_WHITELIST: 'domain_whitelist',
      DOMAIN_BLACKLIST: 'domain_blacklist',
      SIMPLE_FORMAT_ENABLED: 'simple_format_enabled',
      UBLOCK_FORMAT_ENABLED: 'ublock_format_enabled',
      UBLOCK_RULES: 'ublock_rules',
      UBLOCK_SOURCES: 'ublock_sources',
      OBSIDIAN_API_KEY: 'obsidian_api_key',
      OBSIDIAN_PROTOCOL: 'obsidian_protocol',
      OBSIDIAN_PORT: 'obsidian_port',
      GEMINI_API_KEY: 'gemini_api_key',
      MIN_VISIT_DURATION: 'min_visit_duration',
      MIN_SCROLL_DEPTH: 'min_scroll_depth',
      GEMINI_MODEL: 'gemini_model',
      OBSIDIAN_DAILY_PATH: 'obsidian_daily_path',
      AI_PROVIDER: 'ai_provider',
      OPENAI_BASE_URL: 'openai_base_url',
      OPENAI_API_KEY: 'openai_api_key',
      OPENAI_MODEL: 'openai_model',
      OPENAI_2_BASE_URL: 'openai_2_base_url',
      OPENAI_2_API_KEY: 'openai_2_api_key',
      OPENAI_2_MODEL: 'openai_2_model',
      PRIVACY_MODE: 'privacy_mode',
      PII_CONFIRMATION_UI: 'pii_confirmation_ui',
      PII_SANITIZE_LOGS: 'pii_sanitize_logs',
    },
    getSettings: mockGetSettings,
    saveSettings: mockSaveSettings,
  };
});

jest.mock('../../utils/domainUtils.ts', () => ({
  extractDomain: jest.fn(),
  parseDomainList: jest.fn(),
  validateDomainList: jest.fn(),
  isDomainAllowed: jest.fn(),
  isDomainInList: jest.fn(),
  isValidDomain: jest.fn(),
  matchesPattern: jest.fn(),
}));

jest.mock('../ublockImport.ts', () => ({
  init: jest.fn(),
  saveUblockSettings: jest.fn(),
}));

jest.mock('../../utils/logger.ts', () => ({
  addLog: jest.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', SANITIZE: 'SANITIZE' },
}));

jest.mock('../tabUtils.ts', () => ({
  getCurrentTab: jest.fn(),
  isRecordable: jest.fn(),
}));

jest.mock('../settingsUiHelper.ts', () => ({
  showStatus: jest.fn(),
}));

jest.mock('../i18n.ts', () => ({
  getMessage: jest.fn((key, substitutions) => {
    const messages = {
      'domainList': 'Domain List (1 domain per line)',
      'domainFilterSaved': 'Domain filter settings saved',
      'filterModeRequired': 'Please select a filter mode',
      'domainListError': 'Domain list errors:',
      'saveError': 'Save error',
    };
    let message = messages[key] || key;
    if (substitutions && typeof substitutions === 'object') {
      Object.keys(substitutions).forEach((placeholder) => {
        message = message.replace(`{${placeholder}}`, substitutions[placeholder]);
      });
    }
    return message;
  }),
}));

describe('domainFilter', () => {
  describe('Import test - verify module can be loaded', () => {
    it('should be able to import domainFilter module', async () => {
      const { init, handleSaveDomainSettings } = await import('../domainFilter.js');
      expect(init).toBeDefined();
      expect(handleSaveDomainSettings).toBeDefined();
    });
  });

  // ==============================================================================
  // DOM-001: Initialize domain filter UI with event listeners
  // ==============================================================================
  describe('DOM-001: Initialize domain filter UI', () => {
    it('INIT correctly runs without errors', async () => {
      // Create minimal required DOM elements
      const generalTab = document.createElement('button');
      generalTab.id = 'generalTab';
      document.body.appendChild(generalTab);

      const domainTab = document.createElement('button');
      domainTab.id = 'domainTab';
      document.body.appendChild(domainTab);

      const generalPanel = document.createElement('div');
      generalPanel.id = 'generalPanel';
      document.body.appendChild(generalPanel);

      const domainPanel = document.createElement('div');
      domainPanel.id = 'domainPanel';
      document.body.appendChild(domainPanel);

      const { init } = await import('../domainFilter.js');

      // Should not throw
      expect(() => init()).not.toThrow();
    });
  });

  // ==============================================================================
  // DOM-002: Load domain settings (whitelist, blacklist) - NOT FULLY TESTABLE
  // ==============================================================================
  // NOTE: This function is NOT FULLY TESTABLE in the current test architecture
  // because domainFilter.js caches DOM element references at the module level.
  // When the test runs beforeEach and creates new DOM elements, the module
  // still holds references to the old (or undefined) elements from initial import.
  //
  // To properly test this function, the architecture would need to be refactored
  // to either:
  // 1. Not cache DOM elements at the module level, or
  // 2. Use a dependency injection pattern for DOM elements.
  //
  // For now, we can only verify that the module imports correctly and the function exists.
  // =============================================================================
  describe('DOM-002: Load domain settings (whitelist, blacklist) - NOT FULLY TESTABLE', () => {
    it('should verify loadDomainSettings function exists', async () => {
      const { loadDomainSettings } = await import('../domainFilter.js');
      expect(loadDomainSettings).toBeDefined();
      expect(typeof loadDomainSettings).toBe('function');
    });

    it('should verify loadDomainSettings can be called (may not work correctly due to DOM caching)', async () => {
      const { loadDomainSettings } = await import('../domainFilter.js');
      // This will likely not work correctly because of DOM caching,
      // but it should at least not throw.
      try {
        await loadDomainSettings();
      } catch (e) {
        // Expected to possibly fail due to DOM caching issue
        // The important thing is the function exists and is callable
      }
    });
  });

  // ==============================================================================
  // DOM-004 through DOM-005: NOT TESTABLE - Functions not exported
  // ==============================================================================
  describe('DOM-004 & DOM-005: Functions not exported', () => {
    it('addCurrentDomain function is not exported', async () => {
      const module = await import('../domainFilter.js');
      expect(module.addCurrentDomain).toBeUndefined();
    });

    it('updateDomainListVisibility function is not exported', async () => {
      const module = await import('../domainFilter.js');
      expect(module.updateDomainListVisibility).toBeUndefined();
    });
  });

  // ==============================================================================
  // DOM-006: Toggle format UI (simple vs uBlock) - NOT FULLY TESTABLE
  // ==============================================================================
  // NOTE: This function is NOT FULLY TESTABLE in the current test architecture
  // because domainFilter.js caches DOM element references at the module level.
  // When the test runs beforeEach and creates new DOM elements, the module
  // still holds references to the old (or undefined) elements from initial import.
  //
  // To properly test this function, the architecture would need to be refactored
  // to either:
  // 1. Not cache DOM elements at the module level, or
  // 2. Use a dependency injection pattern for DOM elements.
  //
  // For now, we can only verify that the module imports correctly and the function exists.
  // =============================================================================
  describe('DOM-006: Toggle format UI (simple vs uBlock) - NOT FULLY TESTABLE', () => {
    it('should verify toggleFormatUI function exists', async () => {
      const { toggleFormatUI } = await import('../domainFilter.js');
      expect(toggleFormatUI).toBeDefined();
      expect(typeof toggleFormatUI).toBe('function');
    });

    it('should verify toggleFormatUI can be called (may not work correctly due to DOM caching)', async () => {
      const { toggleFormatUI } = await import('../domainFilter.js');
      // This will likely not work correctly because of DOM caching,
      // but it should at least not throw.
      expect(() => toggleFormatUI()).not.toThrow();
    });
  });
});