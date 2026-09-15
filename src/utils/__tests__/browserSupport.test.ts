/**
 * browserSupport.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supportsSidePanel, supportsOffscreen, supportsFavicon, getBrowserName, getBuiltInAIFlagGuidance, getBuiltInAIDiskSpace, formatGigabytes } from '../browserSupport.js';

const GIB = 1024 * 1024 * 1024;

describe('browserSupport', () => {
  beforeEach(() => {
    // Reset global mocks
    vi.unstubAllGlobals();
  });

  it('supportsSidePanel returns false when chrome.sidePanel is not available', () => {
    vi.stubGlobal('chrome', {});
    expect(supportsSidePanel()).toBe(false);
  });

  it('supportsSidePanel returns true when chrome.sidePanel is available', () => {
    vi.stubGlobal('chrome', { sidePanel: {} });
    expect(supportsSidePanel()).toBe(true);
  });

  it('supportsOffscreen returns false when chrome.offscreen is not available', () => {
    vi.stubGlobal('chrome', {});
    expect(supportsOffscreen()).toBe(false);
  });

  it('supportsOffscreen returns true when chrome.offscreen is available', () => {
    vi.stubGlobal('chrome', { offscreen: {} });
    expect(supportsOffscreen()).toBe(true);
  });

  it('getBrowserName returns chrome for Chrome user agent', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/126.0.0.0' });
    expect(getBrowserName()).toBe('chrome');
  });

  it('getBrowserName returns edge for Edge user agent', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/126.0.0.0 Edg/126.0.0.0' });
    expect(getBrowserName()).toBe('edge');
  });

  it('getBuiltInAIFlagGuidance returns chrome flags URL for chrome', () => {
    const guidance = getBuiltInAIFlagGuidance('chrome');
    expect(guidance?.url).toBe('chrome://flags/#prompt-api-for-gemini-nano');
  });

  it('getBuiltInAIFlagGuidance returns edge flags URL for edge', () => {
    const guidance = getBuiltInAIFlagGuidance('edge');
    expect(guidance?.url).toBe('edge://flags/#edge-llm-prompt-api-for-phi-mini');
  });

  it('getBuiltInAIFlagGuidance returns null for brave and unknown', () => {
    expect(getBuiltInAIFlagGuidance('brave')).toBeNull();
    expect(getBuiltInAIFlagGuidance('unknown')).toBeNull();
  });

  describe('getBuiltInAIDiskSpace', () => {
    it('reports insufficient space when free space is below the requirement', async () => {
      vi.stubGlobal('navigator', {
        storage: { estimate: async () => ({ quota: 20 * GIB, usage: 10 * GIB }) }
      });
      const result = await getBuiltInAIDiskSpace();
      expect(result?.freeBytes).toBe(10 * GIB);
      expect(result?.sufficient).toBe(false);
    });

    it('reports sufficient space when free space meets the requirement', async () => {
      vi.stubGlobal('navigator', {
        storage: { estimate: async () => ({ quota: 100 * GIB, usage: 10 * GIB }) }
      });
      const result = await getBuiltInAIDiskSpace();
      expect(result?.sufficient).toBe(true);
    });

    it('treats a missing usage value as zero usage', async () => {
      vi.stubGlobal('navigator', {
        storage: { estimate: async () => ({ quota: 30 * GIB }) }
      });
      const result = await getBuiltInAIDiskSpace();
      expect(result?.freeBytes).toBe(30 * GIB);
      expect(result?.sufficient).toBe(true);
    });

    it('returns null when the Storage API is unavailable', async () => {
      vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0' });
      expect(await getBuiltInAIDiskSpace()).toBeNull();
    });

    it('returns null when quota is not reported', async () => {
      vi.stubGlobal('navigator', {
        storage: { estimate: async () => ({ usage: 1 * GIB }) }
      });
      expect(await getBuiltInAIDiskSpace()).toBeNull();
    });

    it('returns null when estimate() rejects', async () => {
      vi.stubGlobal('navigator', {
        storage: { estimate: async () => { throw new Error('denied'); } }
      });
      expect(await getBuiltInAIDiskSpace()).toBeNull();
    });
  });

  it('formatGigabytes renders whole gigabytes', () => {
    expect(formatGigabytes(22 * GIB)).toBe('22 GB');
    expect(formatGigabytes(9.7 * GIB)).toBe('10 GB');
  });
});
