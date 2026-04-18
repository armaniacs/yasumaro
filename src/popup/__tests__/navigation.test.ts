/**
 * navigation.test.ts
 * Navigation Functionality Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../screenState.js', () => ({
  getScreenState: vi.fn(),
  setScreenState: vi.fn(),
  clearScreenState: vi.fn(),
  SCREEN_STATES: {
    MAIN: 'main',
    SETTINGS: 'settings'
  }
}));

vi.mock('../autoClose.js', () => ({
  clearAutoCloseTimer: vi.fn()
}));

import { showMainScreen, showSettingsScreen, init } from '../navigation.js';
import { setScreenState, SCREEN_STATES } from '../screenState.js';
import { clearAutoCloseTimer } from '../autoClose.js';

describe('navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    global.chrome = {
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`)
      },
      tabs: {
        create: vi.fn()
      }
    } as any;

    Object.defineProperty(window, 'close', {
      writable: true,
      value: vi.fn()
    });

    document.body.innerHTML = `
      <div id="mainScreen">Main Screen</div>
      <div id="settingsScreen" style="display: none;">Settings Screen</div>
      <button id="menuBtn">Menu</button>
      <button id="backBtn">Back</button>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('showMainScreen', () => {
    it('should show main screen and hide settings screen', () => {
      const mainScreen = document.getElementById('mainScreen');
      const settingsScreen = document.getElementById('settingsScreen');
      
      expect(mainScreen.style.display).toBe('');
      expect(settingsScreen.style.display).toBe('none');
      
      showMainScreen();
      
      expect(mainScreen.style.display).toBe('block');
      expect(settingsScreen.style.display).toBe('none');
      expect(setScreenState).toHaveBeenCalledWith(SCREEN_STATES.MAIN);
    });

    it('should handle missing DOM elements gracefully', () => {
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
      const mainScreen = document.getElementById('mainScreen');
      const settingsScreen = document.getElementById('settingsScreen');

      showSettingsScreen();

      expect(clearAutoCloseTimer).toHaveBeenCalled();
      expect(global.chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://test/options.html' });
      expect(window.close).toHaveBeenCalled();
    });

    it('should handle missing DOM elements gracefully', () => {
      document.getElementById('mainScreen').remove();

      expect(() => {
        showSettingsScreen();
      }).not.toThrow();

      expect(clearAutoCloseTimer).toHaveBeenCalled();
      expect(global.chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://test/options.html' });
      expect(window.close).toHaveBeenCalled();
    });
  });

  describe('init', () => {
    it('should initialize event listeners', () => {
      setScreenState.mockImplementation(() => {});

      init();

      const menuBtn = document.getElementById('menuBtn');
      const backBtn = document.getElementById('backBtn');

      expect(menuBtn).toBeDefined();
      expect(backBtn).toBeDefined();

      const menuClickEvent = new Event('click');
      const backClickEvent = new Event('click');

      menuBtn.dispatchEvent(menuClickEvent);
      backBtn.dispatchEvent(backClickEvent);

      expect(setScreenState).toHaveBeenCalledWith(SCREEN_STATES.MAIN);
      expect(clearAutoCloseTimer).toHaveBeenCalled();
      expect(setScreenState).toHaveBeenCalledWith(SCREEN_STATES.MAIN);
    });

    it('should handle missing buttons gracefully', () => {
      document.getElementById('menuBtn').remove();
      document.getElementById('backBtn').remove();
      
      expect(() => {
        init();
      }).not.toThrow();
    });
  });
});
