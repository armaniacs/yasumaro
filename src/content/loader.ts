/**
 * loader.ts
 * 【Task #19 最適化】Content Script loader with domain filter cache
 * 動的に extractor モジュールをインポートし、ドメインフィルタをチェックする
 *
 * パフォーマンス改善:
 * 1. 内部スキーム（chrome://など）の早期リターン
 * 2. ドメインフィルタキャッシュを使用して、許可ドメイン外で早期リターン
 * 3. キャッシュがない場合のみバックグラウンドメッセージ通信
 *
 * PBI-20: domainPolicy は DomainPolicyPort (ChromeDomainPolicyPort) に統一され、
 * loader と contentKernel で同一の CACHE_TTL と StoragePort 意味論を共有する。
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

// Benchmark A/B build flag. Only builds made with OW_BENCH=1 define this as
// true; production builds define it as false so the page-controllable
// localStorage kill-switch below is compiled out — untrusted page content must
// never be able to disable the content script.
declare const __OW_BENCH__: boolean | undefined;
const BENCH_DISABLE_CS_ENABLED: boolean = typeof __OW_BENCH__ !== 'undefined' && __OW_BENCH__ === true;

// 即時実行関数
if (typeof globalThis.chrome !== 'undefined' && chrome.runtime?.getURL && typeof window !== 'undefined') (async () => {
    // 【セキュリティとパフォーマンス最適化】内部スキームには早期リターン
    if (typeof window.location !== 'undefined' && shouldSkipUrl(window.location.href)) {
        return;
    }

    // Benchmark A/B control: only compiled into bench builds (OW_BENCH=1).
    // The bench sets this page-origin localStorage key to measure page load
    // WITHOUT the content script's work. Production builds never read it.
    if (BENCH_DISABLE_CS_ENABLED) {
        try {
            if (window.localStorage?.getItem('__ow_bench_disable_cs') === '1') {
                return;
            }
        } catch {
            // localStorage can throw in sandboxed frames — ignore and continue.
        }
    }

    const url = window.location.href;

    // E2E test path: cache-based domain check when possible, otherwise
    // fall back to SW CHECK_DOMAIN (same trust seam as the normal path).
    // Hot cache keeps the 0-round-trip optimization for E2E suites that
    // pre-seed domain_filter_cache; cold cache waits for the SW verdict
    // so the e2e attribute alone cannot bypass the domain filter.
    if (document.documentElement.hasAttribute('data-ow-e2e-test')) {
        const cacheCheck = await checkDomainAllowedFromCache(url);
        if (cacheCheck.useCache) {
            if (!cacheCheck.allowed) return; // Domain explicitly blocked by filter cache
            const src = chrome.runtime.getURL('content-extractor.js');
            try { await import(src); } catch (e) { console.warn('[OWeave] Dynamic import blocked (e2e)', url, _errMsg(e)); }
            return;
        }
        // Cold cache → fall back to SW CHECK_DOMAIN (trust boundary, retry付き)
        let e2eResponse: { success?: boolean; allowed?: boolean } | undefined;
        let e2eLastError: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                e2eResponse = await chrome.runtime.sendMessage({ type: 'CHECK_DOMAIN', protocolVersion: CURRENT_PROTOCOL_VERSION });
                if (e2eResponse) break;
            } catch (e) {
                e2eLastError = e;
                await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
            }
        }
        if (!e2eResponse || !e2eResponse.allowed) {
            if (!e2eResponse) {
                console.warn('[OWeave] Domain check failed: no response from service worker', url, _errMsg(e2eLastError ?? 'unknown'));
            }
            return;
        }
        const src = chrome.runtime.getURL('content-extractor.js');
        try { await import(src); } catch (e) { console.warn('[OWeave] Dynamic import blocked (e2e)', url, _errMsg(e)); }
        return;
    }

    // 【Task #19 最適化】キャッシュベースのドメインチェック — DomainPolicyPort 単一 seam
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
