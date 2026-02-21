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

      const now = Date.now();
      const pendingPage = {
        url: 'https://example.com/page',
        title: 'Test Page',
        timestamp: now,
        reason: 'cache-control' as const,
        headerValue: 'Cache-Control: private',
        expiry: now + 24 * 60 * 60 * 1000
      };

      await addPendingPage(pendingPage);

      expect(saveSettings).toHaveBeenCalledWith({
        pendingPages: [pendingPage]
      });
    });

    it('should exclude duplicate pages with same URL', async () => {
      const now = Date.now();
      const mockSettings = {
        pendingPages: [
          {
            url: 'https://example.com/page',
            title: 'Test Page',
            timestamp: now,
            reason: 'cache-control' as const,
            headerValue: 'Cache-Control: private',
            expiry: now + 24 * 60 * 60 * 1000
          }
        ]
      };
      (getSettings as jest.Mock).mockResolvedValue(mockSettings);
      (saveSettings as jest.Mock).mockResolvedValue();

      const duplicatePage = {
        url: 'https://example.com/page',
        title: 'Updated Test Page',
        timestamp: now + 1000,
        reason: 'set-cookie' as const,
        headerValue: 'Set-Cookie: session=abc',
        expiry: now + 24 * 60 * 60 * 1000
      };

      await addPendingPage(duplicatePage);

      // Should not call saveSettings because duplicate was excluded
      expect(saveSettings).not.toHaveBeenCalled();
    });

  });

  describe('getPendingPages', () => {
    it('should return all pending pages', async () => {
      const now = Date.now();
      const pendingPage = {
        url: 'https://example.com/page',
        title: 'Test Page',
        timestamp: now,
        reason: 'cache-control' as const,
        headerValue: 'Cache-Control: private',
        expiry: now + 24 * 60 * 60 * 1000
      };

      (getSettings as jest.Mock).mockResolvedValue({
        pendingPages: [pendingPage]
      });

      const result = await getPendingPages();

      expect(result).toEqual([pendingPage]);
    });

    it('should expire pages past expiry time', async () => {
      const now = Date.now();
      const expiredPage = {
        url: 'https://example.com/expired',
        title: 'Expired Page',
        timestamp: now - 25 * 60 * 60 * 1000,
        reason: 'cache-control' as const,
        expiry: now - 1000
      };

      const validPage = {
        url: 'https://example.com/valid',
        title: 'Valid Page',
        timestamp: now,
        reason: 'cache-control' as const,
        expiry: now + 24 * 60 * 60 * 1000
      };

      (getSettings as jest.Mock).mockResolvedValue({
        pendingPages: [expiredPage, validPage]
      });

      const result = await getPendingPages();

      expect(result).toEqual([validPage]);
    });
  });

  describe('removePendingPages', () => {
    it('should remove specified pages', async () => {
      const now = Date.now();
      const pages = [
        { url: 'https://example.com/page1', title: 'Page 1', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now + 86400000 },
        { url: 'https://example.com/page2', title: 'Page 2', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now + 86400000 }
      ];

      (getSettings as jest.Mock).mockResolvedValue({ pendingPages: pages });
      (saveSettings as jest.Mock).mockResolvedValue();

      await removePendingPages(['https://example.com/page1']);

      expect(saveSettings).toHaveBeenCalledWith({
        pendingPages: [pages[1]]
      });
    });

    it('should remove multiple specified pages', async () => {
      const now = Date.now();
      const pages = [
        { url: 'https://example.com/page1', title: 'Page 1', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now + 86400000 },
        { url: 'https://example.com/page2', title: 'Page 2', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now + 86400000 },
        { url: 'https://example.com/page3', title: 'Page 3', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now + 86400000 }
      ];

      (getSettings as jest.Mock).mockResolvedValue({ pendingPages: pages });
      (saveSettings as jest.Mock).mockResolvedValue();

      await removePendingPages(['https://example.com/page1', 'https://example.com/page3']);

      expect(saveSettings).toHaveBeenCalledWith({
        pendingPages: [pages[1]]
      });
    });

    it('should handle empty list of URLs to remove', async () => {
      const now = Date.now();
      const pages = [
        { url: 'https://example.com/page1', title: 'Page 1', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now + 86400000 }
      ];

      (getSettings as jest.Mock).mockResolvedValue({ pendingPages: pages });
      (saveSettings as jest.Mock).mockResolvedValue();

      await removePendingPages([]);

      expect(saveSettings).toHaveBeenCalledWith({
        pendingPages: pages
      });
    });
  });

  describe('clearExpiredPages', () => {
    it('should clear expired pages', async () => {
      const now = Date.now();
      const pages = [
        { url: 'https://example.com/expired', title: 'Expired', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now - 1000 },
        { url: 'https://example.com/valid', title: 'Valid', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now + 86400000 }
      ];

      (getSettings as jest.Mock).mockResolvedValue({ pendingPages: pages });
      (saveSettings as jest.Mock).mockResolvedValue();

      await clearExpiredPages();

      expect(saveSettings).toHaveBeenCalledWith({
        pendingPages: [pages[1]]
      });
    });

    it('should clear all pages when all are expired', async () => {
      const now = Date.now();
      const pages = [
        { url: 'https://example.com/expired1', title: 'Expired 1', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now - 1000 },
        { url: 'https://example.com/expired2', title: 'Expired 2', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now - 2000 }
      ];

      (getSettings as jest.Mock).mockResolvedValue({ pendingPages: pages });
      (saveSettings as jest.Mock).mockResolvedValue();

      await clearExpiredPages();

      expect(saveSettings).toHaveBeenCalledWith({
        pendingPages: []
      });
    });

    it('should keep all pages when none are expired', async () => {
      const now = Date.now();
      const pages = [
        { url: 'https://example.com/valid1', title: 'Valid 1', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now + 86400000 },
        { url: 'https://example.com/valid2', title: 'Valid 2', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now + 86400000 }
      ];

      (getSettings as jest.Mock).mockResolvedValue({ pendingPages: pages });
      (saveSettings as jest.Mock).mockResolvedValue();

      await clearExpiredPages();

      expect(saveSettings).toHaveBeenCalledWith({
        pendingPages: pages
      });
    });
  });
});