/**
 * c6 — dashboard history panel query volume.
 *
 * Targets PBI 2026-09-04-07. Runs a realistic interaction sequence (page
 * 0->1->2->1->0, sort toggle) against a fake queryHistory + fake
 * chrome.storage.local, and reports how many queries and storage round-trips
 * that sequence costs.
 *
 * Custom counters: query_calls, storage_get, storage_set.
 */
import { importFromSource } from '../harness/bundle.mjs';

let createSqliteHistoryModel;

async function ensureLoaded() {
  if (!createSqliteHistoryModel) {
    const mod = await importFromSource('src/dashboard/panels/asyncData/sqliteHistoryModel.ts');
    createSqliteHistoryModel = mod.createSqliteHistoryModel;
  }
}

function installChromeStub(counters) {
  const store = new Map();
  const chrome = {
    storage: {
      local: {
        async get(key) {
          counters.storage_get++;
          if (key == null) return Object.fromEntries(store);
          if (typeof key === 'string') return store.has(key) ? { [key]: store.get(key) } : {};
          const out = {};
          for (const k of Array.isArray(key) ? key : Object.keys(key)) {
            if (store.has(k)) out[k] = store.get(k);
          }
          return out;
        },
        async set(obj) {
          counters.storage_set++;
          for (const [k, v] of Object.entries(obj)) store.set(k, v);
        },
      },
    },
  };
  const prev = globalThis.chrome;
  globalThis.chrome = chrome;
  return () => {
    globalThis.chrome = prev;
  };
}

export const definition = {
  id: 'c6',
  description: 'history panel query volume for an interaction sequence (PBI-07)',
  counters: ['query_calls', 'storage_get', 'storage_set'],
  sizes: [
    { key: 'S', n: 1 },
    { key: 'M', n: 3 },
    { key: 'L', n: 8 },
  ],
  async setup(size) {
    await ensureLoaded();
    const counters = { query_calls: 0, storage_get: 0, storage_set: 0 };
    const restoreChrome = installChromeStub(counters);

    const fakeRows = Array.from({ length: 20 }, (_, i) => ({ id: i, url: `https://x/${i}`, is_starred: 0 }));
    const queryHistory = async () => {
      counters.query_calls++;
      return { data: { rows: fakeRows, total: 500 } };
    };

    const model = createSqliteHistoryModel({ queryHistory, getSqliteStatus: async () => ({ fallback: false }) });

    return {
      counters,
      resetCounters() {
        counters.query_calls = 0;
        counters.storage_get = 0;
        counters.storage_set = 0;
      },
      snapshotCounters: () => ({ ...counters }),
      async _exercise() {
        // `size.n` repetitions of the paging round-trip sequence.
        for (let rep = 0; rep < size.n; rep++) {
          await model.fetchData({ page: 0 });
          await model.fetchData({ page: 1 });
          await model.fetchData({ page: 2 });
          await model.fetchData({ page: 1 });
          await model.fetchData({ page: 0 });
          await model.changeSort('created_at', 'ASC');
          await model.changeSort('created_at', 'DESC');
        }
      },
      _restore: restoreChrome,
    };
  },
  async run(ctx) {
    await ctx._exercise();
  },
  teardown(ctx) {
    ctx._restore();
  },
};
