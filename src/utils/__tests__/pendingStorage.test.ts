import { addPendingPage, getPendingPages, removePendingPages, clearExpiredPages } from '../pendingStorage';
import { getSettings, saveSettings } from '../storage';

jest.mock('../storage');

describe('pendingStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('addPendingPage', () => {
    it('should add a pending page to storage', async () => {
      const mockSettings = {};
      (getSettings as jest.Mock).mockResolvedValue(mockSettings);
      (saveSettings as jest.Mock).mockResolvedValue();

      const pendingPage = {
        url: 'https://example.com/page',
        title: 'Test Page',
        timestamp: Date.now(),
        reason: 'cache-control' as const,
        headerValue: 'Cache-Control: private',
        expiry: Date.now() + 24 * 60 * 60 * 1000
      };

      await addPendingPage(pendingPage);

      expect(saveSettings).toHaveBeenCalledWith({
        pendingPages: [pendingPage]
      });
    });

    it('should exclude duplicate pages with same URL', async () => {
      const mockSettings = {
        pendingPages: [
          {
            url: 'https://example.com/page',
            title: 'Test Page',
            timestamp: Date.now(),
            reason: 'cache-control' as const,
            headerValue: 'Cache-Control: private',
            expiry: Date.now() + 24 * 60 * 60 * 1000
          }
        ]
      };
      (getSettings as jest.Mock).mockResolvedValue(mockSettings);
      (saveSettings as jest.Mock).mockResolvedValue();

      const duplicatePage = {
        url: 'https://example.com/page',
        title: 'Updated Test Page',
        timestamp: Date.now() + 1000,
        reason: 'set-cookie' as const,
        headerValue: 'Set-Cookie: session=abc',
        expiry: Date.now() + 24 * 60 * 60 * 1000
      };

      await addPendingPage(duplicatePage);

      // Should not call saveSettings because duplicate was excluded
      expect(saveSettings).not.toHaveBeenCalled();
    });

  });

  describe('getPendingPages', () => {
    it('should return all pending pages', async () => {
      const pendingPage = {
        url: 'https://example.com/page',
        title: 'Test Page',
        timestamp: Date.now(),
        reason: 'cache-control' as const,
        headerValue: 'Cache-Control: private',
        expiry: Date.now() + 24 * 60 * 60 * 1000
      };

      (getSettings as jest.Mock).mockResolvedValue({
        pendingPages: [pendingPage]
      });

      const result = await getPendingPages();

      expect(result).toEqual([pendingPage]);
    });

    it('should expire pages past expiry time', async () => {
      const expiredPage = {
        url: 'https://example.com/expired',
        title: 'Expired Page',
        timestamp: Date.now() - 25 * 60 * 60 * 1000,
        reason: 'cache-control' as const,
        expiry: Date.now() - 1000
      };

      const validPage = {
        url: 'https://example.com/valid',
        title: 'Valid Page',
        timestamp: Date.now(),
        reason: 'cache-control' as const,
        expiry: Date.now() + 24 * 60 * 60 * 1000
      };

      (getSettings as jest.Mock).mockResolvedValue({
        pendingPages: [expiredPage, validPage]
      });

      const result = await getPendingPages();

      expect(result).toEqual([validPage]);
    });
  });
});