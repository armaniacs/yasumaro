/**
 * perSiteOverride.ts
 * ドメイン別クレンジング上書きの解決ロジック
 *
 * - 完全一致（小文字・trim 正規化後の一致）のみをマッチとする。サブドメインは別ドメイン。
 * - overrides は差分のみ。baseConfig に shallow merge して返す（元オブジェクトは変更しない）。
 */

import type { DomainCleansingOverride } from '../storage/types.js';

export type { DomainCleansingOverride };

/**
 * ドメイン正規化: trim + lowerCase。空文字は空を返す。
 */
export function normalizeDomain(domain: string): string {
    return domain.trim().toLowerCase();
}

/**
 * baseConfig に対して、domain に一致する override があればマージして返す。
 * - domain が空 / overrides が空 → baseConfig をそのまま返す（同一参照でも良いが安全のため shallow copy しない）
 * - 一致する entry がなければ baseConfig をそのまま返す
 * - 一致する entry があれば { ...baseConfig, ...entry.overrides } を返す（新規オブジェクト）
 *
 * ジェネリクスにして CleansingConfig / AiSummaryCleanseOptions いずれにも適用可能。
 */
export function getCleansingConfigForDomain<T extends Record<string, unknown>>(
    domain: string,
    baseConfig: T,
    overrides: DomainCleansingOverride[] | undefined | null,
): T {
    if (!domain || !overrides || overrides.length === 0) return baseConfig;
    const normalized = normalizeDomain(domain);
    if (!normalized) return baseConfig;
    const found = overrides.find(
        (o) => typeof o.domain === 'string' && normalizeDomain(o.domain) === normalized,
    );
    if (!found || !found.overrides || typeof found.overrides !== 'object') return baseConfig;
    const ov = found.overrides as Record<string, unknown>;
    if (Object.keys(ov).length === 0) return baseConfig;
    return { ...baseConfig, ...ov } as T;
}

/**
 * overrides 配列に対するヘルパー: domain の entry を upsert/delete する純粋関数。
 * UI 層が chrome.storage へ保存する前に配列を操作するのに使う。
 */
export function upsertDomainOverride(
    overrides: DomainCleansingOverride[],
    domain: string,
    patch: Record<string, unknown> | null,
): DomainCleansingOverride[] {
    const normalized = normalizeDomain(domain);
    if (!normalized) return overrides;
    const idx = overrides.findIndex((o) => normalizeDomain(o.domain) === normalized);
    if (patch === null) {
        // delete
        if (idx === -1) return overrides;
        return [...overrides.slice(0, idx), ...overrides.slice(idx + 1)];
    }
    const cleanPatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) cleanPatch[k] = v;
    }
    if (Object.keys(cleanPatch).length === 0) {
        // 空 patch は削除と同等（差分なしなので保持する意味がない）
        if (idx === -1) return overrides;
        return [...overrides.slice(0, idx), ...overrides.slice(idx + 1)];
    }
    if (idx === -1) {
        return [...overrides, { domain: normalized, overrides: cleanPatch as DomainCleansingOverride['overrides'] }];
    }
    const next = [...overrides];
    const existing = next[idx]!;
    next[idx] = { domain: normalized, overrides: { ...existing.overrides, ...cleanPatch } as DomainCleansingOverride['overrides'] };
    // overrides が空になったら entry 自体を削除（差分なし）
    if (Object.keys(next[idx]!.overrides).length === 0) {
        return [...next.slice(0, idx), ...next.slice(idx + 1)];
    }
    return next;
}
