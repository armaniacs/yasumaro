/**
 * content-hotpath-measure.mjs — one-off measurement for PBI 25-28 (v2).
 *
 * v1 used PerformanceObserver 'longtask', which empirically never fires for
 * evaluate-driven work in this Chromium (headless or headed: a 200ms busy
 * loop yields zero entries). v2 drops the observer: a synchronous run of W
 * ms IS one main-thread task, so longtask ⟺ W > 50ms follows directly from
 * per-run wall times. Chunked variants record per-chunk walls for the same
 * reason (a chunk under 50ms can never be a longtask).
 *
 * Variants (same page, same DOM):
 *   A sync      — extractMainContentWithInfo() as-is, single-run walls ×5.
 *   B chunked   — prototype: the same extractor per top-level section chunk
 *                 with a real yield between chunks (scheduler.yield when
 *                 present, else setTimeout(0)). Records per-chunk max + total.
 *   C offscreen — simulated: outerHTML serialize + MessageChannel round-trip
 *                 + DOMParser + extract. Slice walls recorded separately; in
 *                 real offscreen the parse+extract leaves the main thread.
 *
 * Throttling: 1x (this machine) and 4x (repo bench practice, low-end proxy).
 * Usage: node bench/e2e/content-hotpath-measure.mjs
 * Output: bench/reports/hotpath-<date>.json (gitignored) + stdout table.
 * NOT a gate test: *.mjs does not match the bench testMatch (*.bench.ts).
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const REPORT_DIR = resolve(__dirname, '..', 'reports');
const PORT = 8110;

async function waitForPort(port, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    try {
      await new Promise((res, rej) => {
        const s = net.connect(port, '127.0.0.1', () => {
          s.end();
          res();
        });
        s.on('error', rej);
      });
      return;
    } catch {
      if (Date.now() - start > timeoutMs) throw new Error('fixture server did not start');
      // eslint-disable-next-line local/no-test-sleep -- bounded external-process readiness poll (bench fixture server); aborts via timeoutMs, not a test assertion wait
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

async function main() {
  const { chromium } = await import('playwright');
  const esbuild = await import('esbuild');

  const outPath = resolve(__dirname, '.hotpath-bundle.js');
  await esbuild.build({
    entryPoints: [resolve(ROOT, 'src/utils/contentExtractor/index.ts')],
    bundle: true,
    format: 'iife',
    globalName: '__EXT',
    platform: 'browser',
    target: 'chrome120',
    outfile: outPath,
    logLevel: 'silent',
    resolveExtensions: ['.ts', '.mjs', '.js', '.json'],
  });

  const server = spawn('node', ['server.mjs'], { cwd: __dirname, stdio: 'ignore' });
  try {
    await waitForPort(PORT);
    const browser = await chromium.launch({ headless: true });
    try {
      const results = {};
      for (const page of ['news', 'spa']) {
        results[page] = {};
        for (const scale of [8, 16, 32]) {
          results[page][scale] = {
            throttle4x: await measurePage(browser, outPath, page, scale, 4),
            throttle1x: await measurePage(browser, outPath, page, scale, 1),
          };
        }
      }
      mkdirSync(REPORT_DIR, { recursive: true });
      const stamp = new Date().toISOString().slice(0, 10);
      const out = resolve(REPORT_DIR, `hotpath-${stamp}.json`);
      writeFileSync(out, JSON.stringify({ results }, null, 2));
      console.log(`wrote ${out}`);
      printTable(results);
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
  }
}

function printTable(results) {
  for (const [page, scales] of Object.entries(results)) {
    for (const [scale, throttles] of Object.entries(scales)) {
      for (const [thr, v] of Object.entries(throttles)) {
        console.log(
          `${page} scale=${scale} ${thr}: ` +
            `A max=${v.A.maxMs.toFixed(1)}ms mean=${v.A.meanMs.toFixed(1)}ms ` +
            `(longtask:${v.A.maxMs > 50 ? 'YES' : 'no'}) | ` +
            `B chunkmax=${v.B.chunkMaxMs.toFixed(1)}ms total=${v.B.totalMs.toFixed(1)}ms ` +
            `yield=${v.B.yieldKind} (longtask:${v.B.chunkMaxMs > 50 ? 'YES' : 'no'}) | ` +
            `C ser=${v.C.serMs.toFixed(1)}ms rt=${v.C.rtMs.toFixed(1)}ms ` +
            `parse=${v.C.parseMs.toFixed(1)}ms ext=${v.C.extMs.toFixed(1)}ms bytes=${v.C.bytes}`,
        );
      }
    }
  }
}

async function measurePage(browser, bundlePath, page, scale, throttle) {
  const context = await browser.newContext();
  try {
    const pg = await context.newPage();
    if (throttle > 1) {
      const cdp = await context.newCDPSession(pg);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    }
    await pg.addInitScript(() => {
      window.__hasYield = typeof window.scheduler?.yield === 'function';
    });
    await pg.goto(`http://localhost:${PORT}/${page}?scale=${scale}`, { waitUntil: 'load' });
    await pg.addScriptTag({ path: bundlePath });
    const canExtract = await pg.evaluate(() => typeof window.__EXT?.extractMainContentWithInfo === 'function');
    if (!canExtract) throw new Error('bundle did not expose the extractor');
    const yieldKind = await pg.evaluate(() => (window.__hasYield ? 'scheduler.yield' : 'setTimeout(0)'));

    // A: single-run walls ×5 (each run = one main-thread task).
    const runs = await pg.evaluate(() => {
      const walls = [];
      let chars = 0;
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        chars = window.__EXT.extractMainContentWithInfo(
          10000,
          { cleanseEnabled: true },
          { aiSummaryCleanseEnabled: false },
        ).content.length;
        walls.push(performance.now() - t0);
      }
      return { walls, chars };
    });

    // B: chunked prototype with per-chunk walls.
    const chunked = await pg.evaluate(async () => {
      const yield_ = window.__hasYield
        ? () => window.scheduler.yield()
        : () => new Promise((r) => setTimeout(r, 0));
      const kids = [...document.body.children];
      const N = 8;
      const size = Math.max(1, Math.ceil(kids.length / N));
      const chunkWalls = [];
      const t0 = performance.now();
      for (let c = 0; c < N; c++) {
        const slice = kids.slice(c * size, (c + 1) * size);
        const hidden = [];
        for (const el of kids) {
          if (!slice.includes(el)) {
            hidden.push([el, el.style.display]);
            el.style.display = 'none';
          }
        }
        const tc = performance.now();
        try {
          window.__EXT.extractMainContentWithInfo(10000, { cleanseEnabled: true }, {});
        } finally {
          for (const [el, d] of hidden) el.style.display = d;
        }
        chunkWalls.push(performance.now() - tc);
        await yield_();
      }
      return { chunkWalls, total: performance.now() - t0 };
    });

    // C: offscreen slices.
    const off = await pg.evaluate(async () => {
      const t0 = performance.now();
      const html = document.documentElement.outerHTML;
      const tSer = performance.now();
      const echoed = await new Promise((res) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => res(e.data);
        ch.port2.postMessage(html);
      });
      const tRt = performance.now();
      const doc = new DOMParser().parseFromString(echoed, 'text/html');
      const tParse = performance.now();
      const holder = document.createElement('div');
      holder.innerHTML = doc.body.innerHTML;
      document.body.appendChild(holder);
      try {
        window.__EXT.extractMainContentWithInfo(10000, { cleanseEnabled: true }, {});
      } finally {
        holder.remove();
      }
      const tExt = performance.now();
      return {
        ser: tSer - t0,
        rt: tRt - tSer,
        parse: tParse - tRt,
        ext: tExt - tParse,
        bytes: html.length,
      };
    });

    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    return {
      A: { maxMs: Math.max(...runs.walls), meanMs: mean(runs.walls), chars: runs.chars },
      B: { chunkMaxMs: Math.max(...chunked.chunkWalls), totalMs: chunked.total, yieldKind },
      C: { serMs: off.ser, rtMs: off.rt, parseMs: off.parse, extMs: off.ext, bytes: off.bytes },
    };
  } finally {
    await context.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
