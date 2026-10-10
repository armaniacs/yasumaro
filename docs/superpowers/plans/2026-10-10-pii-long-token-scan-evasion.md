# PII Long-Token Scan Evasion Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `#`-substitution sampling scan with an overlapping-chunk scan over the original text so PII inside long whitespace-free tokens cannot evade detection.

**Architecture:** Delete the module-private helpers (`TOKEN_EDGE_KEEP_LENGTH`, `NON_WHITESPACE_RUN`, `neutralizeLongNonWhitespaceRuns`, `sampleMiddleForScan` — used only inside `src/utils/piiSanitizer.ts`) and run the existing combined-regex construction per chunk (`CHUNK_SIZE=400`, `OVERLAP=200`, step 200). Match offsets are rebased onto the original text; the existing overlap-resolution block (`:350-364`) already dedupes cross-chunk duplicates, and the `timeout` / `MAX_MATCH_COUNT` guards are preserved per scan.

**Tech Stack:** TypeScript (nodeNext, `.js` import extensions), Vitest, `npm run validate` gate. No real-time waits in tests (`testDir/waitPolicy.ts`).

---

## File Structure

- Modify: `src/utils/piiSanitizer.ts` — `:36-69` (delete helpers, add chunk constants + premise comment), `:283-287` (delete `scanText` derivation), `:301-348` (wrap exec loop in chunk loop with offset rebase), `:316-321` (rewrite stale comments).
- Modify: `src/utils/__tests__/piiSanitizer.test.ts` — add one straddling-alignment repro test in `describe('sanitizeRegex - 長トークン内部のPII')`. Existing tests in that block stay (the `150/150` case keeps passing; the `64KB` timeout test pins ReDoS resistance).

## PBI

`dev-docs/archived/pbi/2026-10-10-16-fix-pii-long-token-scan-evasion.md`

---

### Task 1: Add the straddling-alignment repro test (red)

**Files:**
- Modify: `src/utils/__tests__/piiSanitizer.test.ts`
- Test: `src/utils/__tests__/piiSanitizer.test.ts`

Why this exact input: token length 406 > 200 triggers sampling; `middle` is 206 chars so `sampleMiddleForScan` places `#` deterministically at the email's offset 199/299 region, splitting `user@example.com` into `user@exam#le.com` on the scan text. The pre-existing `150/150` test does NOT straddle a `#` and keeps passing pre-fix — that is why a new test is needed.

- [ ] **Step 1: Append the test in `describe('sanitizeRegex - 長トークン内部のPII')`**

