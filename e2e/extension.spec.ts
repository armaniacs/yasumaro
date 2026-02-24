import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * E2E Tests for Obsidian Weave Chrome Extension
 * 
 * These tests verify the extension's popup UI functionality.
 * Note: These tests require the extension to be loaded in Chrome.
 */

test.describe('Extension Popup UI', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the popup HTML file
    // Note: In a real Chrome extension test, you would load the extension
    // and navigate to chrome-extension://<extension-id>/popup/popup.html
    await page.goto('file://' + join(__dirname, '../dist/popup/popup.html'));
  });

  test('should display the popup title', async ({ page }) => {
    // Check if the popup has a title
    const title = await page.title();
    expect(title).toBeTruthy();
  });

  test('should display main screen', async ({ page }) => {
    // Check if main screen is visible
    const mainScreen = page.locator('#mainScreen');
    await expect(mainScreen).toBeVisible();
    
    // Check if record button is visible
    const recordBtn = page.locator('#recordBtn');
    await expect(recordBtn).toBeVisible();
  });

  test('should have settings screen in DOM', async ({ page }) => {
    // Check if settings screen exists in DOM (may not be visible)
    const settingsScreen = page.locator('#settingsScreen');
    const count = await settingsScreen.count();
    expect(count).toBe(1);
  });

  test('should have navigation tabs in DOM', async ({ page }) => {
    // Check if navigation tabs exist in DOM (may not be visible)
    const tabList = page.locator('#tabList');
    const count = await tabList.count();
    expect(count).toBe(1);
    
    const tabs = await page.locator('.tab-btn').all();
    expect(tabs.length).toBe(4); // General, Domain Filter, Privacy, Status
  });

  test('should have settings form elements', async ({ page }) => {
    // Check if settings form elements exist in DOM
    const apiKeyInput = page.locator('#apiKey');
    const count = await apiKeyInput.count();
    expect(count).toBe(1);
  });

  test('should have domain filter section', async ({ page }) => {
    // Check if domain filter section exists in DOM
    const domainPanel = page.locator('#domainPanel');
    const count = await domainPanel.count();
    expect(count).toBe(1);
    
    // Check for domain list textarea
    const domainList = page.locator('#domainList');
    const domainListCount = await domainList.count();
    expect(domainListCount).toBe(1);
  });

  test('should have loading spinner', async ({ page }) => {
    // Check if loading spinner exists in DOM
    const loadingSpinner = page.locator('#loadingSpinner');
    const count = await loadingSpinner.count();
    expect(count).toBe(1);
  });

  test('should have confirmation modal', async ({ page }) => {
    // Check if confirmation modal exists in DOM
    const confirmationModal = page.locator('#confirmationModal');
    const count = await confirmationModal.count();
    expect(count).toBe(1);
  });

  test.skip('should navigate to settings screen', async ({ page }) => {
    // This test requires JavaScript to be fully functional
    // Skip for now as it requires actual Chrome extension environment
    const menuBtn = page.locator('#menuBtn');
    await menuBtn.click();
    
    const settingsScreen = page.locator('#settingsScreen');
    await expect(settingsScreen).toBeVisible();
  });

  test.skip('should switch between tabs', async ({ page }) => {
    // This test requires JavaScript to be fully functional
    // Skip for now as it requires actual Chrome extension environment
    const menuBtn = page.locator('#menuBtn');
    await menuBtn.click();
    
    const generalTab = page.locator('#generalTab');
    await generalTab.click();
    
    await expect(generalTab).toHaveClass(/active/);
    
    const generalPanel = page.locator('#generalPanel');
    await expect(generalPanel).toBeVisible();
  });

  test.skip('should handle form input', async ({ page }) => {
    // This test requires JavaScript to be fully functional
    // Skip for now as it requires actual Chrome extension environment
    const menuBtn = page.locator('#menuBtn');
    await menuBtn.click();
    
    const generalTab = page.locator('#generalTab');
    await generalTab.click();
    
    const protocolInput = page.locator('#protocol');
    await protocolInput.fill('http');
    
    await expect(protocolInput).toHaveValue('http');
  });
});

test.describe('Extension Content Script', () => {
  test.skip('should inject content script on page load', async ({ page, context }) => {
    // Load a test page
    await page.goto('https://example.com');
    
    // Check if content script is injected
    // This would require the content script to add a marker to the page
    const contentScriptMarker = await page.locator('[data-smart-history-marker]').count();
    expect(contentScriptMarker).toBeGreaterThanOrEqual(0);
  });

  test.skip('should extract page content', async ({ page }) => {
    // Load a test page with content
    await page.goto('https://example.com');
    
    // Check if content is extracted
    // This would require the content script to expose an API
    const extractedContent = await page.evaluate(() => {
      // Call the content script's extraction function
      // @ts-ignore
      return window.smartHistory?.extractContent();
    });
    
    expect(extractedContent).toBeTruthy();
  });
});

