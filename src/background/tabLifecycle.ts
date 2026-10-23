/**
 * tabLifecycle.ts — the single seam for tab open/wait/close
 * (PBI 2026-10-24-06).
 *
 * ManualContentFetcher and RegenerateContentFetcher duplicated this shape
 * with opposite timeout meanings, so the header of regenerateContentFetcher
 * recorded a deliberate non-sharing decision. The difference is local to one
 * point (timeout: best-effort resolve vs reject), which is now the only
 * policy value. Read paths stay in the callers (GET_CONTENT ask vs
 * innerText shortcut), as do reuse positions (manual reuses an open tab,
 * regenerate always opens a fresh tab).
 */

export type TabLoadTimeoutPolicy = 'best-effort' | 'reject';

export interface TabLifecyclePorts {
  createTab: (createProperties: chrome.tabs.CreateProperties) => Promise<chrome.tabs.Tab>;
  getTab: (tabId: number) => Promise<{ status?: string | undefined }>;
  removeTab: (tabId: number) => Promise<void>;
  onUpdated: {
    addListener: (cb: (tabId: number, info: { status?: string }) => void) => void;
    removeListener: (cb: (tabId: number, info: { status?: string }) => void) => void;
  };
}

export const TAB_CREATE_FAILED = 'tab_create_failed';
export const TAB_LOAD_TIMEOUT = 'tab_load_timeout';
export const TAB_GET_FAILED_PREFIX = 'tab_get_failed';

/**
 * Open a background helper tab for the URL. Throws when the created tab
 * carries no id. URL validation stays with the callers (both validate
 * before opening).
 */
export async function openHelperTab(
  ports: Pick<TabLifecyclePorts, 'createTab'>,
  url: string,
): Promise<number> {
  const tab = await ports.createTab({ url, active: false });
  const tabId = tab.id;
  if (tabId === undefined) {
    throw new Error(TAB_CREATE_FAILED);
  }
  return tabId;
}

/**
 * Wait until the tab reports complete. The pre-check covers tabs that
 * already finished loading before the listener ran. On timeout a
 * `best-effort` wait resolves (a partial extract still wins for manual
 * fetch) while a `reject` wait rejects with `tab_load_timeout` (a
 * regenerate must never UPDATE with half-loaded content). A getTab failure
 * rejects for `reject` and resolves for `best-effort` for the same reason.
 */
export function waitForTabComplete(
  ports: Pick<TabLifecyclePorts, 'getTab' | 'onUpdated'>,
  tabId: number,
  timeoutMs: number,
  policy: TabLoadTimeoutPolicy,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      ports.onUpdated.removeListener(listener);
      if (err) {
        if (policy === 'reject') reject(err);
        else resolve();
      } else {
        resolve();
      }
    };
    const listener = (updatedTabId: number, info: { status?: string }): void => {
      if (updatedTabId === tabId && info.status === 'complete') finish();
    };
    ports.onUpdated.addListener(listener);
    void (async (): Promise<void> => {
      try {
        const tab = await ports.getTab(tabId);
        if (tab.status === 'complete') finish();
      } catch (e: unknown) {
        finish(new Error(`${TAB_GET_FAILED_PREFIX}: ${String(e)}`));
      }
    })();
    timer = setTimeout(() => finish(new Error(TAB_LOAD_TIMEOUT)), timeoutMs);
  });
}

/**
 * Best-effort teardown: a helper tab already closed by the user or the
 * browser must never fail the fetch. Callers that need diagnostics pass
 * `onError` (manual fetch logs a warning); callers that do not (regenerate)
 * swallow silently.
 */
export async function closeHelperTab(
  ports: Pick<TabLifecyclePorts, 'removeTab'>,
  tabId: number,
  onError?: (error: unknown) => void,
): Promise<void> {
  try {
    await ports.removeTab(tabId);
  } catch (error: unknown) {
    if (onError) onError(error);
  }
}
