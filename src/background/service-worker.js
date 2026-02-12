import { ObsidianClient } from './obsidianClient.js';
import { AIClient } from './aiClient.js';
import { RecordingLogic } from './recordingLogic.js';
import { validateUrlForFilterImport, fetchWithTimeout } from '../utils/fetch.js';
import { getAllowedUrls, getSettings, buildAllowedUrls, saveSettingsWithAllowedUrls } from '../utils/storage.js';
import { createErrorResponse, convertKnownErrorMessage } from '../utils/errorMessages.js';

// Initialize clients
const obsidian = new ObsidianClient();
const aiClient = new AIClient();
const recordingLogic = new RecordingLogic(obsidian, aiClient);

// Cache to store tab data including content and validation status
// Key: TabID, Value: { title, url, content, isValidVisit, timestamp }
const tabCache = new Map();
let isTabCacheInitialized = false;

// Message type whitelist for security validation
const VALID_MESSAGE_TYPES = ['VALID_VISIT', 'GET_CONTENT', 'FETCH_URL', 'MANUAL_RECORD', 'PREVIEW_RECORD', 'SAVE_RECORD', 'TEST_CONNECTIONS'];
const INVALID_SENDER_ERROR = { success: false, error: 'Invalid sender' };
const INVALID_MESSAGE_ERROR = { success: false, error: 'Invalid message' };

// 【パフォーマンス改善】: Service Worker初期化遅延
// TabCacheが必要になるまで初期化を遅延させる
// 全タブのクエリを避け、必要なタブIDのみを扱う
let initializationPromise = null;

/**
 * TabCacheを初期化する
 * 【Code Review #2】: フラグベースのアプローチを簡素化
 * initializationPromiseによる重複防止のみを使用
 * @returns {Promise<void>}
 */
async function initializeTabCache() {
  // 既に初期化済みまたは初期化中ならスキップ
  if (initializationPromise) return initializationPromise;

  initializationPromise = new Promise((resolve) => {
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
      isTabCacheInitialized = true;
      resolve();
    });
  });
  return initializationPromise;
}

/**
 * 特定タブ情報をキャッシュに追加（初期化なしで直接追加）
 * 【改善】: 全タブ初期化を回避し、必要なタブのみを追加
 * @param {Object} tab - タブ情報
 */
function addTabToCache(tab) {
  if (tab.id && tab.url && tab.url.startsWith('http')) {
    tabCache.set(tab.id, {
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl,
      lastUpdated: Date.now(),
      isValidVisit: false,
      content: null
    });
  }
}

/**
 * 特定タブ情報をキャッシュから取得（初期化不要）
 * 【改善】: 全タブ初期化を回避し、必要なタブのみを取得
 * @param {number} tabId - タブID
 * @returns {Object|null} タブ情報またはnull
 */
function getTabFromCache(tabId) {
  return tabCache.get(tabId) || null;
}

