# PBI-11: constantTimeCompareの実ブラウザ定数時間検証 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Source PBI:** `pbi/2026-07-25-11-fix-verify-constant-time-compare.md`（フェーズ0再調査済み・2026-07-27）

**Goal:** `constantTimeCompare()`のフォールバック実装（`src/utils/crypto.ts:74-90`）が実際に定数時間で動作するかを計測するベンチマークスクリプトを作成し、結果をADRとして記録する。

**制約（重要）**: このPBIの核心（実Chromeブラウザでの計測）は本セッション環境では実行できない。本計画は「計測スクリプトの作成」までを自動化可能な範囲として実施し、実際の計測実行と結果記録は人間の実行者が実ブラウザで行うことを前提とする。Task 3（実行・記録）は実装者向けの手順書として提供し、チェックボックスは実行者が手動でチェックする。

**Tech Stack:** Node.js（`.mjs`スクリプト）, 統計処理（平均・分散、簡易t検定）

---

## Task 1: ベンチマークスクリプトの作成（自動化可能）

**Files:**
- Create: `scripts/benchmark-constant-time-compare.mjs`

- [ ] **Step 1: 対象関数の現在の実装を確認する**

```bash
sed -n '50,91p' src/utils/crypto.ts
```

`constantTimeCompare(a, b)`のシグネチャ（`async`, 2引数の文字列, `Promise<boolean>`を返す）を確認する。スクリプトからこの関数を直接importできるか（ESM、`.js`拡張子import）を確認する。

- [ ] **Step 2: ベンチマークスクリプトを作成する**

```javascript
// scripts/benchmark-constant-time-compare.mjs
/**
 * Benchmarks constantTimeCompare()'s fallback path (src/utils/crypto.ts:74-90)
 * to check whether early-mismatch vs late-mismatch string pairs show a
 * statistically significant timing difference (PBI-11).
 *
 * This must be run inside the actual Chrome extension runtime (Service
 * Worker devtools console) to be meaningful — Node.js's V8 may JIT-optimize
 * differently than the extension's Service Worker context. See the
 * "Manual execution in Chrome" section below for how to run it there.
 *
 * Usage (Node.js, for local sanity-checking only — NOT the final verdict):
 *   node scripts/benchmark-constant-time-compare.mjs
 */

const ITERATIONS = 2000;
const STRING_LENGTH = 64;

// Inline copy of the fallback path from src/utils/crypto.ts:74-90 so this
// script has zero dependency on the extension's module graph and can run
// standalone in any JS runtime (Node, or pasted into a Chrome devtools
// console for the Service Worker).
async function constantTimeCompareFallback(a, b) {
  const maxLength = Math.max(a.length, b.length);
  let result = 0;
  result |= a.length ^ b.length;
  for (let i = 0; i < maxLength; i++) {
    const aChar = i < a.length ? a.charCodeAt(i) : 0;
    const bChar = i < b.length ? b.charCodeAt(i) : 0;
    result |= aChar ^ bChar;
  }
  return result === 0;
}

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/** Flips the char at `position` to guarantee a mismatch at that exact index. */
function mismatchAt(base, position) {
  const chars = base.split('');
  chars[position] = chars[position] === 'X' ? 'Y' : 'X';
  return chars.join('');
}

async function measure(a, b, iterations) {
  const durations = [];
  // Warm-up runs so JIT compilation doesn't skew the first measurements.
  for (let i = 0; i < 100; i++) await constantTimeCompareFallback(a, b);

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await constantTimeCompareFallback(a, b);
    durations.push(performance.now() - start);
  }
  return durations;
}

function mean(xs) {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function variance(xs, m) {
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
}

/** Welch's t-test (unequal variances). Returns the t-statistic. */
function welchT(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  const vx = variance(xs, mx), vy = variance(ys, my);
  const se = Math.sqrt(vx / xs.length + vy / ys.length);
  return (mx - my) / se;
}

async function main() {
  const base = randomString(STRING_LENGTH);

  // Early mismatch: differs at index 0.
  const earlyMismatch = mismatchAt(base, 0);
  // Late mismatch: differs at the last index.
  const lateMismatch = mismatchAt(base, STRING_LENGTH - 1);

  console.log(`Running ${ITERATIONS} iterations per case (string length ${STRING_LENGTH})...`);

  const earlyDurations = await measure(base, earlyMismatch, ITERATIONS);
  const lateDurations = await measure(base, lateMismatch, ITERATIONS);
  const matchDurations = await measure(base, base, ITERATIONS);

  const results = {
    earlyMismatch: { mean: mean(earlyDurations), variance: variance(earlyDurations, mean(earlyDurations)) },
    lateMismatch: { mean: mean(lateDurations), variance: variance(lateDurations, mean(lateDurations)) },
    match: { mean: mean(matchDurations), variance: variance(matchDurations, mean(matchDurations)) },
  };

  const tEarlyVsLate = welchT(earlyDurations, lateDurations);
  const tMatchVsLate = welchT(matchDurations, lateDurations);

  console.log('\n=== Results (ms per comparison) ===');
  console.table(results);
  console.log(`\nWelch's t (early-mismatch vs late-mismatch): ${tEarlyVsLate.toFixed(4)}`);
  console.log(`Welch's t (match vs late-mismatch): ${tMatchVsLate.toFixed(4)}`);
  console.log('\nInterpretation: |t| > ~1.96 suggests a statistically significant');
  console.log('difference at the 95% confidence level (rough heuristic, not a');
  console.log('substitute for a full timing-attack security audit).');

  return { results, tEarlyVsLate, tMatchVsLate };
}

