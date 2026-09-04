/**
 * c5 — content-script periodic polling cost.
 *
 * Targets PBI 2026-09-04-02. Drives ContentKernel with a FakeScheduler and a
 * fake clock over `virtualSeconds` of wall time during which the visit
 * threshold is never met, then reports how many times `scheduler.schedule` was
 * invoked and the total time spent inside scheduled callbacks.
 *
 * Custom counters (not DOM counters): schedule_calls, callback_ms.
 */
import { performance } from 'node:perf_hooks';
import { setupDom } from '../harness/domEnv.mjs';
import { importFromSource } from '../harness/bundle.mjs';

let ContentKernel;
let FakeScheduler;

async function ensureLoaded() {
  if (!ContentKernel) {
    const mod = await importFromSource('src/content/contentKernel.ts');
    ContentKernel = mod.ContentKernel;
    FakeScheduler = mod.FakeScheduler;
  }
}

/** Scheduler that records call count + callback time and drains on demand. */
function makeCountingScheduler() {
  const inner = new FakeScheduler();
  let scheduleCalls = 0;
  let callbackMs = 0;
  const wrapped = {
    schedule(cb) {
      scheduleCalls++;
      return inner.schedule(() => {
        const t0 = performance.now();
        cb();
        callbackMs += performance.now() - t0;
      });
    },
    cancel(id) {
      inner.cancel(id);
    },
    /** One flush per call — mimics a single idle callback firing this frame. */
    tick() {
      if (inner.pendingCount() > 0) inner.flush();
    },
    stats() {
      return { schedule_calls: scheduleCalls, callback_ms: callbackMs };
    },
  };
  return wrapped;
}

const storageStub = {
  get: async () => ({ settings: { minVisitDuration: 5, minScrollDepth: 50 } }),
  set: async () => {},
};
const domainPolicyStub = {
  shouldSkip: () => false,
  checkDomainAllowedFromCache: async () => ({ allowed: true, useCache: false }),
};

export const definition = {
  id: 'c5',
  description: 'content-script polling over virtual time (PBI-02)',
  counters: ['schedule_calls', 'callback_ms'],
  // Sizes map to virtual seconds of "threshold never met" polling.
  sizes: [
    { key: 'S', n: 10 },
    { key: 'M', n: 30 },
    { key: 'L', n: 120 },
  ],
  async setup(size) {
    await ensureLoaded();
    const env = setupDom('<article><p>short</p></article>', { url: 'https://bench.local/page' });

    let now = 0;
    const clock = () => now;
    const scheduler = makeCountingScheduler();
    const kernel = new ContentKernel(storageStub, domainPolicyStub, clock, scheduler, {
      isE2ETest: () => false,
    });

    return {
      env,
      counters: {},
      resetCounters() {},
      snapshotCounters() {
        return scheduler.stats();
      },
      async _exercise() {
        await kernel.loadSettings();
        kernel.startPeriodicCheck();
        // Advance virtual time in 1s steps; the current impl re-schedules each
        // idle callback, so draining after every tick mimics the browser.
        for (let s = 0; s < size.n; s++) {
          now += 1000;
          scheduler.tick();
        }
        kernel.stopPeriodicCheck();
      },
    };
  },
  async run(ctx) {
    await ctx._exercise();
  },
  teardown(ctx) {
    ctx.env.teardown();
  },
};
