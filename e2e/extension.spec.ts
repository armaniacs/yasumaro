import { test, expect } from './fixtures/popup.fixture.js';

/**
 * E2E Tests for Obsidian Weave Chrome Extension - Popup UI
 *
 * These tests verify the extension's popup UI static structure using file:// protocol.
 * Note: Interaction tests requiring Chrome extension APIs (chrome.runtime, chrome.storage)
 * are marked with test.fixme() and need a proper extension context to run.
 */

test.describe('Popup - Main Screen @ui', () => {
  test('displays the popup with a valid title', async ({ popupPage: page }) => {
    await test.step('Check page title is non-empty', async () => {
      await expect(page).toHaveTitle(/.+/);
    });
  });

  test('shows main screen with record button', async ({ popupPage: page }) => {
    await test.step('Verify main screen is visible', async () => {
      await expect(page.locator('#mainScreen')).toBeVisible();
    });

    await test.step('Verify record button is visible', async () => {
      await expect(page.locator('#recordBtn')).toBeVisible();
    });
  });

  test('shows current page info section', async ({ popupPage: page }) => {
    await expect(page.locator('#currentPage')).toBeAttached();
    await expect(page.locator('#pageTitle')).toBeAttached();
    await expect(page.locator('#pageUrl')).toBeAttached();
  });

  test('shows status panel with toggle button', async ({ popupPage: page }) => {
    await expect(page.locator('#statusPanel')).toBeAttached();
    await expect(page.locator('#statusToggleBtn')).toBeAttached();
    await expect(page.locator('#statusToggleBtn')).toHaveAttribute('aria-expanded', 'false');
  });

  test('shows loading spinner in DOM', async ({ popupPage: page }) => {
    await expect(page.locator('#loadingSpinner')).toBeAttached();
  });

  test('shows confirmation modal in DOM', async ({ popupPage: page }) => {
    await expect(page.locator('#confirmationModal')).toBeAttached();
  });
});

test.describe('Popup - Settings Screen @ui', () => {
  test('has settings screen in DOM', async ({ popupPage: page }) => {
    await expect(page.locator('#settingsScreen')).toBeAttached();
  });

  test('has navigation tabs with correct count', async ({ popupPage: page }) => {
    await test.step('Verify tab list exists', async () => {
      await expect(page.locator('#tabList')).toBeAttached();
    });

    await test.step('Verify expected tabs are present', async () => {
      await expect(page.locator('.tab-btn')).toHaveCount(4);
    });

    await test.step('Verify first tab is active by default', async () => {
      await expect(page.locator('#generalTab')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#generalTab')).toHaveClass(/active/);
    });
  });

  test('has tab panels with correct ARIA attributes', async ({ popupPage: page }) => {
    await expect(page.locator('#generalPanel')).toHaveAttribute('role', 'tabpanel');
    await expect(page.locator('#domainPanel')).toHaveAttribute('role', 'tabpanel');
    await expect(page.locator('#promptPanel')).toHaveAttribute('role', 'tabpanel');
    await expect(page.locator('#privacyPanel')).toHaveAttribute('role', 'tabpanel');
  });

  test('general panel has form elements', async ({ popupPage: page }) => {
    await expect(page.locator('#apiKey')).toBeAttached();
    await expect(page.locator('#protocol')).toBeAttached();
    await expect(page.locator('#port')).toBeAttached();
    await expect(page.locator('#dailyPath')).toBeAttached();
    await expect(page.locator('#aiProvider')).toBeAttached();
    await expect(page.locator('#save')).toBeAttached();
  });

  test('general panel has validation error containers', async ({ popupPage: page }) => {
    await expect(page.locator('#protocolError')).toBeAttached();
    await expect(page.locator('#portError')).toBeAttached();
    await expect(page.locator('#minVisitDurationError')).toBeAttached();
    await expect(page.locator('#minScrollDepthError')).toBeAttached();
  });

  test('domain panel has filter mode radio buttons', async ({ popupPage: page }) => {
    await expect(page.locator('#domainPanel')).toBeAttached();
    await expect(page.locator('#filterDisabled')).toBeAttached();
    await expect(page.locator('#filterWhitelist')).toBeAttached();
    await expect(page.locator('#filterBlacklist')).toBeAttached();
  });

  test('domain panel has domain list textarea', async ({ popupPage: page }) => {
    await expect(page.locator('#domainList')).toBeAttached();
  });

  test('privacy panel has privacy mode radio buttons', async ({ popupPage: page }) => {
    await expect(page.locator('#privacyPanel')).toBeAttached();
    await expect(page.locator('#modeA')).toBeAttached();
    await expect(page.locator('#modeB')).toBeAttached();
    await expect(page.locator('#modeC')).toBeAttached();
    await expect(page.locator('#modeD')).toBeAttached();
  });
});

test.describe('Popup - Private Page Dialog @ui', () => {
  test('dialog exists and is of correct type', async ({ popupPage: page }) => {
    const dialog = page.locator('#private-page-dialog');

    await test.step('Verify dialog element exists', async () => {
      await expect(dialog).toBeAttached();
    });

    await test.step('Verify it is a <dialog> element', async () => {
      await expect(dialog).toHaveJSProperty('tagName', 'DIALOG');
    });
  });

  test('dialog is hidden by default', async ({ popupPage: page }) => {
    await expect(page.locator('#private-page-dialog')).toBeHidden();
  });

  test('dialog has all action buttons', async ({ popupPage: page }) => {
    await expect(page.locator('#dialog-cancel')).toBeAttached();
    await expect(page.locator('#dialog-save-once')).toBeAttached();
    await expect(page.locator('#dialog-save-domain')).toBeAttached();
    await expect(page.locator('#dialog-save-path')).toBeAttached();
  });

  test('dialog has title and message elements', async ({ popupPage: page }) => {
    await expect(page.locator('#dialog-title')).toBeAttached();
    await expect(page.locator('#dialog-message')).toBeAttached();
  });

  test('pending section exists with batch operation buttons', async ({ popupPage: page }) => {
    await test.step('Verify pending section structure', async () => {
      await expect(page.locator('#pending-section')).toBeAttached();
      await expect(page.locator('#pending-pages-list')).toBeAttached();
      await expect(page.locator('#pending-empty')).toBeAttached();
    });

    await test.step('Verify batch operation buttons', async () => {
      await expect(page.locator('#btn-select-all')).toBeAttached();
      await expect(page.locator('#btn-save-selected')).toBeAttached();
      await expect(page.locator('#btn-save-whitelist')).toBeAttached();
      await expect(page.locator('#btn-discard')).toBeAttached();
    });
  });

  test('pending section is hidden when no pages exist', async ({ popupPage: page }) => {
    await expect(page.locator('#pending-section')).toHaveClass(/hidden/);
  });
});

test.describe('Popup - Navigation Interaction @interaction', () => {
  test.fixme(true, 'Requires Chrome extension context for JS execution');

  test('should navigate to settings screen', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await expect(page.locator('#settingsScreen')).toBeVisible();
  });

  test('should switch between tabs', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();

    const generalTab = page.locator('#generalTab');
    await generalTab.click();
    await expect(generalTab).toHaveClass(/active/);
    await expect(page.locator('#generalPanel')).toBeVisible();
  });

  test('should handle form input', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await page.locator('#generalTab').click();

    const protocolInput = page.locator('#protocol');
    await protocolInput.fill('http');
    await expect(protocolInput).toHaveValue('http');
  });
});

