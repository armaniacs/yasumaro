/**
 * f4 — log export/import round-trip at gate scale (PBI 2026-11-26-17).
 *
 * Measured unit, one iteration: the REAL production roundtrip
 *
 *   exportJson()  ->  blob.text()  ->  importFromJson(text)
 *
 * with src/dashboard/exportLogsService.ts and src/dashboard/importLogsService.ts
 * bundled verbatim through bench/harness/bundle.mjs (the f3/c6 seam). The layer
 * boundary this bench measures, explicitly:
 *
 *   INCLUDED (production code, unmodified):
 *   - export: keyset paging (QUERY_CAPS.plain pages, until-cursor inclusive
 *     re-read, id dedup, frozen total), envelope build, the double
 *     JSON.stringify, and the real HMAC-SHA256 signature (exportHmacSigner)
 *   - import: the MAX_IMPORT_TEXT_BYTES pre-parse gate, JSON.parse, HMAC
 *     verification, legacy alias normalization, strict row validation
 *     (validateImportRowWithOptions -> layer-0 validateImportRow), the
 *     IMPORT_TOTAL_ROW_CAP check, 200-row batch slicing, and the per-batch
 *     DASHBOARD_SQLITE send (confirm-token request + import message) through
 *     the real dashboardGateway / MessageTransport envelope + timeout path
 *
 *   EXCLUDED: the sqlite-wasm engine and OPFS I/O. The service-worker side of
 *   each message (records query, INSERT OR IGNORE batches) is served by the
 *   chrome.runtime.sendMessage stub below from plain arrays built in setup
 *   (unmeasured). This is the "up to validateImportRow, DB writes excluded"
 *   boundary the PBI prescribes; the per-batch wire cost stays IN because it
 *   is dashboard-side production work, not the DB. The stub hands over the
 *   same plain object references the vitest roundtrip pins (PBI 04/05) do, so
 *   the numbers stay comparable with those pins; the browser-internal wire
 *   serialization is out of scope on both sides. blob.text() stands in for
 *   reading the downloaded file back.
 *
 * chrome seam: the bundled modules run against a globalThis.chrome stub (c6
 * precedent, extended to runtime.sendMessage). storage.local carries a LEGACY
 * PLAINTEXT hmac_secret: the pre-PBI-25-25 shape getOrCreateHmacSecret still
 * serves today (its migration defers when the KEK store is unavailable), which
 * is what lets the real signing path run without IndexedDB. storage.session
 * backs the hmacKeyStore KEK cache for the same reason. The stub is installed
 * once per process and never restored: the bundled services cache the resolved
 * HMAC secret at module scope, so a teardown restore would leave later
 * iterations holding a cache keyed to a storage that no longer exists, and the
 * bench process is dedicated anyway.
 *
 * Row scales:
 * - f4    lightweight (url + created_at only, the PBI 04 pin shape). The row
 *   count is MAX_EXPORT_ROWS read from src/utils/limits.ts via the harness
 *   bundle, so the measured scale follows the constant instead of a literal.
 *   limits.ts is @layer 0 pure constants, so bundling it at module scope is
 *   safe here; the service bundles stay lazy in setup (f3 rule: the smoke test
 *   must never bundle the production handler graph).
 * - f4-ff full fidelity (title/summary/tags/domain/is_starred at real-data
 *   lengths, the PBI 05 pin shape), 50,000 rows = the PBI 05 pin scale
 *   (27.8 MB, inside the 30 MiB gate). The count is deliberately FIXED, not
 *   gate-derived: the persisted trend line compares one generation of this
 *   bench to the next, and a size that silently follows the constant would mix
 *   scales in that line. If MAX_IMPORT_TEXT_BYTES ever shrinks below this
 *   scale, the gate check in run() fails the bench loudly instead of silently
 *   measuring a rejected file.
 *
 * peak RSS: sampled every 5ms across each run and printed to stderr from
 * teardown as an ADVISORY line. It deliberately does not flow through the
 * runner's counters mechanism: every snapshot counter becomes a CI-gated
 * `counter_*` metric (bench/harness/report.mjs gatesRegression), and an
 * RSS counter is machine-dependent, so baselining it would flake bench:check.
 * Read the two numbers differently: the delta is the per-iteration signal
 * (first iteration includes first-touch growth, later ones only reuse), while
 * the peak is the process-wide high-water mark during the run — cli.mjs runs
 * all benches in one process, so residue from earlier benches (notably f3's
 * sqlite-wasm heap) inflates it. For a clean-process peak, run
 * `npm run bench:micro -- --filter f4`.
 */