// Listen for messages from Content Script and Popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const process = async () => {
    try {
      // 【パフォーマンス改善】: メッセージハンドラ関数をインライン化
      // TabCache初期化を必要な場合のみ実行

      // Message payload structure validation
      if (!message || typeof message !== 'object') {
        sendResponse(INVALID_MESSAGE_ERROR);
        return;
      }
      if (!VALID_MESSAGE_TYPES.includes(message.type)) {
        sendResponse(INVALID_MESSAGE_ERROR);
        return;
      }
      if (message.payload === undefined || typeof message.payload !== 'object') {
        sendResponse(INVALID_MESSAGE_ERROR);
        return;
      }

      // Sender validation: Content Script only message types
      const CONTENT_SCRIPT_ONLY_TYPES = ['VALID_VISIT'];
      if (CONTENT_SCRIPT_ONLY_TYPES.includes(message.type)) {
        if (!sender.tab || !sender.tab.id || !sender.tab.url) {
          sendResponse(INVALID_SENDER_ERROR);
          return;
        }
        // 【Code Review #2】: フラグ設定を削除（簡素化）
      }

      // 【パフォーマンス改善】: 必要な場合のみTabCache初期化
      // messages that don't need tab cache: TEST_CONNECTIONS
      if (message.type !== 'TEST_CONNECTIONS') {
        await initializeTabCache();
      }

      // Automatic Visit Processing (Content Script only)
      if (message.type === 'VALID_VISIT' && sender.tab) {
        // 【パフォーマンス改善】: 直接キャッシュにタブを追加
        addTabToCache(sender.tab);

        const result = await recordingLogic.record({
          title: sender.tab.title,
          url: sender.tab.url,
          content: message.payload?.content || '',
          skipDuplicateCheck: false
        });

        // 【パフォーマンス改善】: 直接キャッシュを更新
        tabCache.set(sender.tab.id, {
          ...getTabFromCache(sender.tab.id),
          title: sender.tab.title,
          url: sender.tab.url,
          content: message.payload?.content || '',
          isValidVisit: true
        });

        sendResponse(result);
        return;
      }

      // Fetch URL Content (CORS Bypass for Popup)
      if (message.type === 'FETCH_URL') {
        try {
          // SSRF対策: 内部ネットワークブロック
          validateUrlForFilterImport(message.payload.url);

          // 許可されたURLのリストを動的に構築（Deadlock回避）
          const settings = await getSettings();
          const allowedUrls = buildAllowedUrls(settings);

          const response = await fetchWithTimeout(message.payload.url, {
            method: 'GET',
            cache: 'no-cache',
            allowedUrls // 最新の動的URL検証リストを使用
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const contentType = response.headers.get('content-type');
          const text = await response.text();

          sendResponse({ success: true, data: text, contentType });
        } catch (error) {
          console.error('Fetch URL Error:', error);
          // P2: 技術情報漏洩対策 - ユーザー向けメッセージに変換
          sendResponse(createErrorResponse(error, { url: message.payload?.url }));
        }
        return;
      }

      // Connection Test (Obsidian + AI)
      if (message.type === 'TEST_CONNECTIONS') {
        // 【パフォーマンス改善】: 接続テストはTabCacheを必要としない
        const obsidianResult = await obsidian.testConnection();
        const aiResult = await aiClient.testConnection();
        sendResponse({ success: true, obsidian: obsidianResult, ai: aiResult });
        return;
      }

      // Manual Record Processing & Preview
      if (message.type === 'MANUAL_RECORD' || message.type === 'PREVIEW_RECORD') {
        const result = await recordingLogic.record({
          title: message.payload.title,
          url: message.payload.url,
          content: message.payload.content,
          force: message.payload.force,
          skipDuplicateCheck: true,
          previewOnly: message.type === 'PREVIEW_RECORD'
        });
        sendResponse(result);
        return;
      }

      // Save Confirmed Record (Post-Preview)
      if (message.type === 'SAVE_RECORD') {
        const result = await recordingLogic.record({
          title: message.payload.title,
          url: message.payload.url,
          content: message.payload.content,
          skipDuplicateCheck: true,
          alreadyProcessed: true,
          force: message.payload.force
        });
        sendResponse(result);
        return;
      }

      sendResponse(null);
    } catch (error) {
      console.error('Service Worker Error:', error);
      // P2: 技術情報漏洩対策 - ユーザー向けメッセージに変換
      sendResponse(createErrorResponse(error));
    }
  };

  process();
  return true; // Keep port open for async response
});

// Handle Tab Closure - Cleanup only
chrome.tabs.onRemoved.addListener((tabId) => {
  tabCache.delete(tabId);
});

// Extension Startup / Installation initialization
const initializeExtension = async () => {
  try {
    const settings = await getSettings();
    await saveSettingsWithAllowedUrls(settings);
    console.log('Extension initialized: Allowed URLs list rebuilt.');
  } catch (error) {
    console.error('Failed to initialize extension:', error);
  }
};

chrome.runtime.onInstalled.addListener(initializeExtension);
chrome.runtime.onStartup.addListener(initializeExtension);