/**
 * browserSupport.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supportsBuiltInAI, supportsSidePanel, supportsOffscreen, supportsFavicon, getBrowserName } from '../browserSupport.js';

describe('browserSupport', () => {
  beforeEach(() => {
    // Reset global mocks
    vi.unstubAllGlobals();
  });

  it('supportsBuiltInAI returns false when window.ai is not available', () => {
    expect(supportsBuiltInAI()).toBe(false);
  });

  it('supportsBuiltInAI returns true when window.ai is available', () => {
    vi.stubGlobal('ai', { languageModel: {} });
    expect(supportsBuiltInAI()).toBe(true);
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
});