import { importFromSource } from '../harness/bundle.mjs';

// Layer-0 constants only (no chrome surface): safe to bundle eagerly so the
// runner's eager `sizes` read sees the real production values.
const limits = await importFromSource('src/utils/limits.ts');
const MAX_EXPORT_ROWS = limits.MAX_EXPORT_ROWS;
const MAX_IMPORT_TEXT_BYTES = limits.MAX_IMPORT_TEXT_BYTES;
const QUERY_CAPS = limits.QUERY_CAPS;

// PBI 05 pin scale (logExportImportRoundtripFullFidelity.test.ts): 50,000
// full-fidelity rows at ~557 B/row pretty-printed = 27.8 MB, inside the gate.
const FULL_FIDELITY_ROWS = 50_000;

// Fixed bench-only placeholder (base64 of ASCII), NOT a credential: it takes
// the legacy-plaintext read path in getOrCreateHmacSecret, which only requires
// a non-empty string. 32 bytes of material, like the production secret.
const BENCH_HMAC_SECRET = 'YmVuY2gtb25seS1oYWMtc2VjcmV0LTMyLWJ5dGVzLXBsYWNlaG9sZGVyIQ==';

// The in-memory "service worker" the sendMessage stub serves from. setup()
// swaps the rows per size; teardown() releases them.
const db = { rows: [], total: 0 };

let services = null;

function installChromeStub() {
  const local = new Map([['hmac_secret', BENCH_HMAC_SECRET]]);
  const session = new Map();

  const makeArea = (store) => ({
    async get(key) {
      if (key == null) return Object.fromEntries(store);
      if (typeof key === 'string') return store.has(key) ? { [key]: store.get(key) } : {};
      const out = {};
      for (const k of Array.isArray(key) ? key : Object.keys(key)) {
        if (store.has(k)) out[k] = store.get(k);
      }
      return out;
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) store.set(k, v);
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
  });

  globalThis.chrome = {
    runtime: {
      // DASHBOARD_SQLITE router: the DB boundary of this bench. 'query' pages
      // newest-first with an inclusive until cursor (queryAllData's contract);
      // 'import' is not token-exempt, so the gateway asks for a confirm token
      // before each batch and both must be answered. Anything else (logger
      // fire-and-forget) gets the same undefined an absent receiver would
      // produce, which the callers already tolerate.
      sendMessage: async (message) => {
        const payload = message?.payload;
        if (message?.type !== 'DASHBOARD_SQLITE' || !payload) return undefined;
        if (payload.subtype === 'query') {
          const until = typeof payload.until === 'number' ? payload.until : Number.POSITIVE_INFINITY;
          const page = db.rows.filter((r) => r.created_at <= until).slice(0, payload.limit ?? QUERY_CAPS.plain);
          return { success: true, rows: page, total: db.total };
        }
        if (payload.subtype === 'create_confirm_token') return { success: true, confirmToken: 'bench-token' };
        if (payload.subtype === 'import') {
          return { success: true, inserted: payload.rows.length, skipped: 0, total: payload.rows.length };
        }
        return { success: false, error: 'f4 stub: unsupported subtype' };
      },
    },
    storage: {
      local: makeArea(local),
      session: makeArea(session),
      onChanged: { addListener() {} },
    },
  };
}

async function ensureLoaded() {
  installChromeStub();
  if (!services) {
    const exportSvc = await importFromSource('src/dashboard/exportLogsService.ts');
    const importSvc = await importFromSource('src/dashboard/importLogsService.ts');
    services = { exportJson: exportSvc.exportJson, importFromJson: importSvc.importFromJson };
  }
}

