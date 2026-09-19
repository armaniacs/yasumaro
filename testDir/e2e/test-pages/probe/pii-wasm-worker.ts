/**
 * pii-wasm-worker.ts
 *
 * Firefox probe worker for the PII sanitizer WASM core. Playwright cannot
 * install the extension into Firefox, so the extension-context init path
 * (chrome.runtime.getURL in a real extension service worker) stays under
 * manual QA — this worker answers the automatable part of the question:
 * does the committed pii_sanitizer_bg.wasm compile, instantiate, and mask
 * correctly inside Firefox's engine (SpiderMonkey) in a worker context,
 * the same engine class the Firefox extension service worker uses?
 *
 * The init path mirrors production (src/wasm/pii-sanitizer/index.ts):
 * the glue's default init fetches the binary from a same-origin URL.
 * Expected outputs are taken verbatim from wasm/pii-sanitizer/src/lib.rs's
 * unit tests, so a SpiderMonkey-specific miscompile or string-encoding
 * mismatch shows up as a concrete diff, not just "something failed".
 */
import initWasmModule, { sanitizePii } from '../../../../src/wasm/pii-sanitizer/piiSanitizerWasm.js';

interface CaseResult {
  name: string;
  ok: boolean;
  detail?: string;
}

interface ProbeResult {
  init: 'ok' | 'failed';
  cases: CaseResult[];
  allOk: boolean;
  fatal?: string;
}

interface WasmResult {
  text: string;
  maskedItems: Array<{ type: string; original: string; index?: number }>;
}

function runCase(
  name: string,
  input: string,
  expect: (result: WasmResult) => string | null,
): CaseResult {
  try {
    const result = sanitizePii(input) as unknown as WasmResult;
    const failure = expect(result);
    return failure ? { name, ok: false, detail: failure } : { name, ok: true };
  } catch (err) {
    return { name, ok: false, detail: String(err) };
  }
}

function expectKind(result: WasmResult, kind: string, original?: string): string | null {
  const items = result.maskedItems ?? [];
  if (items.length !== 1) {
    return `expected 1 masked item, got ${JSON.stringify(items)}`;
  }
  if (items[0].type !== kind) {
    return `expected type "${kind}", got "${items[0].type}"`;
  }
  if (original !== undefined && items[0].original !== original) {
    return `expected original "${original}", got "${items[0].original}"`;
  }
  return null;
}

async function main(): Promise<void> {
  let result: ProbeResult;
  try {
    // Same-origin URL fetch, mirroring the production
    // initWasmModule({ module_or_path: chrome.runtime.getURL(...) }) path.
    const wasmUrl = new URL('./pii-sanitizer.wasm', self.location.href).href;
    await initWasmModule({ module_or_path: wasmUrl });

    const cases: CaseResult[] = [
      runCase('email', 'contact me at user@example.com please', (r) => {
        const kindFailure = expectKind(r, 'email', 'user@example.com');
        if (kindFailure) return kindFailure;
        return r.text === 'contact me at [MASKED:email] please'
          ? null
          : `unexpected masked text: "${r.text}"`;
      }),
      runCase('creditCard (Luhn-valid)', 'card 4111-1111-1111-1111 done', (r) =>
        expectKind(r, 'creditCard'),
      ),
      runCase('creditCard (Luhn-invalid must not mask)', 'card 1234-5678-9012-3456 done', (r) =>
        (r.maskedItems ?? []).length === 0
          ? null
          : `Luhn-invalid card was masked: ${JSON.stringify(r.maskedItems)}`,
      ),
      runCase('myNumber', 'my number is 1234-5678-9012 ok', (r) => expectKind(r, 'myNumber')),
      runCase('phoneJp', 'call 03-1234-5678 now', (r) => expectKind(r, 'phoneJp')),
      runCase('bankAccount', 'account 1234567 ok', (r) => expectKind(r, 'bankAccount')),
      runCase('no PII passes through unchanged', 'nothing sensitive here', (r) =>
        r.text === 'nothing sensitive here' && (r.maskedItems ?? []).length === 0
          ? null
          : `unexpected result: ${JSON.stringify(r)}`,
      ),
    ];

    result = {
      init: 'ok',
      cases,
      allOk: cases.every((c) => c.ok),
    };
  } catch (err) {
    result = {
      init: 'failed',
      cases: [],
      allOk: false,
      fatal: err instanceof Error ? err.message : String(err),
    };
  }
  self.postMessage(result);
}

void main();
