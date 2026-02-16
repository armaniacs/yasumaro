// src/background/__tests__/notificationHelper.test.js
import { NotificationHelper } from '../notificationHelper.js';

describe('NotificationHelper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Chrome notifications APIが存在する場合のみモック
    if (!chrome.notifications) {
      chrome.notifications = { create: jest.fn() };
    }
    // Chrome runtime APIをモック
    if (!chrome.runtime) {
      chrome.runtime = { getURL: jest.fn((path) => `chrome-extension://mock-id/${path}`) };
    } else if (!chrome.runtime.getURL) {
      chrome.runtime.getURL = jest.fn((path) => `chrome-extension://mock-id/${path}`);
    }
  });

  describe('notifySuccess', () => {
    it('should create success notification', () => {
      NotificationHelper.notifySuccess('Test Title', 'Test Message');

      expect(chrome.notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Test Title',
          message: 'Test Message'
        })
      );
    });
  });

  describe('notifyError', () => {
    it('should create error notification', () => {
      NotificationHelper.notifyError('Test Error');

      expect(chrome.notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('Failed'),
          message: expect.stringContaining('Test Error')
        })
      );
    });
  });
});