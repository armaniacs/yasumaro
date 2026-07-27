#!/usr/bin/env node

/**
 * Benchmarks constantTimeCompare()'s fallback path (src/utils/crypto/index.ts:74-90)
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

// Inline copy of the fallback path from src/utils/crypto/index.ts:74-90 so this
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

function checkTimingSafeEqualAvailability() {
  const hasWebCrypto = typeof crypto !== 'undefined' && Boolean(crypto.subtle);
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

async function main() {
  checkTimingSafeEqualAvailability();

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
