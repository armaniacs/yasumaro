/**
 * @vitest-environment jsdom
 *
 * overcutFixtures.test.ts — PBI 05 DoD ゲートの fixture 自動検証 (Ask N2-A)
 *
 * qa.smbc 実サイトへの自動アクセスは行わない方針の代替として、
 * testDir/e2e/test-pages/ の再現 fixture を読み込み、抽出パイプラインが
 * 期待するガード挙動を実測する。fixture HTML 自体が e2e/manual checklist
 * からも共有される単一の情報源。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractMainContentWithInfo } from '../index.js';
import { buildExtractionOptions } from '../optionBuilder.js';
import { createDefaultCleansingConfig } from '../../cleansingConfig.js';

type Result = Record<string, unknown> & { content: string };

// vitest cwd = repo root (vitest.config at root).
const loadFixture = (name: string): string =>
    readFileSync(join(process.cwd(), 'testDir/e2e/test-pages', name), 'utf8');

describe('PBI 05 fixture verification (DoD gate — Ask N2-A)', () => {
    it('qa-smbc-repro: tiny article candidate → candidate_too_small body join ships floor-clearing text', () => {
        document.body.innerHTML = loadFixture('qa-smbc-repro.html');
        // Production-faithful: FULL default cleansing config (55 keywords, all
        // rules) — mirrors what the real content script runs in the e2e spec.
        const cfg = createDefaultCleansingConfig();
        const { cleanseOptions, aiSummaryCleanseOptions, dedupOptions } = buildExtractionOptions(cfg);
        const r = extractMainContentWithInfo(10000, cleanseOptions, aiSummaryCleanseOptions, dedupOptions) as unknown as Result;

        expect(r.fallbackTriggered).toBe(true);
        expect(r.fallbackReason).toBe('candidate_too_small');
        // 送信本文はフロア(100文字)を満たす(レガシーの193B断片送出を回帰検出)
        expect(r.content.length).toBeGreaterThanOrEqual(100);
        expect(r.content).toContain('Oliveのランク切替方法');
        // 候補(article)が棄却された診断値が残る
        expect(Number(r.candidateBytes ?? 0)).toBeGreaterThan(0);
        expect(Number(r.pageBytes ?? 0)).toBeGreaterThan(Number(r.candidateBytes ?? 0));
    });

    it('keyword-overstrip: keyword strip guts the candidate → content_overcut restores pre-cleanse text', () => {
        document.body.innerHTML = loadFixture('keyword-overstrip.html');
        const r = extractMainContentWithInfo(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, keywordStripEnabled: true },
        ) as unknown as Result;

        expect(r.fallbackTriggered).toBe(true);
        expect(r.fallbackReason).toBe('content_overcut');
        // 復元先 = クレンジング前テキスト(login履歴ブロックを含む)
        expect(r.content).toContain('login履歴とランク判定');
        // ②復元は③計測も巻き戻す( settling と同一 semantics )
        expect(r.aiSummaryOriginalBytes).toBeUndefined();
    });

    it('whitelist-tiny: whitelist path bypasses the guards (documented v1 scope — Ask Q2A)', () => {
        document.body.innerHTML = loadFixture('whitelist-tiny.html');
        const r = extractMainContentWithInfo(10000, { cleanseEnabled: true }) as unknown as Result;

        expect(r.whitelistAdapterUsed).toBe('5ch-matome');
        expect(r.content).toContain('薄いレス本文');
        // ガード非発火(early return で applyFallback に到達しない) — スコープ外の明示
        expect(r.fallbackTriggered ?? false).toBe(false);
        expect(r.fallbackReason).toBeUndefined();
    });
});
