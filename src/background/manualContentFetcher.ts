import { logWarn } from '../utils/logger/api.js';
import { sanitizeUrlForLogging } from '../utils/urlUtils.js';
import { errorMessage } from '../utils/errorUtils.js';
import { sanitizeRegex } from '../utils/piiSanitizer.js';
import { validateUrl } from '../utils/ssrfGuard.js';
import type { TabLifecyclePorts } from './tabLifecycle.js';
import { closeHelperTab, openHelperTab, waitForTabComplete } from './tabLifecycle.js';

const TAB_LOAD_TIMEOUT_MS = 10000;
const MAX_EXTRACTED_TEXT_LENGTH = 10000;

/**
 * Tab-operation ports. Lifecycle (open/wait/close) is the shared
 * TabLifecyclePorts shape also used by RegenerateContentFetcher — only the
 * timeout policy differs (here: best-effort). Reading stays local: queryTabs
 * reuse plus the innerText executeScript shortcut.
 */
export interface ManualTabPorts
  extends Pick<TabLifecyclePorts, 'createTab' | 'getTab' | 'removeTab' | 'onUpdated'> {
  queryTabs: (query: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>;
  /** Run the body-text extraction against the tab, returning trimmed text. */
  executeScript: (tabId: number) => Promise<string>;
}

const chromeManualTabPorts: ManualTabPorts = {
  queryTabs: (query) => chrome.tabs.query(query),
  createTab: (props) => chrome.tabs.create(props),
  getTab: (tabId) => chrome.tabs.get(tabId),
  onUpdated: {
    addListener: (cb) => chrome.tabs.onUpdated.addListener(cb),
    removeListener: (cb) => chrome.tabs.onUpdated.removeListener(cb),
  },
  executeScript: async (tabId) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (maxLength: number) => {
        const body = document.body;
        if (!body) return '';
        const clone = body.cloneNode(true) as HTMLElement;
        const excludedSelectors = 'script,style,nav,header,footer,aside,noscript,iframe,[role="navigation"],[role="banner"],[role="contentinfo"],[aria-hidden="true"]';
        clone.querySelectorAll(excludedSelectors).forEach(el => el.remove());
        return clone.innerText?.trim().substring(0, maxLength) || '';
      },
      args: [MAX_EXTRACTED_TEXT_LENGTH]
    });
    return results?.[0]?.result || '';
  },
  removeTab: (tabId) => chrome.tabs.remove(tabId),
};

interface CacheEntry {
  content: string;
  timestamp: number;
}

export class ManualContentFetcher {
  private cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly ports: ManualTabPorts;

  constructor(ttlMs = 5 * 60 * 1000, maxEntries = 20, ports: ManualTabPorts = chromeManualTabPorts) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.ports = ports;
  }

  async fetchContent(url: string): Promise<string> {
    this.clearExpired();

    const cached = this.cache.get(url);
    if (cached) {
      this.cache.delete(url);
      this.cache.set(url, cached);
      return cached.content;
    }

    const content = await this.fetchFromTab(url);
    if (content) {
      const sanitized = await this.sanitizeContent(content);
      this.addToCache(url, sanitized);
      return sanitized;
    }
    return content;
  }

  private async sanitizeContent(content: string): Promise<string> {
    try {
      const result = await sanitizeRegex(content);
      return result.text || content;
    } catch (err: unknown) {
      await logWarn(
        'PII sanitization failed, using raw content',
        { error: errorMessage(err) },
        undefined,
        'manualContentFetcher'
      );
      return content;
    }
  }

  clearExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp >= this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }

  private addToCache(url: string, content: string): void {
    if (this.cache.has(url)) {
      this.cache.delete(url);
    } else if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(url, { content, timestamp: Date.now() });
  }

  private async fetchFromTab(url: string): Promise<string> {
    const sanitizedUrl = sanitizeUrlForLogging(url);
    let createdTabId: number | undefined;

    try {
      validateUrl(url, { requireValidProtocol: true, blockLocalhost: true });
      const allTabs = await this.ports.queryTabs({});
      const existingTab = allTabs.find(t => t.url === url && t.id !== undefined);
      let targetTabId: number | undefined = existingTab?.id;

      if (!targetTabId) {
        try {
          const newTabId = await openHelperTab(this.ports, url);
          createdTabId = newTabId;
          targetTabId = newTabId;
        } catch (e) {
          await logWarn(
            'Failed to create background tab, falling back to existing tabs only',
            { url: sanitizedUrl, error: errorMessage(e) },
            undefined,
            'manualContentFetcher'
          );
        }

        if (targetTabId) {
          // Best-effort wait (shared lifecycle): a timeout still proceeds to
          // the innerText shortcut with whatever has loaded so far.
          await waitForTabComplete(this.ports, targetTabId, TAB_LOAD_TIMEOUT_MS, 'best-effort');
        }
      }

      if (targetTabId) {
        return await this.ports.executeScript(targetTabId);
      }
    } catch (err: unknown) {
      await logWarn(
        'Failed to get page content from tab',
        { url: sanitizedUrl, error: errorMessage(err) },
        undefined,
        'manualContentFetcher'
      );
    } finally {
      if (createdTabId !== undefined) {
        const tabId = createdTabId;
        // Helper-tab cleanup is best-effort, but a leaked background tab is
        // user-visible, so keep the failure in diagnostic logs (was silent).
        void closeHelperTab(this.ports, tabId, (error: unknown) => {
          void logWarn(
            'Failed to remove helper tab',
            { error: errorMessage(error) },
            undefined,
            'manualContentFetcher'
          );
        });
      }
    }

    return '';
  }
}
