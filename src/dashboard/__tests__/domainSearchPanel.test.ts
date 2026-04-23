// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { initDomainSearchPanel } from '../domainSearchPanel.js';

vi.mock('../../popup/i18n.js', () => ({
  getMessage: (key: string) => `i18n_${key}`,
}));

const mockGetSettings = vi.fn();
const mockIsDomainAllowed = vi.fn();

vi.mock('../../utils/storage.js', () => ({
  getSettings: () => mockGetSettings(),
  StorageKeys: {
    DOMAIN_BLACKLIST: 'domain_blacklist',
    DOMAIN_WHITELIST: 'domain_whitelist',
  },
}));

vi.mock('../../utils/domainUtils.js', () => ({
  extractDomain: (url: string) => {
    try { return new URL(url).hostname; } catch { return null; }
  },
  isDomainAllowed: (url: string) => mockIsDomainAllowed(url),
}));

describe('initDomainSearchPanel', () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockIsDomainAllowed.mockReset();
    document.body.innerHTML = `
      <input id="domainSearchInput" />
      <div id="domainSearchMatches"></div>
      <input id="domainCheckInput" />
      <div id="domainSearchResult"></div>
    `;
  });

  it('shows no matches message for empty filter list', async () => {
    mockGetSettings.mockResolvedValue({
      domain_blacklist: [],
      domain_whitelist: [],
    });
    initDomainSearchPanel();
    const input = document.getElementById('domainSearchInput') as HTMLInputElement;
    input.value = 'test';
    input.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 10));
    const matches = document.getElementById('domainSearchMatches')!;
    expect(matches.textContent).toContain('i18n_domainNoMatches');
  });

  it('renders matching blacklist items', async () => {
    mockGetSettings.mockResolvedValue({
      domain_blacklist: ['bad.com'],
      domain_whitelist: [],
    });
    initDomainSearchPanel();
    const input = document.getElementById('domainSearchInput') as HTMLInputElement;
    input.value = 'bad';
    input.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 10));
    const matches = document.getElementById('domainSearchMatches')!;
    expect(matches.textContent).toContain('bad.com');
  });

  it('shows allowed result for permitted domain', async () => {
    mockIsDomainAllowed.mockResolvedValue(true);
    initDomainSearchPanel();
    const input = document.getElementById('domainCheckInput') as HTMLInputElement;
    input.value = 'example.com';
    input.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 10));
    const result = document.getElementById('domainSearchResult')!;
    expect(result.className).toContain('allowed');
  });

  it('shows blocked result for blocked domain', async () => {
    mockIsDomainAllowed.mockResolvedValue(false);
    initDomainSearchPanel();
    const input = document.getElementById('domainCheckInput') as HTMLInputElement;
    input.value = 'bad.com';
    input.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 10));
    const result = document.getElementById('domainSearchResult')!;
    expect(result.className).toContain('blocked');
  });

  it('clears result when check input is empty', async () => {
    initDomainSearchPanel();
    const input = document.getElementById('domainCheckInput') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 10));
    const result = document.getElementById('domainSearchResult')!;
    expect(result.textContent).toBe('');
  });
});
