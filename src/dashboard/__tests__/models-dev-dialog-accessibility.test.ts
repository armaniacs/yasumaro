/**
 * @jest-environment jsdom
 */

/**
 * models-dev-dialog-accessibility.test.ts
 * Accessibility tests for models-dev-dialog.html
 * Validates ARIA attributes for WCAG 2.1 Level AA compliance
 */

import { jest } from '@jest/globals';

describe('Models Dev Dialog - Accessibility (ARIA Attributes)', () => {
  let htmlContent: string;

  beforeAll(async () => {
    // Load the HTML file as text
    const fs = (await import('fs'));
    const path = (await import('path'));

    const { readFileSync } = fs;
    const { resolve } = path;

    htmlContent = readFileSync(
      resolve(__dirname, '../models-dev-dialog.html'),
      'utf-8'
    );
  });

  describe('Error message area', () => {
    it('should have aria-live="polite" on error message element in HTML source', () => {
      expect(htmlContent).toContain('id="dialog-error"');
      expect(htmlContent).toContain('aria-live="polite"');
      // Verify they are close together (same element)
      const errorElementMatch = htmlContent.match(/id="dialog-error"[^>]*aria-live="polite"/);
      expect(errorElementMatch).not.toBeNull();
    });

    it('should have error-message class on dialog-error element', () => {
      const errorElementMatch = htmlContent.match(/id="dialog-error"[^>]*class="[^"]*error-message[^"]*"/);
      expect(errorElementMatch).not.toBeNull();
    });
  });

  describe('Loading state', () => {
    it('should have aria-live="polite" on loading element in HTML source', () => {
      expect(htmlContent).toContain('id="dialog-loading"');
      expect(htmlContent).toContain('aria-live="polite"');
      const loadingElementMatch = htmlContent.match(/id="dialog-loading"[^>]*aria-live="polite"/);
      expect(loadingElementMatch).not.toBeNull();
    });

    it('should have aria-busy="true" on loading element', () => {
      expect(htmlContent).toContain('aria-busy="true"');
      const loadingElementWithBusy = htmlContent.match(/id="dialog-loading"[^>]*aria-busy="true"/);
      expect(loadingElementWithBusy).not.toBeNull();
    });

    it('should have loading-state class', () => {
      expect(htmlContent).toContain('loading-state');
    });
  });

  describe('API Key input', () => {
    it('should have aria-required="true" on API key input in HTML source', () => {
      expect(htmlContent).toContain('id="api-key-input"');
      expect(htmlContent).toContain('aria-required="true"');
      const apiKeyInputMatch = htmlContent.match(/id="api-key-input"[^>]*aria-required="true"/);
      expect(apiKeyInputMatch).not.toBeNull();
    });

    it('should have type="password" on API key input', () => {
      // Look for the input with id="api-key-input" and check it has type="password"
      // Handle both type before/after id patterns
      const apiKeyInputMatch = htmlContent.match(/(?:type="password"[^>]*id="api-key-input"|id="api-key-input"[^>]*type="password")/);
      expect(apiKeyInputMatch).not.toBeNull();
    });

    it('should have associated label', () => {
      expect(htmlContent).toContain('label for="api-key-input"');
    });
  });

  describe('Modal dialog accessibility', () => {
    it('should have role="dialog"', () => {
      expect(htmlContent).toContain('role="dialog"');
    });

    it('should have aria-modal="true"', () => {
      expect(htmlContent).toContain('aria-modal="true"');
    });

    it('should have aria-labelledby pointing to title', () => {
      expect(htmlContent).toContain('aria-labelledby="dialog-title"');
      expect(htmlContent).toContain('id="dialog-title"');
    });
  });

  describe('Tab navigation (ARIA tab pattern)', () => {
    it('should have tablist role', () => {
      expect(htmlContent).toContain('role="tablist"');
    });

    it('should have aria-label on tablist', () => {
      expect(htmlContent).toContain('aria-label="Provider categories"');
    });

    it('should have all tabs with role="tab"', () => {
      const tabMatches = htmlContent.match(/role="tab"/g);
      expect(tabMatches).not.toBeNull();
      expect(tabMatches!.length).toBeGreaterThan(0);
    });

    it('should have aria-controls pointing to provider-list', () => {
      expect(htmlContent).toContain('aria-controls="provider-list"');
    });

    it('should have tabpanel role', () => {
      expect(htmlContent).toContain('role="tabpanel"');
    });

    it('should have aria-labelledby on tabpanel', () => {
      const tabPanelMatch = htmlContent.match(/id="provider-list"[^>]*aria-labelledby="tab-all"/);
      expect(tabPanelMatch).not.toBeNull();
    });
  });

  describe('Button accessibility', () => {
    it('should have type="button" on all buttons', () => {
      const buttonMatches = htmlContent.match(/type="button"/g);
      expect(buttonMatches).not.toBeNull();
      expect(buttonMatches!.length).toBeGreaterThan(0);
    });

    it('should have non-empty aria-label on close button', () => {
      const closeButtonMatch = htmlContent.match(/id="dialog-close"[^>]*aria-label="Close"/);
      expect(closeButtonMatch).not.toBeNull();
    });

    it('should have data-i18n attributes on buttons with text', () => {
      expect(htmlContent).toContain('data-i18n="cancel"');
      expect(htmlContent).toContain('data-i18n="save"');
    });
  });

  describe('Input accessibility', () => {
    it('should have placeholder for search input', () => {
      const searchInputMatch = htmlContent.match(/id="provider-search"[^>]*placeholder/);
      expect(searchInputMatch).not.toBeNull();
    });

    it('should have data-i18n-placeholder for search input', () => {
      expect(htmlContent).toContain('data-i18n-placeholder="searchPlaceholder"');
    });

    it('should have placeholder for model input', () => {
      const modelInputMatch = htmlContent.match(/id="model-input"[^>]*placeholder/);
      expect(modelInputMatch).not.toBeNull();
    });
  });

  describe('Label associations', () => {
    it('should have model label associated with model input', () => {
      expect(htmlContent).toContain('label for="model-input"');
      expect(htmlContent).toContain('id="model-input"');
    });

    it('should have apiKey label associated with apiKey input', () => {
      expect(htmlContent).toContain('label for="api-key-input"');
      expect(htmlContent).toContain('id="api-key-input"');
    });
  });
});