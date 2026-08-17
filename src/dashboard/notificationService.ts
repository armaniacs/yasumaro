/** Shows a basic Chrome notification from dashboard-context code. No-ops when the notifications API is unavailable. */
export function notify(title: string, message: string): void {
  chrome.notifications?.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('/icons/icon48.png'),
    title,
    message,
  });
}
