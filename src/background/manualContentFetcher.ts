import { logWarn, logDebug } from '../utils/logger.js';
import { sanitizeUrlForLogging } from '../utils/urlUtils.js';

interface CacheEntry {
  content: string;
  timestamp: number;
}

export class ManualContentFetcher {
  private cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ttlMs = 5 * 60 * 1000, maxEntries = 20) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
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
      this.addToCache(url, content);
    }
    return content;
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
      const allTabs = await chrome.tabs.query({});
      const existingTab = allTabs.find(t => t.url === url && t.id !== undefined);
      let targetTabId: number | undefined = existingTab?.id;

      if (!targetTabId) {
        try {
          const newTab = await chrome.tabs.create({ url, active: false });
          createdTabId = newTab.id;
          targetTabId = newTab.id;
        } catch (e) {
          await logWarn(
            'Failed to create background tab, falling back to existing tabs only',
            { url: sanitizedUrl, error: e instanceof Error ? e.message : String(e) },
            undefined,
            'manualContentFetcher'
          );
        }

        if (targetTabId) {
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 10000);
            const listener = (tabId: number, info: { status?: string }): void => {
              if (tabId === targetTabId && info.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
          });
        }
      }

      if (targetTabId) {
        const results = await chrome.scripting.executeScript({
          target: { tabId: targetTabId },
          func: () => {
            const body = document.body;
            if (!body) return '';
            const clone = body.cloneNode(true) as HTMLElement;
            const excludedSelectors = 'script,style,nav,header,footer,aside,noscript,iframe,[role="navigation"],[role="banner"],[role="contentinfo"],[aria-hidden="true"]';
            clone.querySelectorAll(excludedSelectors).forEach(el => el.remove());
            return clone.innerText?.trim().substring(0, 10000) || '';
          }
        });
        return results?.[0]?.result || '';
      }
    } catch (err: unknown) {
      await logWarn(
        'Failed to get page content from tab',
        { url: sanitizedUrl, error: err instanceof Error ? err.message : String(err) },
        undefined,
        'manualContentFetcher'
      );
    } finally {
      if (createdTabId !== undefined) {
        chrome.tabs.remove(createdTabId).catch(() => {});
      }
    }

    return '';
  }
}

export const manualContentFetcher = new ManualContentFetcher();
