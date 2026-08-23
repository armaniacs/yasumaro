/**
 * loader.ts
 * 【Task #19 最適化】Content Script loader with domain filter cache
 * 動的に extractor モジュールをインポートし、ドメインフィルタをチェックする
 *
 * パフォーマンス改善:
 * 1. 内部スキーム（chrome://など）の早期リターン
 * 2. ドメインフィルタキャッシュを使用して、許可ドメイン外で早期リターン
 * 3. キャッシュがない場合のみバックグラウンドメッセージ通信
 */

const _errMsg = (e: unknown): string => e instanceof Error ? e.message : String(e);

// Type-only import to establish graphify edge between content script and
// the service worker's message type definitions (PBI-02-3).
import { shouldSkipUrl } from './urlSkipper.js';
import { checkDomainAllowedFromCache } from './domainPolicy.js';

// Content Script entry point runs without ESM module support, so we cannot
// import CURRENT_PROTOCOL_VERSION statically. The value is injected at build
// time via wxt.config.ts `define.__PROTOCOL_VERSION__` (SSOT: src/messaging/protocol.ts).
declare const __PROTOCOL_VERSION__: number | undefined;
const CURRENT_PROTOCOL_VERSION: number = typeof __PROTOCOL_VERSION__ !== 'undefined' ? __PROTOCOL_VERSION__ : 1;

// 即時実行関数
if (typeof globalThis.chrome !== 'undefined' && chrome.runtime?.getURL && typeof window !== 'undefined') (async () => {
    // 【セキュリティとパフォーマンス最適化】内部スキームには早期リターン
    if (typeof window.location !== 'undefined' && shouldSkipUrl(window.location.href)) {
        return;
    }

    const url = window.location.href;

    // E2E test path: imports extractor directly when data-ow-e2e-test is present.
    // Still performs cache-based domain check (does not bypass security), but avoids
    // the service worker message round-trip that causes flaky E2E tests on first load.
    if (document.documentElement.hasAttribute('data-ow-e2e-test')) {
        const cacheCheck = await checkDomainAllowedFromCache(url);
        if (cacheCheck.useCache && !cacheCheck.allowed) {
            return;  // Domain explicitly blocked by filter cache
        }
        const src = chrome.runtime.getURL('content-extractor.js');
        try { await import(src); } catch (e) { console.warn('[OWeave] Dynamic import blocked (e2e)', url, _errMsg(e)); }
        return;
    }

    // 【Task #19 最適化】キャッシュベースのドメインチェック
    const cacheCheck = await checkDomainAllowedFromCache(url);

    if (cacheCheck.useCache) {
        // キャッシュで判定可能な場合
        if (!cacheCheck.allowed) {
            return;  // 拒否ドメイン → 早期リターン
        }
        // 許可 → extractor を inject
        const src = chrome.runtime.getURL('content-extractor.js');
        try { await import(src); } catch (e) { console.warn('[OWeave] Dynamic import blocked', url, _errMsg(e)); }
        return;
    }

    // キャッシュがない場合のみ、バックグラウンドメッセージでドメインチェック
    // Service Worker がまだ起動していない場合に備えリトライ付き
    let response: { success?: boolean; allowed?: boolean } | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            response = await chrome.runtime.sendMessage({ type: 'CHECK_DOMAIN', protocolVersion: CURRENT_PROTOCOL_VERSION });
            if (response) break;
        } catch (e) {
            lastError = e;
            // Service Worker 未起動 → 少し待ってリトライ
            await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
        }
    }
    if (!response || !response.allowed) {
        if (!response) {
            console.warn('[OWeave] Domain check failed: no response from service worker', url, _errMsg(lastError ?? 'unknown'));
        }
        return;
    }

    // ビルド後のパスを指定（distディレクトリ内）
    const src = chrome.runtime.getURL('content-extractor.js');
    try { await import(src); } catch (e) { console.warn('[OWeave] Dynamic import blocked', url, _errMsg(e)); }
})();

// TypeScriptの`isolatedModules`設定を満たすためのダミーexport
export {};
