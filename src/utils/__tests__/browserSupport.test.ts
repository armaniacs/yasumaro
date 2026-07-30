/**
 * browserSupport.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supportsSidePanel, supportsOffscreen, supportsFavicon, getBrowserName, getBuiltInAIFlagGuidance } from '../browserSupport.js';

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
});
