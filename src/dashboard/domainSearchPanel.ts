// ============================================================================
// Domain Search Panel
// ============================================================================

import { getMessage } from '../popup/i18n.js';
import { getSettings, StorageKeys } from '../utils/storage.js';
import { extractDomain, isDomainAllowed } from '../utils/domainUtils.js';
import type { Settings } from '../utils/storage.js';

export function initDomainSearchPanel(): void {
  const searchInput = document.getElementById('domainSearchInput') as HTMLInputElement | null;
  const matchesEl = document.getElementById('domainSearchMatches') as HTMLElement | null;
  const checkInput = document.getElementById('domainCheckInput') as HTMLInputElement | null;
  const resultEl = document.getElementById('domainSearchResult') as HTMLElement | null;

  // --- Part 1: Filter list incremental search ---
  async function runFilterSearch(): Promise<void> {
    if (!searchInput || !matchesEl) return;
    const query = searchInput.value.trim().toLowerCase();
    matchesEl.innerHTML = '';

    if (!query) return;

    const settings = await getSettings();
    const blacklist: string[] = (settings[StorageKeys.DOMAIN_BLACKLIST as keyof Settings] as string[]) || [];
    const whitelist: string[] = (settings[StorageKeys.DOMAIN_WHITELIST as keyof Settings] as string[]) || [];

    const blackMatches = blacklist.filter(d => d.toLowerCase().includes(query));
    const whiteMatches = whitelist.filter(d => d.toLowerCase().includes(query));

    if (blackMatches.length === 0 && whiteMatches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'domain-match-empty';
      empty.textContent = getMessage('domainNoMatches') || 'No matching rules found.';
      matchesEl.appendChild(empty);
      return;
    }

    function renderGroup(items: string[], listType: 'blacklist' | 'whitelist'): void {
      if (items.length === 0) return;
      const label = listType === 'blacklist'
        ? (getMessage('blacklistLabel') || 'Blacklist')
        : (getMessage('whitelistLabel') || 'Whitelist');
      const header = document.createElement('div');
      header.className = `domain-match-group-header domain-match-group-${listType}`;
      header.textContent = `${label} (${items.length})`;
      matchesEl!.appendChild(header);

      items.forEach(domain => {
        const row = document.createElement('div');
        row.className = `domain-match-row domain-match-${listType}`;
        // Highlight matched part
        const idx = domain.toLowerCase().indexOf(query);
        if (idx >= 0) {
          row.innerHTML =
            escapeHtml(domain.slice(0, idx)) +
            `<mark class="domain-match-highlight">${escapeHtml(domain.slice(idx, idx + query.length))}</mark>` +
            escapeHtml(domain.slice(idx + query.length));
        } else {
          row.textContent = domain;
        }
        matchesEl!.appendChild(row);
      });
    }

    renderGroup(blackMatches, 'blacklist');
    renderGroup(whiteMatches, 'whitelist');
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  searchInput?.addEventListener('input', runFilterSearch);

  // --- Part 2: URL allowed/blocked check ---
  async function runCheck(): Promise<void> {
    if (!checkInput || !resultEl) return;
    const value = checkInput.value.trim();
    if (!value) {
      resultEl.className = 'domain-search-result';
      resultEl.textContent = '';
      return;
    }

    resultEl.className = 'domain-search-result visible info';
    resultEl.textContent = getMessage('checking') || 'Checking...';

    try {
      const url = value.startsWith('http') ? value : `https://${value}`;
      const allowed = await isDomainAllowed(url);
      const domain = extractDomain(url) || value;

      if (allowed) {
        resultEl.className = 'domain-search-result visible allowed';
        resultEl.textContent = `✓ ${domain} — ${getMessage('domainAllowed') || 'Allowed (will be recorded)'}`;
      } else {
        resultEl.className = 'domain-search-result visible blocked';
        resultEl.textContent = `✗ ${domain} — ${getMessage('domainBlocked') || 'Blocked (will not be recorded)'}`;
      }
    } catch (e) {
      resultEl.className = 'domain-search-result visible info';
      resultEl.textContent = getMessage('checkError') || 'Error checking domain.';
    }
  }

  checkInput?.addEventListener('input', runCheck);
}
