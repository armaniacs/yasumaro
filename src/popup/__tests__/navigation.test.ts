/**
 * navigation.test.js
 * Navigation Functionality Tests
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
// 【修正】: モック化されるモジュールのインポートはjest.mockの前に実行
import { showMainScreen, showSettingsScreen, init } from 'src/popup/navigation.js';

// Mock screenState module (must be defined before import sync import)
jest.mock('src/popup/screenState.js', () => ({
  getScreenState: jest.fn(),
  setScreenState: jest.fn(),
  clearScreenState: jest.fn(),
  SCREEN_STATES: {
    MAIN: 'main',
    SETTINGS: 'settings'
  }
}));

// Mock autoClose module
jest.mock('src/popup/autoClose.js', () => ({
  clearAutoCloseTimer: jest.fn()
}));

// 【修正】: モック化された関数をインポート
// インポートは jest.mock の後に行う必要がある
import { setScreenState, SCREEN_STATES } from 'src/popup/screenState.js';
import { clearAutoCloseTimer } from 'src/popup/autoClose.js';

describe('navigation', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // jsdomを使用したDOM要素の作成
    document.body.innerHTML = `
      <div id="mainScreen">Main Screen</div>
      <div id="settingsScreen" style="display: none;">Settings Screen</div>
      <button id="menuBtn">Menu</button>
      <button id="backBtn">Back</button>
    `;
  });

  afterEach(() => {
    // Clean up DOM
    document.body.innerHTML = '';
  });

  describe('showMainScreen', () => {
    it('should show main screen and hide settings screen', () => {
      // Get DOM elements
      const mainScreen = document.getElementById('mainScreen');
      const settingsScreen = document.getElementById('settingsScreen');
      
      // Initially settings screen is hidden
      expect(mainScreen.style.display).toBe('');
      expect(settingsScreen.style.display).toBe('none');
      
      showMainScreen();
      
      // After calling showMainScreen, main screen should be visible
      expect(mainScreen.style.display).toBe('block');
      expect(settingsScreen.style.display).toBe('none');
      expect(setScreenState).toHaveBeenCalledWith(SCREEN_STATES.MAIN);
    });

    it('should handle missing DOM elements gracefully', () => {
      // Remove settings screen from DOM
      document.getElementById('settingsScreen').remove();
      
      expect(() => {
        showMainScreen();
      }).not.toThrow();
      
      const mainScreen = document.getElementById('mainScreen');
      expect(mainScreen.style.display).toBe('block');
      expect(setScreenState).toHaveBeenCalledWith(SCREEN_STATES.MAIN);
    });
  });

  describe('showSettingsScreen', () => {
    it('should show settings screen and hide main screen', () => {
      // Get DOM elements
      const mainScreen = document.getElementById('mainScreen');
      const settingsScreen = document.getElementById('settingsScreen');
      
      showSettingsScreen();
      
      // After calling showSettingsScreen, settings screen should be visible
      expect(settingsScreen.style.display).toBe('block');
      expect(mainScreen.style.display).toBe('none');
      expect(clearAutoCloseTimer).toHaveBeenCalled();
      expect(setScreenState).toHaveBeenCalledWith(SCREEN_STATES.SETTINGS);
    });

    it('should handle missing DOM elements gracefully', () => {
      // Remove main screen from DOM
      document.getElementById('mainScreen').remove();
      
      expect(() => {
        showSettingsScreen();
      }).not.toThrow();
      
      const settingsScreen = document.getElementById('settingsScreen');
      expect(settingsScreen.style.display).toBe('block');
      expect(clearAutoCloseTimer).toHaveBeenCalled();
      expect(setScreenState).toHaveBeenCalledWith(SCREEN_STATES.SETTINGS);
    });
  });

  describe('init', () => {
    it('should initialize event listeners', () => {
      // 【修正】: setScreenStateは同期関数なので mockResolvedValue ではなく mockImplementation を使用
      // 🟢 信頼性レベル: テスト失敗によるバグ特定
    // @ts-expect-error - jest.fn() type narrowing issue
  
      setScreenState.mockImplementation(() => {});

      init();
      
      // Check if event listeners are attached
      const menuBtn = document.getElementById('menuBtn');
      const backBtn = document.getElementById('backBtn');
      
      expect(menuBtn).toBeDefined();
      expect(backBtn).toBeDefined();
      
      // Trigger click events
      const menuClickEvent = new Event('click');
      const backClickEvent = new Event('click');
      
      menuBtn.dispatchEvent(menuClickEvent);
      backBtn.dispatchEvent(backClickEvent);
      
      // Verify that the functions were called
      expect(clearAutoCloseTimer).toHaveBeenCalled();
      expect(setScreenState).toHaveBeenCalledWith(SCREEN_STATES.SETTINGS);
      expect(setScreenState).toHaveBeenCalledWith(SCREEN_STATES.MAIN);
    });

    it('should handle missing buttons gracefully', () => {
      // Remove buttons from DOM
      document.getElementById('menuBtn').remove();
      document.getElementById('backBtn').remove();
      
      expect(() => {
        init();
      }).not.toThrow();
    });
  });
});