// Works both as a Node.js script and pasted into a browser/SW console.
if (typeof module === 'undefined' || require.main === module) {
  main();
}
```

- [ ] **Step 3: Node.js環境でスクリプトが動作することを確認する（予備検証、最終結論ではない）**

```bash
node scripts/benchmark-constant-time-compare.mjs
```

Expected: エラーなく実行され、`console.table`で結果が出力される。この結果はNode.jsのV8挙動に基づくものであり、**Chromium拡張機能のService Worker環境での確定結果ではない**（PBI本文の指摘通り、実行環境が異なれば最適化の挙動も異なりうる）。

---

## Task 2: chrome.subtle.timingSafeEqualの利用可能性チェックスクリプト（自動化可能・前進の余地）

**Files:**
- Modify: `scripts/benchmark-constant-time-compare.mjs`（Task 1のスクリプトに追記）

フェーズ0再調査で指摘された「timingSafeEqualが使えるならフォールバックパス自体が実行されない」を確認するためのヘルパーをスクリプトに追加する。

- [ ] **Step 1: 利用可能性チェック関数を追記する**

```javascript
// scripts/benchmark-constant-time-compare.mjs に追記
function checkTimingSafeEqualAvailability() {
  const hasWebCrypto = typeof crypto !== 'undefined' && crypto.subtle;
  const hasTimingSafeEqual = hasWebCrypto && typeof crypto.subtle.timingSafeEqual === 'function';
  console.log('\n=== crypto.subtle.timingSafeEqual availability ===');
  console.log(`crypto.subtle present: ${hasWebCrypto}`);
  console.log(`timingSafeEqual present: ${hasTimingSafeEqual}`);
  if (hasTimingSafeEqual) {
    console.log('NOTE: In the actual extension runtime, if this is true, the');
    console.log('fallback path (measured above) is NEVER executed in production.');
    console.log('The benchmark above is then only relevant for browsers/versions');
    console.log('where timingSafeEqual is unavailable.');
  }
  return hasTimingSafeEqual;
}
```

`main()`関数の先頭で`checkTimingSafeEqualAvailability()`を呼び出すよう変更する。

- [ ] **Step 2: Node.js環境で実行し、Node.jsのcrypto.subtle対応状況を記録する（参考情報）**

```bash
node scripts/benchmark-constant-time-compare.mjs
```

Node.jsの結果は参考情報に留める。**確定判断には実際のChrome拡張機能のService Workerコンソールでの実行結果が必要**（Task 3参照）。

---

## Task 3: 実Chromeブラウザでの実行（人間の実行者が手動で行う。自動化不可）

**この Task は実装者（人間）が実際のブラウザで実施する必要がある。以下は実行手順書。**

- [ ] **Step 1: 拡張機能をビルドしChromeにロードする**

```bash
npm run build
```

`chrome://extensions`で本拡張機能を読み込み（デベロッパーモード、パッケージ化されていない拡張機能）。