```ts
    test('masks an email straddling the sampling window boundary in a long token', async () => {
      // 【テスト目的】: サンプリング置換文字 `#` を跨ぐ位置のPIIも検出・マスキング
      // されることを確認（PBI-16）。この配置では旧実装が未検出になる。
      const input = 'a'.repeat(190) + 'user@example.com' + 'b'.repeat(200);
      const result = await sanitizeRegex(input) as SanitizeResult;

      expect(result.text).not.toContain('user@example.com');
      expect(result.maskedItems.some(item => item.type === 'email')).toBe(true);
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/__tests__/piiSanitizer.test.ts -t "straddling the sampling window"`
Expected: FAIL — `result.text` still contains `user@example.com`, `maskedItems` has no email.

- [ ] **Step 3: Commit the red test**

```bash
git add src/utils/__tests__/piiSanitizer.test.ts
git commit -m "test: pin straddling-alignment PII detection (red)"
```

### Task 2: Replace sampling with overlapping-chunk scan (green)

**Files:**
- Modify: `src/utils/piiSanitizer.ts`

- [ ] **Step 1: Delete the sampling helpers and add chunk constants**

Delete lines 30-69 (`TOKEN_EDGE_KEEP_LENGTH`, `NON_WHITESPACE_RUN`, `neutralizeLongNonWhitespaceRuns`, `sampleMiddleForScan` and their comments) and replace with:

```ts
// 重なり付きチャンク走査の定数。
// 全チャンクは原文の slice であり置換文字を挿入しないため、検出位置は
// チャンク先頭オフセットの加算で原文位置に1対1で写像できる。
// OVERLAP=200 の根拠: 実体長200字未満のPIIは必ずいずれかのチャンクに
// 完全包含される（bounded パターンの最長はFR/IT IBAN系の23字、emailは
// 200字までカバー。emailの理論最大254字のうち200字超の極端例は残存
// リスクとして受容する）。200字超の bounded パターンを追加する際は
// OVERLAP を同時に見直すこと。
const SCAN_CHUNK_SIZE = 400;
const SCAN_CHUNK_OVERLAP = 200;
```

- [ ] **Step 2: Scan the original text in overlapping chunks**

Delete line 287 (`const scanText = neutralizeLongNonWhitespaceRuns(text);`) and its comment block (`:283-286`). Keep the `combinedRegex` construction (`:291-301`) exactly as is. Wrap the exec loop (`:303-348`) so each chunk is scanned with `lastIndex` reset and offsets rebased:

```ts
        let match: RegExpExecArray | null;
        let matchCount = 0;
        const step = SCAN_CHUNK_SIZE - SCAN_CHUNK_OVERLAP;
        for (let offset = 0; offset < text.length; offset += step) {
            const chunk = text.slice(offset, offset + SCAN_CHUNK_SIZE);
            combinedRegex.lastIndex = 0;
            while ((match = combinedRegex.exec(chunk)) !== null) {
                matchCount++;
                // 【ReDoS対策】タイムアウトチェックをより頻繁に実行（5マッチごと）
                if (matchCount % TIMEOUT_CHECK_INTERVAL === 0 && Date.now() - startTime > timeout) {
                    throw new Error(`Operation timed out after ${timeout}ms`);
                }
                // 【ReDoS対策】マッチ件数制限を追加
                if (matchCount > MAX_MATCH_COUNT) {
                    throw new Error(`Operation exceeded maximum match count of ${MAX_MATCH_COUNT}`);
                }

                // チャンクは原文の slice のため、チャンク内マッチ位置に
                // チャンク先頭オフセットを加算すれば原文位置と1対1で一致する。
                // 値は原文から取得する（従来の scanText 由来切り出しと同等）。
                const matchedValue = text.substring(offset + match.index, offset + match.index + match[0].length);
                const startIndex = offset + match.index;
```

The remainder of the loop body (`:325-348`: group identification, Luhn check, `replacements.push`) is kept verbatim — it already uses `matchedValue`/`startIndex`. Close the added `for` loop after the existing `while` loop's closing brace. Rewrite the stale comment (`:316-321`, scanText length-equality claims) — delete it, the new comment above replaces it. The existing overlap-resolution block (`:350-364`, `usedRanges` dedupe) is kept verbatim and now also absorbs cross-chunk duplicates.

- [ ] **Step 3: Run the sanitizer tests**

Run: `npx vitest run src/utils/__tests__/piiSanitizer.test.ts src/utils/__tests__/piiSanitizer-optimization.test.ts src/utils/__tests__/piiSanitizer-redos.test.ts src/utils/__tests__/piiSanitizer-security.test.ts`
Expected: PASS — new repro test green, the `150/150` tests still green, the `64KB ... within the timeout` test still green (ReDoS pin).

- [ ] **Step 4: Commit**

```bash
git add src/utils/piiSanitizer.ts src/utils/__tests__/piiSanitizer.test.ts
git commit -m "fix: overlapping-chunk PII scan closes long-token evasion"
```

### Task 3: Boundary-condition test for chunk edges

**Files:**
- Modify: `src/utils/__tests__/piiSanitizer.test.ts`

- [ ] **Step 1: Add a chunk-boundary test**

```ts
    test('masks PII centered exactly on a chunk step boundary', async () => {
      // 【テスト目的】: チャンク境界（200文字刻み）を跨ぐPIIが重なりで拾われる
      // ことを確認（PBI-16）。offset 195 開始のemailは chunk0 [0,400) と
      // chunk1 [200,600) の両端に掛かるが、重なり200により chunk0 に完全包含される。
      const input = 'c'.repeat(195) + 'user@example.com' + 'd'.repeat(220);
      const result = await sanitizeRegex(input) as SanitizeResult;

      expect(result.text).not.toContain('user@example.com');
      expect(result.maskedItems.some(item => item.type === 'email')).toBe(true);
    });
```

- [ ] **Step 2: Run to verify green**

Run: `npx vitest run src/utils/__tests__/piiSanitizer.test.ts -t "長トークン内部のPII"`
Expected: PASS, all tests in the block green.

- [ ] **Step 3: Commit**

```bash
git add src/utils/__tests__/piiSanitizer.test.ts
git commit -m "test: pin chunk-boundary PII detection"
```

### Task 4: Full validation gate
- [ ] **Step 1: Run type check and validate**

Run: `npm run type-check`
Expected: exit 0.

Run: `npm run validate`
Expected: exit 0.

- [ ] **Step 2: Record results in the PBI checkboxes** (`Definition of Done` in `dev-docs/archived/pbi/2026-10-10-16-fix-pii-long-token-scan-evasion.md`), commit:

```bash
git add dev-docs/archived/pbi/2026-10-10-16-fix-pii-long-token-scan-evasion.md
git commit -m "docs: record PBI-16 validation results"
```

### Task 5: Port overlapping-chunk scan to the Rust WASM core and rebuild (added 2026-10-10: Task 4 BLOCKED on WASM parity)

Background:本番はWASM優先・TSフォールバック (`piiSanitizeHybrid.ts`) のため、TSのみの修正ではWASM経路に回避が残る。Task 4のvalidateは `src/wasm/pii-sanitizer/__tests__/parity.test.ts` 7件失敗でBLOCKEDとなった。Rustクレート `wasm/pii-sanitizer/` が旧サンプリング (`neutralize_long_runs` + `TOKEN_EDGE_KEEP_LEN=100` in `wasm/pii-sanitizer/src/lib.rs:34-90`) を保持していることが原因。

- [ ] **Step 1: Port the chunk scan to Rust**

In `wasm/pii-sanitizer/src/lib.rs`, replace the `neutralize_long_runs` sampling with an overlapping-chunk scan over the ORIGINAL bytes that mirrors the TS semantics exactly:
- Constants: `SCAN_CHUNK_SIZE: usize = 400`, `SCAN_CHUNK_OVERLAP: usize = 200`, step 200.
- Per chunk, call the existing `patterns::dispatch::scan` on the chunk slice and rebase spans by the chunk offset.
- Exact-once counting before the match cap (mirror of the TS pre-count guards): skip spans fully inside the previous chunk's overlap; skip pure chunk-edge artifacts (a span that has no counterpart when probed at its absolute start on the full text); skip truncated prefixes whose true span (probed on the full text at the absolute start) is longer but within OVERLAP. True spans longer than OVERLAP are counted in truncated form (accepted residual, same as TS).
- Keep `MAX 1000` match-count semantics and fail-closed limit behavior byte-identical (see `exactly_1000_matches_still_succeeds` / `exceeding_1000_matches_reports_match_limit` tests in `lib.rs:459+`).
- Update the module doc comment (`:24-27`, sampling description) and the `neutralize_long_runs` doc comment to describe chunking. Delete `neutralize_long_runs` and `TOKEN_EDGE_KEEP_LEN` (verify no other references with grep first).
- Add Rust unit tests mirroring the TS repro: long-token-mid email (`"a".repeat(190) + "user@example.com" + "b".repeat(200)`) must mask; keep all existing `cargo test` green.

Run: `cargo test -p pii-sanitizer` (from `wasm/pii-sanitizer/`, or workspace root with `-p`)
Expected: all Rust tests pass, including the new repro test.

- [ ] **Step 2: Rebuild the WASM binary and glue**

Run: `npm run build:wasm`
Expected: exit 0. Verify `git status` shows the rebuilt artifacts (`src/wasm/pii-sanitizer/pii_sanitizer_bg.wasm`, `piiSanitizerWasm.js`, and `wasm/pii-sanitizer/pkg/` outputs). If the script rebuilds other crates too, stage ONLY the pii-sanitizer outputs.

- [ ] **Step 3: Run the parity and TS suites**

Run: `npx vitest run src/wasm/pii-sanitizer/__tests__/parity.test.ts src/wasm/pii-sanitizer/__tests__/extended-patterns-parity.test.ts`
Expected: PASS — the 7 previously failing inputs (#4/#22/#28/#33/#147/#149/#213) now match.

Run: `npx vitest run src/utils/__tests__/piiSanitizer.test.ts src/utils/__tests__/piiSanitizer-optimization.test.ts src/utils/__tests__/piiSanitizer-redos.test.ts src/utils/__tests__/piiSanitizer-security.test.ts`
Expected: PASS (no TS changes in this task; regression check).

- [ ] **Step 4: Commit**

```bash
git add wasm/pii-sanitizer/src/ src/wasm/pii-sanitizer/pii_sanitizer_bg.wasm src/wasm/pii-sanitizer/piiSanitizerWasm.js
git commit -m "fix: port overlapping-chunk PII scan to Rust WASM core"
```

(Adjust staged paths to exactly what `npm run build:wasm` regenerated for pii-sanitizer; never stage other crates' outputs in this commit.)

### Task 6: Full validation gate, second run (added 2026-10-10)

- [ ] **Step 1: Run type check and validate**

Run: `npm run type-check`
Expected: exit 0.

Run: `npm run validate`
Expected: exit 0 (this time including the 7 parity tests).

- [ ] **Step 2: Record results in the PBI checkboxes** (`Definition of Done` in `dev-docs/archived/pbi/2026-10-10-16-fix-pii-long-token-scan-evasion.md`; check `validate green` only if exit 0), commit:

```bash
git add dev-docs/archived/pbi/2026-10-10-16-fix-pii-long-token-scan-evasion.md
git commit -m "docs: record PBI-16 validation results (WASM port)"
```