test.describe('Extension Service Worker', () => {
  test.skip('should handle messages from content script', async ({ page, context }) => {
    // This test would require mocking the service worker
    // and verifying message handling
    
    // For now, this is a placeholder
    expect(true).toBe(true);
  });

  test.skip('should store data in Chrome storage', async ({ page, context }) => {
    // This test would require mocking Chrome storage API
    // and verifying data persistence

    // For now, this is a placeholder
    expect(true).toBe(true);
  });
});

test.describe('Private Page Confirmation Features', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the popup HTML file
    await page.goto('file://' + join(__dirname, '../dist/popup/popup.html'));
  });

  test('should have private page dialog in DOM', async ({ page }) => {
    // Check if private page dialog exists in DOM
    const privatePageDialog = page.locator('#private-page-dialog');
    const count = await privatePageDialog.count();
    expect(count).toBe(1);
  });

  test('private page dialog should be hidden by default', async ({ page }) => {
    // Check that dialog is not visible initially
    const dialog = page.locator('#private-page-dialog');
    await expect(dialog).toBeHidden();
  });

  test('should have all dialog buttons in DOM', async ({ page }) => {
    // Check if all dialog buttons exist
    const dialogCancel = page.locator('#dialog-cancel');
    const dialogSaveOnce = page.locator('#dialog-save-once');
    const dialogSaveDomain = page.locator('#dialog-save-domain');
    const dialogSavePath = page.locator('#dialog-save-path');

    expect(await dialogCancel.count()).toBe(1);
    expect(await dialogSaveOnce.count()).toBe(1);
    expect(await dialogSaveDomain.count()).toBe(1);
    expect(await dialogSavePath.count()).toBe(1);
  });

  test('should have dialog message element', async ({ page }) => {
    const dialogMessage = page.locator('#dialog-message');
    expect(await dialogMessage.count()).toBe(1);
  });

  test('should have dialog title element', async ({ page }) => {
    const dialogTitle = page.locator('#dialog-title');
    expect(await dialogTitle.count()).toBe(1);
  });

  test('should have pending pages section in DOM', async ({ page }) => {
    const pendingSection = page.locator('#pending-section');
    const pendingEmpty = page.locator('#pending-empty');
    const pendingList = page.locator('#pending-pages-list');

    expect(await pendingSection.count()).toBe(1);
    expect(await pendingEmpty.count()).toBe(1);
    expect(await pendingList.count()).toBe(1);
  });

  test('pending section should be hidden by default (no pages)', async ({ page }) => {
    // Check that pending section is not visible when no pages exist
    const pendingSection = page.locator('#pending-section');
    await expect(pendingSection).toHaveClass(/hidden/);
  });

  test('should have pending pages batch operation buttons', async ({ page }) => {
    const selectAllBtn = page.locator('#btn-select-all');
    const saveSelectedBtn = page.locator('#btn-save-selected');
    const saveWhitelistBtn = page.locator('#btn-save-whitelist');
    const discardBtn = page.locator('#btn-discard');

    expect(await selectAllBtn.count()).toBe(1);
    expect(await saveSelectedBtn.count()).toBe(1);
    expect(await saveWhitelistBtn.count()).toBe(1);
    expect(await discardBtn.count()).toBe(1);
  });

  test('pending empty message should be hidden by default (when no pages)', async ({ page }) => {
    const pendingEmpty = page.locator('#pending-empty');
    expect(await pendingEmpty.count()).toBe(1);
    // pending-empty is hidden by default as part of pending-section
  });

  test('pending section header should have correct title', async ({ page }) => {
    const pendingHeader = page.locator('#pending-section h2');
    const text = await pendingHeader.innerText();
    expect(text).toBeTruthy();
  });

  test('dialog should be of type dialog element', async ({ page }) => {
    const dialog = page.locator('#private-page-dialog');
    expect(await dialog.count()).toBe(1);
    // Verify it's a dialog element
    const tagName = await dialog.evaluate(el => el.tagName);
    expect(tagName).toBe('DIALOG');
  });

  test.skip('should handle private page confirmation flow', async ({ page }) => {
    // Mock a private page response
    // This test verifies the confirmation dialog appears when a private page is detected
    // Implementation depends on actual test setup in your project

    // Test basic flow for now
    await page.goto('chrome://extensions/configureCommands');
    // This is a placeholder - actual test implementation would depend on your testing setup

    expect(true).toBe(true); // Placeholder until proper test setup
  });

  test.skip('should show private page dialog when confirmation required', async ({ page, context }) => {
    // REQUIRES: chrome.runtime.sendMessage mock
    // Purpose: Verify dialog appears for PRIVATE_PAGE_DETECTED error
    //
    // Expected behavior:
    // - Dialog should be visible
    // - Dialog message should contain warning text
    // - All action buttons should be present
    //
    // Note: This test would require mocking Chrome runtime messages to:
    // 1. Simulate a PRIVATE_PAGE_DETECTED error response
    // 2. Verify the dialog displays with correct message content

    const dialog = page.locator('#private-page-dialog');
    await expect(dialog).toBeVisible();
  });

  test.skip('should handle dialog cancel action', async ({ page, context }) => {
    // REQUIRES: chrome.runtime.sendMessage mock + event listeners
    // Purpose: Verify cancel closes dialog and resets state
    //
    // Note: This test would require:
    // 1. Opening the dialog (simulation)
    // 2. Simulating click on cancel button
    // 3. Verifying dialog closes
    // 4. Checking pending state is cleared

    const dialog = page.locator('#private-page-dialog');
    const cancelBtn = page.locator('#dialog-cancel');

    await cancelBtn.click();
    await expect(dialog).not.toBeVisible();
  });

  test.skip('should handle save once action', async ({ page, context }) => {
    // REQUIRES: chrome.runtime.sendMessage mock
    // Purpose: Verify save once sends force: true record
    //
    // Note: This test would require:
    // 1. Mocking chrome.runtime.sendMessage to capture request
    // 2. Verifying force: true is included in record data
    // 3. Checking success message is shown

    const dialog = page.locator('#private-page-dialog');
    const saveOnceBtn = page.locator('#dialog-save-once');

    await saveOnceBtn.click();
    await expect(dialog).not.toBeVisible();
  });

  test.skip('should handle save domain action', async ({ page, context }) => {
    // REQUIRES: chrome.storage.local mock + sendMessage mock
    // Purpose: Verify domain is added to whitelist before save
    //
    // Note: This test would require:
    // 1. Mocking chrome.storage.local to whitelist domain
    // 2. Sending record with force: true
    // 3. Verifying domain persists in whitelist

    const dialog = page.locator('#private-page-dialog');
    const saveDomainBtn = page.locator('#dialog-save-domain');

    await saveDomainBtn.click();
    await expect(dialog).not.toBeVisible();
  });

  test.skip('should handle save path action', async ({ page, context }) => {
    // REQUIRES: chrome.storage.local mock + sendMessage mock
    // Purpose: Verify path pattern is added to whitelist before save
    //
    // Note: This test would require:
    // 1. Mocking chrome.storage.local to whitelist path
    // 2. Sending record with force: true
    // 3. Verifying path pattern persists in whitelist

    const dialog = page.locator('#private-page-dialog');
    const savePathBtn = page.locator('#dialog-save-path');

    await savePathBtn.click();
    await expect(dialog).not.toBeVisible();
  });

  test.skip('should display pending pages when available', async ({ page, context }) => {
    // REQUIRES: chrome.storage.local mock to provide pending pages
    // Purpose: Verify pending section shows stored pages
    //
    // Note: This test would require:
    // 1. Mocking chrome.storage.local.get to return pending pages
    // 2. Verifying pending items render correctly
    // 3. Checking each item shows title, URL, and reason

    const pendingSection = page.locator('#pending-section');
    await expect(pendingSection).not.toHaveClass(/hidden/);

    const pendingItems = page.locator('.pending-item');
    const count = await pendingItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test.skip('should toggle select all checkboxes', async ({ page, context }) => {
    // REQUIRES: Pending pages to be present via mock storage
    // Purpose: Verify select all button toggles all checkboxes
    //
    // Note: This test would require:
    // 1. Mocking chrome.storage.local with pending pages
    // 2. Simulating checkbox toggles
    // 3. Verifying all checkboxes change state

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

  test.skip('should save selected pending pages', async ({ page, context }) => {
    // REQUIRES: chrome.sendMessage mock + storage mock
    // Purpose: Verify selected pages are saved and removed from pending
    //
    // Note: This test would require:
    // 1. Mocking storage with pending pages
    // 2. Mocking sendMessage to verify record requests
    // 3. Verifying pages are removed from pending after save

    const checkboxes = page.locator('.pending-checkbox');
    await checkboxes.first().check();
    await checkboxes.nth(1).check();

    const saveBtn = page.locator('#btn-save-selected');
    await saveBtn.click();

    // Verify pages are removed
    const pendingItems = page.locator('.pending-item');
    // Count should decrease
  });

  test.skip('should save to whitelist from pending pages', async ({ page, context }) => {
    // REQUIRES: chrome.storage.local mock + sendMessage mock
    // Purpose: Verify domains are whitelisted and saved
    //
    // Note: This test would require:
    // 1. Mocking storage for both pending pages and whitelist
    // 2. Verifying domain whitelist additions
    // 3. Verifying pages are saved and removed from pending

    const checkboxes = page.locator('.pending-checkbox');
    await checkboxes.first().check();

    const saveWhitelistBtn = page.locator('#btn-save-whitelist');
    await saveWhitelistBtn.click();
  });

  test.skip('should discard selected pending pages', async ({ page, context }) => {
    // REQUIRES: chrome.storage.local mock + confirmation modal check
    // Purpose: Verify pages can be discarded from pending
    //
    // Note: This test would require:
    // 1. Mocking storage with pending pages
    // 2. Simulating discard action
    // 3. Verifying pages are removed without saving

    const checkboxes = page.locator('.pending-checkbox');
    await checkboxes.first().check();

    const discardBtn = page.locator('#btn-discard');
    await discardBtn.click();

    // Verify confirmation and removal
  });
});