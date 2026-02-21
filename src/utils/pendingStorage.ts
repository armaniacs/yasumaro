import { getSettings, saveSettings } from './storage';

export interface PendingPage {
  url: string;
  title: string;
  timestamp: number;
  reason: 'cache-control' | 'set-cookie' | 'authorization';
  headerValue?: string;
  expiry: number;
}

async function getPendingPagesList(): Promise<PendingPage[]> {
  const settings = await getSettings();
  return settings['pendingPages'] || [];
}

export async function addPendingPage(page: PendingPage): Promise<void> {
  const pages = await getPendingPagesList();

  // 重複除外
  const exists = pages.some(p => p.url === page.url);
  if (exists) return;

  const updatedPages = [...pages, page];

  await saveSettings({ pendingPages: updatedPages });
}

export async function getPendingPages(): Promise<PendingPage[]> {
  const pages = await getPendingPagesList();
  return pages.filter(p => p.expiry > Date.now());
}

export async function removePendingPages(urls: string[]): Promise<void> {
  const pages = await getPendingPagesList();
  const updatedPages = pages.filter(p => !urls.includes(p.url));

  await saveSettings({ pendingPages: updatedPages });
}

export async function clearExpiredPages(): Promise<void> {
  const pages = await getPendingPagesList();
  const updatedPages = pages.filter(p => p.expiry > Date.now());

  await saveSettings({ pendingPages: updatedPages });
}