// Same shapes as the vitest roundtrip pins: logExportImportRoundtrip100k
// (lightweight) and logExportImportRoundtripFullFidelity (full fidelity), so a
// bench generation stays comparable with the recorded pin numbers.
function lightweightRows(n) {
  const base = 1_700_000_000_000;
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, url: 'u', created_at: base - i }));
}

function fullFidelityRows(n) {
  const base = 1_700_000_000_000;
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    url: `https://example.com/articles/why-testing-matters-in-large-codebases/entry-${i}`,
    title: `Article ${i}: why round-trip invariants keep browsing-log migrations honest`,
    summary:
      `Reading session ${i}: visited the article and stayed for the full read. ` +
      'The page covered keyset paging and how the recorder batches writes under load.',
    tags: JSON.stringify(['testing', 'migration', 'round-trip', 'long-term']),
    domain: 'example.com',
    created_at: base - i,
    is_starred: i % 10 === 0 ? 1 : 0,
  }));
}

// 5ms is well under any human-noticeable overhead and dense enough to catch
// the allocation plateaus of the stringify/parse phases.
const RSS_SAMPLE_INTERVAL_MS = 5;

async function roundtrip(ctx) {
  const rssBefore = process.memoryUsage().rss;
  let rssPeak = rssBefore;
  const sampler = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > rssPeak) rssPeak = rss;
  }, RSS_SAMPLE_INTERVAL_MS);

  try {
    const blob = await services.exportJson();
    const text = await blob.text();
    if (text.length > MAX_IMPORT_TEXT_BYTES) {
      throw new Error(
        `f4: export file (${text.length} chars) exceeds MAX_IMPORT_TEXT_BYTES (${MAX_IMPORT_TEXT_BYTES}) — ` +
        'the gate moved below the measured scale; re-derive the bench size',
      );
    }
    const result = await services.importFromJson(text);

    if ('error' in result) {
      throw new Error(`f4: importFromJson rejected the file: ${result.error}`);
    }
    if (result.inserted !== ctx.rowCount || result.skipped !== 0) {
      throw new Error(
        `f4: roundtrip mismatch: inserted=${result.inserted} skipped=${result.skipped} expected=${ctx.rowCount}`,
      );
    }
    ctx.rss = { before: rssBefore, peak: rssPeak, after: process.memoryUsage().rss };
    return text.length;
  } finally {
    // Every failure path throws through here: without the finally, a rejected
    // gate check leaves the sampler ticking for the rest of the bench run.
    clearInterval(sampler);
  }
}

const MB = 1024 * 1024;

function makeDefinition(id, description, rowsFor) {
  return {
    id,
    description,
    // No snapshot counters on purpose: see the header — RSS must not become a
    // gated counter_*, and this bench has no other deterministic call counts
    // worth gating.
    counters: [],
    sizes: [{ key: 'gate', n: rowsFor === 'lightweight' ? MAX_EXPORT_ROWS : FULL_FIDELITY_ROWS }],
    warmup: 1,
    measure: 3,
    async setup(size) {
      await ensureLoaded();
      const rows = rowsFor === 'lightweight' ? lightweightRows(size.n) : fullFidelityRows(size.n);
      db.rows = rows;
      db.total = rows.length;
      return {
        rowCount: rows.length,
        label: `${id}[${size.key}]`,
        rss: null,
      };
    },
    async run(ctx) {
      await roundtrip(ctx);
    },
    teardown(ctx) {
      if (ctx.rss) {
        const { before, peak, after } = ctx.rss;
        process.stderr.write(
          `[${ctx.label}] rss advisory (machine-dependent, not gated): ` +
          `delta +${((after - before) / MB).toFixed(1)}MB, peak ${(peak / MB).toFixed(1)}MB\n`,
        );
      }
      db.rows = [];
      db.total = 0;
    },
  };
}

export const definition = makeDefinition(
  'f4',
  'log export/import roundtrip, lightweight rows at MAX_EXPORT_ROWS (PBI 2026-11-26-17)',
  'lightweight',
);

export const definitionFf = makeDefinition(
  'f4-ff',
  'log export/import roundtrip, full-fidelity rows at the PBI 05 pin scale (PBI 2026-11-26-17)',
  'full-fidelity',
);