- [ ] **Step 2: Service Workerのコンソールでスクリプトを実行する**

`chrome://extensions` → 本拡張機能の「Service Worker」リンクをクリックしてDevToolsを開く → Consoleタブに`scripts/benchmark-constant-time-compare.mjs`の中身を貼り付けて実行する（`main()`を明示的に呼び出す）。

- [ ] **Step 3: `crypto.subtle.timingSafeEqual`の利用可否を確認する**

出力される`checkTimingSafeEqualAvailability()`の結果を記録する。もし`true`（利用可能）であれば、本番のフォールバックパスは実行されないため、本PBIの緊急度は大幅に下がる。この場合、Step 4のベンチマーク結果は「利用不可な環境向けの参考情報」として扱う。

- [ ] **Step 4: ベンチマーク結果を記録する**

`main()`の出力（early-mismatch/late-mismatch/matchの平均・分散、Welchのt値）をスクリーンショットまたはコピーで記録する。

- [ ] **Step 5: 結果に基づきADRを作成する**

`dev-docs/ADR/2026-07-27-constant-time-compare-verification.md`として、以下を記録する:

```markdown
# ADR: constantTimeCompareフォールバック実装の定数時間性検証

## ステータス
[記録日]時点の結論を記載

## 検証環境
- Chrome バージョン: [記載]
- 実行コンテキスト: Service Worker DevTools Console
- 反復回数: 2000回/ケース

## crypto.subtle.timingSafeEqual の利用可能性
[利用可能 / 利用不可]

## ベンチマーク結果
[Task 3 Step 4の結果を転記]

## 結論
- timingSafeEqualが利用可能な場合: フォールバックパスは実行されないため対策不要。
  ただし将来的にAPIが非推奨化・削除された場合に備え、フォールバック実装は維持する。
- timingSafeEqualが利用不可、かつ|t| > 1.96相当の有意差が見られた場合: 追加の緩和策
  （定数時間比較ライブラリの採用、実装見直し）を検討するPBIを別途起票する。
- 有意差が見られなかった場合: 現状のフォールバック実装で対策十分と判断し、本PBIをクローズする。
```

---

## 全体検証

- [ ] `scripts/benchmark-constant-time-compare.mjs` が作成されている（Task 1, 2）
- [ ] Node.js環境で予備実行が成功する（最終結論ではない参考情報として）
- [ ] 実Chromeブラウザでの計測が実施され、ADRとして記録されている（Task 3、人間による実行が必須）
- [ ] `pbi/00-INDEX.md` の該当行を更新する（Task 1, 2完了、Task 3は「実行者による手動計測待ち」と明記）

## コミット方針

1. `test(scripts): constantTimeCompareのタイミング計測ベンチマークスクリプトを追加`（Task 1, 2）
2. `docs(adr): constantTimeCompareフォールバックの定数時間検証結果を記録`（Task 3完了後、人間が実施）

## 実装者への注記

このPBIは他の9件と異なり、**Task 1, 2はエージェントが完結できるが、Task 3は実ブラウザでの人間の操作が必須**という性質を持つ。エージェントに実装を委任する場合、Task 1, 2までの完了をもって「エージェントとして可能な範囲は完了」と報告し、Task 3はユーザー（人間）に手順書を渡して引き継ぐこと。
