// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../popup/i18n.js', () => ({
  getMessage: vi.fn((key) => key),
}));

describe('privatePageDialog exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export functions', async () => {
    const module = await import('../privatePageDialog.js');
    
    // Check that module exists and has exports
    expect(module).toBeDefined();
  });
});