test.describe('Popup - Private Page Interaction @interaction', () => {
  test.fixme(true, 'Requires Chrome extension context (chrome.runtime, chrome.storage mocks)');

  test('should handle dialog cancel action', async ({ popupPage: page }) => {
    const dialog = page.locator('#private-page-dialog');
    await page.locator('#dialog-cancel').click();
    await expect(dialog).not.toBeVisible();
  });

  test('should handle save once action', async ({ popupPage: page }) => {
    await page.locator('#dialog-save-once').click();
    await expect(page.locator('#private-page-dialog')).not.toBeVisible();
  });

  test('should handle save domain action', async ({ popupPage: page }) => {
    await page.locator('#dialog-save-domain').click();
    await expect(page.locator('#private-page-dialog')).not.toBeVisible();
  });

  test('should handle save path action', async ({ popupPage: page }) => {
    await page.locator('#dialog-save-path').click();
    await expect(page.locator('#private-page-dialog')).not.toBeVisible();
  });

  test('should display pending pages when available', async ({ popupPage: page }) => {
    await expect(page.locator('#pending-section')).not.toHaveClass(/hidden/);
    await expect(page.locator('.pending-item').first()).toBeVisible();
  });

  test('should toggle select all checkboxes', async ({ popupPage: page }) => {
    const selectAllBtn = page.locator('#btn-select-all');
    const checkboxes = page.locator('.pending-checkbox');

    await selectAllBtn.click();
    for (const checkbox of await checkboxes.all()) {
      await expect(checkbox).toBeChecked();
    }

    await selectAllBtn.click();
    for (const checkbox of await checkboxes.all()) {
      await expect(checkbox).not.toBeChecked();
    }
  });
});

test.describe('Extension - Content Script @interaction', () => {
  test.fixme(true, 'Requires loaded extension with content script injection');

  test('should inject content script on page load', async ({ popupPage: page, context }) => {
    await page.goto('https://example.com');
    await expect(page.locator('[data-smart-history-marker]')).toHaveCount(0);
  });

  test('should extract page content', async ({ popupPage: page }) => {
    await page.goto('https://example.com');

    const extractedContent = await page.evaluate(() => {
      // @ts-expect-error - smartHistory is injected by content script
      return window.smartHistory?.extractContent();
    });

    expect(extractedContent).toBeTruthy();
  });
});

test.describe('Extension - Service Worker @interaction', () => {
  test.fixme(true, 'Requires loaded extension with service worker');

  test('should handle messages from content script', async () => {
    // Placeholder: requires service worker context
  });

  test('should store data in Chrome storage', async () => {
    // Placeholder: requires chrome.storage mock
  });
});
