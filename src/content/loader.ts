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

// Type-only import to establish graphify edge between content script and
// the service worker's message type definitions (PBI-02-3).
import { shouldSkipUrl } from './urlSkipper.js';
import { ChromeStoragePort } from '../utils/storage/storagePort.js';
import { ChromeDomainPolicyPort } from './domainPolicyPort.js';
import { resolveVisitAdmission } from './visitAdmission.js';

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

// Default port instance used by the content script runtime.
const defaultPort = new ChromeDomainPolicyPort(new ChromeStoragePort());

// 即時実行関数
if (typeof globalThis.chrome !== 'undefined' && chrome.runtime?.getURL && typeof window !== 'undefined') (async () => {
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

    // E2E probe pages take the same admission flow; the warn label preserves
    // the '(e2e)' greppability. Hot cache keeps the 0-round-trip optimization
    // for E2E suites that pre-seed domain_filter_cache; cold cache waits for
    // the SW verdict so the e2e attribute alone cannot bypass the domain filter.
    const isE2E = document.documentElement.hasAttribute('data-ow-e2e-test');

    // Single admission seam: skip -> cache verdict -> retrying background
    // verdict -> inject (was a triple branch with two near-identical retry
    // loops; the e2e and normal paths were identical except warn labels).
    await resolveVisitAdmission({
        url,
        warnLabel: isE2E ? ' (e2e)' : '',
        shouldSkip: (u) => typeof window.location !== 'undefined' && shouldSkipUrl(u),
        checkCache: (u) => defaultPort.checkDomainAllowedFromCache(u),
        sendCheckDomain: () => chrome.runtime.sendMessage({ type: 'CHECK_DOMAIN', protocolVersion: CURRENT_PROTOCOL_VERSION }),
        sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
        loadExtractor: async () => {
            // ビルド後のパスを指定（distディレクトリ内）
            await import(chrome.runtime.getURL('content-extractor.js'));
        },
        warn: (message, u, detail) => console.warn(message, u, detail),
    });
})();

// TypeScriptの`isolatedModules`設定を満たすためのダミーexport
export {};
