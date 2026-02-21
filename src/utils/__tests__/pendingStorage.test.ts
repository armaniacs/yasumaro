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
});