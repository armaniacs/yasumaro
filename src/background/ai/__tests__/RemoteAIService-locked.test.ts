import { describe, it, expect, vi } from 'vitest';
import { RemoteAIService } from '../RemoteAIService.js';
import type { SettingsReader } from '../../../utils/storage/SettingsRepository.js';

vi.mock('../../../utils/auditLog.js', () => ({ recordAuditLog: vi.fn() }));

function makeRepo(settings: Record<string, unknown>): SettingsReader {
  return {
    getAll: vi.fn().mockResolvedValue(settings),
    getMany: vi.fn(),
  };
}

describe('RemoteAIService — locked session', () => {
  it('fails with a lock error without sending any request', async () => {
    global.fetch = vi.fn();
    try {
      const service = new RemoteAIService({
        repo: makeRepo({
          ai_provider_priority_list: [{ provider: 'openai' }],
          ai_provider: 'openai',
          summary_min_length: 0,
          openai_api_key: { iv: 'a', ciphertext: 'b' },
        }),
      });

      const result = await service.generateSummary('content', { url: 'https://example.com' });

      expect(result.success).toBe(false);
      expect(result.summary).toContain('master password');
      expect(result.summary).not.toContain('Failed to generate summary');
      expect(result.failure?.kind).toBe('configuration');
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      (global.fetch as ReturnType<typeof vi.fn>).mockRestore();
    }
  });
});
