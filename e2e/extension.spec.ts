import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * E2E Tests for Obsidian Smart History Chrome Extension
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

  test('should have pending pages section in DOM', async ({ page }) => {
    const pendingSection = page.locator('#pending-section');
    const pendingEmpty = page.locator('#pending-empty');
    const pendingList = page.locator('#pending-pages-list');

    expect(await pendingSection.count()).toBe(1);
    expect(await pendingEmpty.count()).toBe(1);
    expect(await pendingList.count()).toBe(1);
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
    // This test would require:
    // 1. Mocking Chrome runtime messages
    // 2. Simulating a PRIVATE_PAGE_DETECTED error
    // 3. Verifying the dialog appears with correct message

    // Expected behavior:
    // - Dialog should be visible
    // - Dialog message should contain warning text
    // - All action buttons should be present

    const dialog = page.locator('#private-page-dialog');
    await expect(dialog).toBeVisible();
  });

  test.skip('should handle dialog cancel action', async ({ page, context }) => {
    // This test would verify:
    // 1. Clicking cancel closes the dialog
    // 2. Should clear pending save state
    // 3. Status message should show cancelled state

    const dialog = page.locator('#private-page-dialog');
    const cancelBtn = page.locator('#dialog-cancel');

    await cancelBtn.click();
    await expect(dialog).not.toBeVisible();
  });

  test.skip('should handle save once action', async ({ page, context }) => {
    // This test would verify:
    // 1. Clicking save once closes the dialog
    // 2. Sends record message with force: true
    // 3. Shows success message on completion

    const dialog = page.locator('#private-page-dialog');
    const saveOnceBtn = page.locator('#dialog-save-once');

    await saveOnceBtn.click();
    await expect(dialog).not.toBeVisible();
  });

  test.skip('should handle save domain action', async ({ page, context }) => {
    // This test would verify:
    // 1. Clicking save domain closes the dialog
    // 2. Adds domain to whitelist
    // 3. Sends record message with force: true

    const dialog = page.locator('#private-page-dialog');
    const saveDomainBtn = page.locator('#dialog-save-domain');

    await saveDomainBtn.click();
    await expect(dialog).not.toBeVisible();
  });

  test.skip('should handle save path action', async ({ page, context }) => {
    // This test would verify:
    // 1. Clicking save path closes the dialog
    // 2. Adds full path to whitelist
    // 3. Sends record message with force: true

    const dialog = page.locator('#private-page-dialog');
    const savePathBtn = page.locator('#dialog-save-path');

    await savePathBtn.click();
    await expect(dialog).not.toBeVisible();
  });

  test.skip('should display pending pages when available', async ({ page, context }) => {
    // This test would verify:
    // 1. Pending section is visible when pages exist
    // 2. Each pending page shows title and reason
    // 3. Checkboxes are present for each item

    const pendingSection = page.locator('#pending-section');
    await expect(pendingSection).not.toHaveClass(/hidden/);

    const pendingItems = page.locator('.pending-item');
    const count = await pendingItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test.skip('should hide pending section when no pages available', async ({ page, context }) => {
    // This test would verify:
    // 1. Pending section is hidden when no pages
    // 2. Empty state message is visible

    const pendingSection = page.locator('#pending-section');
    const pendingEmpty = page.locator('#pending-empty');

    await expect(pendingSection).toHaveClass(/hidden/);
    await expect(pendingEmpty).not.toHaveClass(/hidden/);
  });

  test.skip('should toggle select all checkboxes', async ({ page, context }) => {
    // This test would verify:
    // 1. Click select all to check all checkboxes
    // 2. Click again to uncheck all

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
    // This test would verify:
    // 1. Select multiple checkboxes
    // 2. Click save selected
    // 3. Pages are removed from pending list

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
    // This test would verify:
    // 1. Select multiple checkboxes
    // 2. Click save with whitelist
    // 3. Domains are added to whitelist
    // 4. Pages are removed from pending list

    const checkboxes = page.locator('.pending-checkbox');
    await checkboxes.first().check();

    const saveWhitelistBtn = page.locator('#btn-save-whitelist');
    await saveWhitelistBtn.click();
  });

  test.skip('should discard selected pending pages', async ({ page, context }) => {
    // This test would verify:
    // 1. Select multiple checkboxes
    // 2. Click discard
    // 3. Confirmation dialog appears
    // 4. Pages are removed from pending list

    const checkboxes = page.locator('.pending-checkbox');
    await checkboxes.first().check();

    const discardBtn = page.locator('#btn-discard');
    await discardBtn.click();

    // Verify confirmation and removal
  });
});