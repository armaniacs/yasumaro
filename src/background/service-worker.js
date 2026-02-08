import { ObsidianClient } from './obsidianClient.js';
import { AIClient } from './aiClient.js';
import { RecordingLogic } from './recordingLogic.js';
import { validateUrlForFilterImport } from '../utils/fetch.js';

// Initialize clients
const obsidian = new ObsidianClient();
const aiClient = new AIClient();
const recordingLogic = new RecordingLogic(obsidian, aiClient);

// Cache to store tab data including content and validation status
// Key: TabID, Value: { title, url, content, isValidVisit, timestamp }
const tabCache = new Map();
let isTabCacheInitialized = false;

// Message type whitelist for security validation
const VALID_MESSAGE_TYPES = ['VALID_VISIT', 'GET_CONTENT', 'FETCH_URL', 'MANUAL_RECORD', 'PREVIEW_RECORD', 'SAVE_RECORD'];
const INVALID_SENDER_ERROR = { success: false, error: 'Invalid sender' };
const INVALID_MESSAGE_ERROR = { success: false, error: 'Invalid message' };

// Lazy initialization: Execute query only on first message received
async function initializeTabCache() {
  if (!isTabCacheInitialized) {
    isTabCacheInitialized = true;
    return new Promise((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.url && tab.url.startsWith('http')) {
            tabCache.set(tab.id, {
              title: tab.title,
              url: tab.url,
              favIconUrl: tab.favIconUrl,
              lastUpdated: Date.now(),
              isValidVisit: false,
              content: null
            });
          }
        });
        resolve();
      });
    });
  }
}

// Initialize cache with currently open tabs (basic info only) - DEPRECATED: Now using lazy initialization
// chrome.tabs.query({}, (tabs) => {
//   tabs.forEach(tab => {
//     if (tab.url && tab.url.startsWith('http')) {
//       tabCache.set(tab.id, {
//         title: tab.title,
//         url: tab.url,
//         favIconUrl: tab.favIconUrl,
//         lastUpdated: Date.now(),
//         isValidVisit: false,
//         content: null
//       });
//     }
//   });
// });

// Update cache on navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    tabCache.set(tabId, {
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl,
      lastUpdated: Date.now(),
      isValidVisit: false, // Reset validity on new page load
      content: null
    });
  }
});

// Listen for messages from Content Script
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  // Initialize tab cache on first message
  await initializeTabCache();

  // Sender validation: Only accept messages from Content Script
  if (!sender.tab || !sender.tab.id || !sender.tab.url) {
    sendResponse(INVALID_SENDER_ERROR);
    return;
  }

  async function handleMessage() {
    // Message payload structure validation
    if (!message || typeof message !== 'object') {
      return INVALID_MESSAGE_ERROR;
    }
    if (!VALID_MESSAGE_TYPES.includes(message.type)) {
      return INVALID_MESSAGE_ERROR;
    }
    if (message.payload === undefined || typeof message.payload !== 'object') {
      return INVALID_MESSAGE_ERROR;
    }

    // Automatic Visit Processing
    if (message.type === 'VALID_VISIT' && sender.tab) {
      const result = await recordingLogic.record({
        title: sender.tab.title,
        url: sender.tab.url,
        content: message.payload?.content || '',
        skipDuplicateCheck: false
      });

      // Update cache
      tabCache.set(sender.tab.id, {
        ...tabCache.get(sender.tab.id),
        title: sender.tab.title,
        url: sender.tab.url,
        content: message.payload?.content || '',
        isValidVisit: true
      });

      return result;
    }

    // Fetch URL Content (CORS Bypass for Popup)
    if (message.type === 'FETCH_URL') {
      try {
        // SSRF対策: 内部ネットワークブロック
        validateUrlForFilterImport(message.payload.url);

        const response = await fetch(message.payload.url, {
          method: 'GET',
          cache: 'no-cache'
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type');
        const text = await response.text();

        return { success: true, data: text, contentType };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    // Manual Record Processing & Preview
    if (message.type === 'MANUAL_RECORD' || message.type === 'PREVIEW_RECORD') {
      return await recordingLogic.record({
        title: message.payload.title,
        url: message.payload.url,
        content: message.payload.content,
        force: message.payload.force,
        skipDuplicateCheck: true,
        previewOnly: message.type === 'PREVIEW_RECORD'
      });
    }

    // Save Confirmed Record (Post-Preview)
    if (message.type === 'SAVE_RECORD') {
      return await recordingLogic.record({
        title: message.payload.title,
        url: message.payload.url,
        content: message.payload.content,
        skipDuplicateCheck: true,
        alreadyProcessed: true,
        force: message.payload.force
      });
    }

    return null;
  }

  handleMessage().then(sendResponse);
  return true;
});

// Handle Tab Closure - Cleanup only
chrome.tabs.onRemoved.addListener((tabId) => {
  tabCache.delete(tabId);
});