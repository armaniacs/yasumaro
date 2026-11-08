// @vitest-environment jsdom
/**
 * navigation.test.ts
 * Navigation Functionality Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../screenState.js', () => ({
  getScreenState: vi.fn(),
  setScreenState: vi.fn(),
  SCREEN_STATES: {
    MAIN: 'main',
    SETTINGS: 'settings'
  }
}));

vi.mock('../autoClose.js', () => ({
  clearAutoCloseTimer: vi.fn()
}));

const mockLogError = vi.hoisted(() => vi.fn());
vi.mock('../../utils/logger/types.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: { INTERNAL_ERROR: 'INT_001' },
  }),
);
vi.mock('../../utils/logger/core.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: { INTERNAL_ERROR: 'INT_001' },
  }),
);
vi.mock('../../utils/logger/api.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: { INTERNAL_ERROR: 'INT_001' },
  }),
);

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
        create: vi.fn(() => Promise.resolve({ id: 1 }))
      },
      i18n: {
        getMessage: vi.fn((key: string) => key),
        getUILanguage: vi.fn(() => 'en')
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
      <div id="mainStatus"></div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('showMainScreen', () => {
    it('should show main screen and hide settings screen', () => {
      const mainScreen = document.getElementById('mainScreen')!;
      const settingsScreen = document.getElementById('settingsScreen')!;
      
      expect(mainScreen.style.display).toBe('');
      expect(settingsScreen.style.display).toBe('none');
      
      showMainScreen();
      
      expect(mainScreen.style.display).toBe('block');
      expect(settingsScreen.style.display).toBe('none');
      expect(setScreenState).toHaveBeenCalledWith(SCREEN_STATES.MAIN);
    });

    it('should handle missing DOM elements gracefully', () => {
      document.getElementById('settingsScreen')!.remove();
      
      expect(() => {
        showMainScreen();
      }).not.toThrow();
      
      const mainScreen = document.getElementById('mainScreen')!;
      expect(mainScreen.style.display).toBe('block');
      expect(setScreenState).toHaveBeenCalledWith(SCREEN_STATES.MAIN);
    });
  });

  describe('showSettingsScreen', () => {
    it('should show settings screen and hide main screen', async () => {
      const mainScreen = document.getElementById('mainScreen')!;
      const settingsScreen = document.getElementById('settingsScreen')!;

      await showSettingsScreen();

      expect(clearAutoCloseTimer).toHaveBeenCalled();
      expect(global.chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://test/options.html' });
      expect(window.close).toHaveBeenCalled();
    });

    it('should handle missing DOM elements gracefully', async () => {
      document.getElementById('mainScreen')!.remove();

      await expect(showSettingsScreen()).resolves.toBeUndefined();

      expect(clearAutoCloseTimer).toHaveBeenCalled();
      expect(global.chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://test/options.html' });
      expect(window.close).toHaveBeenCalled();
    });

    it('keeps the popup open and surfaces the failure when tab creation rejects', async () => {
      vi.mocked(global.chrome.tabs.create).mockRejectedValueOnce(new Error('tabs.create failed'));

      await showSettingsScreen();

      expect(window.close).not.toHaveBeenCalled();
      const status = document.getElementById('mainStatus')!;
      expect(status.textContent).toContain('tabs.create failed');
      expect(status.className).toBe('status-message error');
      expect(mockLogError).toHaveBeenCalledWith(
        '[navigation] Failed to open a page in a new tab',
        expect.objectContaining({ cause: expect.any(Error) }),
        'INT_001',
      );
    });

    it('keeps the popup open when tab creation throws synchronously', async () => {
      vi.mocked(global.chrome.tabs.create).mockImplementationOnce(() => {
        throw new Error('tabs.create sync failure');
      });

      await showSettingsScreen();

      expect(window.close).not.toHaveBeenCalled();
      expect(document.getElementById('mainStatus')!.textContent).toContain('tabs.create sync failure');
      expect(mockLogError).toHaveBeenCalled();
    });
  });

  describe('init', () => {
    it('should initialize event listeners', () => {
      vi.mocked(setScreenState).mockImplementation(() => {});

      init();

      const menuBtn = document.getElementById('menuBtn')!;
      const backBtn = document.getElementById('backBtn')!;

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
      document.getElementById('menuBtn')!.remove();
      document.getElementById('backBtn')!.remove();
      
      expect(() => {
        init();
      }).not.toThrow();
    });
  });
});
