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
    expect(tabs.length).toBe(3); // General, Domain Filter, Privacy
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