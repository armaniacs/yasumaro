/**
 * Module Interfaces
 *
 * このファイルはシステムの主要なモジュールのインターフェース（契約）を定義します。
 * TypeScriptのインターフェースを使用して型安全性を確保します。
 */
export {};
/**
 * 使用例:
 *
 * ```typescript
 * class TabCache implements ITabCache {
 *     async initialize() { /* ... *\/ }
 *     add(tab: chrome.tabs.Tab) { /* ... *\/ }
 *     get(tabId: number) { /* ... *\/ }
 *     update(tabId: number, data: Partial<chrome.tabs.Tab>) { /* ... *\/ }
 *     remove(tabId: number) { /* ... *\/ }
 * }
 *
 * class ObsidianClient implements IObsidianClient {
 *     async recordUrl(url: string, summary: string) { /* ... *\/ }
 *     async testConnection() { /* ... *\/ }
 * }
 * ```
 */ 
//# sourceMappingURL=index.js.map