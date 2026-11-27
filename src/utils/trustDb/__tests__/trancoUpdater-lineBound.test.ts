/**
 * trancoUpdater-lineBound.test.ts
 * VULN-060 (CWE-400): tranco CSV parse must bound the derived line array to
 * the tier size BEFORE materializing it, with output parity to the legacy
 * whole-split contract for in-bounds inputs.
 */

import type { Mock } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Crypto } from '@peculiar/webcrypto';
Object.defineProperty(global, 'crypto', {
    value: new Crypto()
});

// logger モック
vi.mock('../../logger/types.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'fn',
    logError: 'fn',
    logWarn: 'fn',
    ErrorCode: { TRANCO_FETCH_FAILED: 'TRANCO_FETCH_FAILED' },
  }),
);
vi.mock('../../logger/core.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'fn',
    logError: 'fn',
    logWarn: 'fn',
    ErrorCode: { TRANCO_FETCH_FAILED: 'TRANCO_FETCH_FAILED' },
  }),
);
vi.mock('../../logger/api.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'fn',
    logError: 'fn',
    logWarn: 'fn',
    ErrorCode: { TRANCO_FETCH_FAILED: 'TRANCO_FETCH_FAILED' },
  }),
);

// fetch モック — redirect seam は実物を維持 (trancoUpdater.test.ts と同じ)
vi.mock('../../fetch.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../fetch.js')>();
    return {
        ...actual,
        fetchWithTimeout: vi.fn(),
    };
});

// trustDb モック — mutation seam owns lifecycle (TrustDbAdmin)
const mockDb = {
    initialize: vi.fn(async () => {}),
    // 引数型を宣言しないと mock.calls が [] に推論され、fetchedDomains の calls[0][0] が型エラーになる
    updateTranco: vi.fn(async (_domains: string[], _tier: TrancoTier) => {}),
};
vi.mock('../TrustDbAdmin.js', () => ({
    getTrustDbAdmin: vi.fn(() => mockDb)
}));

import { TrancoUpdater } from '../trancoUpdater.js';
import { fetchWithTimeout } from '../../fetch.js';
import type { TrancoTier, TrancoUpdateResult } from '../trustDbSchema.js';

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

// 修正前 (VULN-060 脆弱状態) の parseTrancoCSV の凍結コピー。現行実装からは
// import できないのでレガシー契約の出力 pin として意図的に複製している。
const LEGACY_DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*\.?$/i;
function legacyParseTrancoCSV(csvText: string, limit: number): string[] {
  const lines = csvText.trim().split('\n');
  const domains: string[] = [];
  for (const line of lines) {
    const [_rank, domain] = line.split(',');
    if (domain && domains.length < limit) {
      const trimmedDomain = domain.trim().toLowerCase();
      if (trimmedDomain.length <= 253 && LEGACY_DOMAIN_REGEX.test(trimmedDomain) && !trimmedDomain.startsWith('.') && !trimmedDomain.endsWith('.')) {
        domains.push(trimmedDomain);
      }
    }
    if (domains.length >= limit) {
      break;
    }
  }
  return domains;
}

async function runUpdate(csv: string, tier: TrancoTier = 'top1k'): Promise<TrancoUpdateResult> {
  (fetchWithTimeout as Mock)
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ list_id: 'line-bound-test' }) })
    .mockResolvedValueOnce({ ok: true, status: 200, text: async () => csv });
  return new TrancoUpdater({ sleep: async () => {} }).updateTrancoList(tier);
}

function fetchedDomains(): string[] {
  expect(mockDb.updateTranco).toHaveBeenCalledTimes(1);
  return mockDb.updateTranco.mock.calls[0]![0] as string[];
}

const PARITY_INPUTS: Array<[string, string]> = [
  ['LF well-formed', '1,google.com\n2,youtube.com\n3,facebook.com'],
  ['CRLF with trailing newline', '1,google.com\r\n2,youtube.com\r\n3,facebook.com\r\n'],
  ['CRLF without trailing newline', '1,google.com\r\n2,youtube.com'],
  ['blank lines between entries', '1,google.com\n\n2,youtube.com\n\n'],
  ['leading newlines', '\n\n1,google.com\n2,youtube.com'],
  ['trailing CRLF blank lines', '1,google.com\r\n\r\n2,youtube.com\r\n\r\n'],
  ['no trailing newline', '1,google.com\n2,youtube.com'],
  ['empty body', ''],
  ['whitespace-only body', '   \n  \n\t\n'],
  ['comma-less first line', '1\n2,youtube.com'],
  ['invalid domain before valid', '1,bad domain!\n2,google.com'],
  ['leading and trailing spaces on the line', '  1,google.com  '],
  ['uppercase domains fold to lowercase', '1,GOOGLE.COM\n2,YouTube.COM'],
  ['comma inside value keeps the second field', '1,a,b.com'],
  ['leading dot and trailing dot both rejected', '1,.google.com\n2,google.com.'],
  ['over-253-char domain rejected', `1,${'a'.repeat(250)}.com\n2,ok.com`],
  ['single line', '1,google.com'],
  ['only commas', ',\n,\n'],
];

const BODY_BYTES = 12 * 1024 * 1024;

function buildDenseCsv(): string {
  // First 1000 lines valid: the top1k tier limit stops the parse there. The
  // padding exists only to be line-split — under the legacy contract it
  // materialized ~6M array entries before the limit could fire.
  const valid = Array.from({ length: 1000 }, (_, i) => `1,aaa${i}.co`).join('\n');
  const pad = 'x\n'.repeat(Math.ceil((BODY_BYTES - valid.length) / 2));
  return valid + '\n' + pad;
}

function buildFlatCsv(): string {
  // Same byte size as the dense body but a single line with no comma: no
  // line-split amplification is possible, so its RSS delta is the read-path
  // baseline (0 domains parsed).
  return 'x'.repeat(BODY_BYTES);
}

function streamResponse(bytes: Uint8Array): Record<string, unknown> {
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => {
        let sent = false;
        return {
          read: () => {
            if (sent) return Promise.resolve({ done: true, value: undefined });
            sent = true;
            return Promise.resolve({ done: false, value: bytes });
          },
          cancel: () => Promise.resolve(),
        };
      },
    },
  };
}

async function rssFloor(samples = 3): Promise<number> {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < samples; i++) {
    min = Math.min(min, process.memoryUsage().rss);
    await new Promise((r) => setImmediate(r));
  }
  return min;
}

async function rssCeil(samples = 3): Promise<number> {
  let max = 0;
  for (let i = 0; i < samples; i++) {
    max = Math.max(max, process.memoryUsage().rss);
    await new Promise((r) => setImmediate(r));
  }
  return max;
}

describe('trancoUpdater line bound (VULN-060)', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('legacy contract parity (inputs within the tier line count)', () => {
    test.each(PARITY_INPUTS)('parity: %s', async (_label, csv) => {
      const result = await runUpdate(csv);

      expect(result.success).toBe(true);
      expect(fetchedDomains()).toEqual(legacyParseTrancoCSV(csv, 1000));
      expect(result.domainsCount).toBe(fetchedDomains().length);
    });
  });

  describe('early line bound (new contract)', () => {
    test('top10k stops at 10,000 domains from a 12,000-line body', async () => {
      const csv = Array.from({ length: 12_000 }, (_, i) => `${i + 1},dom${i}.example.com`).join('\n');
      const result = await runUpdate(csv, 'top10k');

      expect(result.success).toBe(true);
      expect(result.domainsCount).toBe(10_000);
      const domains = fetchedDomains();
      expect(domains).toHaveLength(10_000);
      expect(domains[0]).toBe('dom0.example.com');
      expect(domains[9_999]).toBe('dom9999.example.com');
    });

    test('top100k stops at 100,000 domains from a 100,001-line body', async () => {
      const csv = Array.from({ length: 100_001 }, (_, i) => `${i + 1},dom${i}.example.com`).join('\n');
      const result = await runUpdate(csv, 'top100k');

      expect(result.success).toBe(true);
      expect(result.domainsCount).toBe(100_000);
    });

    test('fewer lines than the tier bound returns every valid domain', async () => {
      const csv = '1,google.com\n2,youtube.com\n3,facebook.com';
      const result = await runUpdate(csv, 'top100k');

      expect(result.success).toBe(true);
      expect(fetchedDomains()).toEqual(legacyParseTrancoCSV(csv, 100_000));
    });

    // BDD: tier limit を超えた行は解析されない (early bound)。レガシー契約は
    // tier 埋まりまで行数無制限に走り続けた — この発散は修正の意図された契約。
    test('lines beyond the tier bound are never parsed even when the tier fill is incomplete', async () => {
      const head = Array.from({ length: 1000 }, (_, i) =>
        i % 5 < 3 ? `${i + 1},dom${i}.com` : `${i + 1},bad domain!`).join('\n');
      const tail = Array.from({ length: 500 }, (_, i) => `1,filler${i}.com`).join('\n');
      const result = await runUpdate(head + '\n' + tail, 'top1k');

      expect(result.success).toBe(true);
      const domains = fetchedDomains();
      expect(domains).toHaveLength(600);
      expect(domains.every((d) => d.startsWith('dom'))).toBe(true);
    });
  });

  describe('retry loop', () => {
    test('the line bound applies on every retry attempt', async () => {
      const csv = Array.from({ length: 1000 }, (_, i) => `1,aaa${i}.co`).join('\n')
        + '\n' + 'x\n'.repeat(100_000);
      mockDb.updateTranco.mockRejectedValueOnce(new Error('db unavailable'));
      (fetchWithTimeout as Mock)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ list_id: 'retry' }) })
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => csv })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ list_id: 'retry' }) })
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => csv });

      const result = await new TrancoUpdater({ sleep: async () => {} }).updateTrancoList('top1k');

      expect(result.success).toBe(true);
      expect(result.domainsCount).toBe(1000);
      expect((fetchWithTimeout as Mock).mock.calls).toHaveLength(4);
      expect(mockDb.updateTranco).toHaveBeenCalledTimes(2);
      for (const [domains] of mockDb.updateTranco.mock.calls) {
        expect(domains).toHaveLength(1000);
      }
    });
  });

  describe('exploit pin: 12MB newline-dense body', () => {
    test('stops at the tier limit with RSS amplification under 2x of the body', async () => {
      const denseBytes = new TextEncoder().encode(buildDenseCsv());
      const flatBytes = new TextEncoder().encode(buildFlatCsv());
      const bodyBytes = denseBytes.byteLength;

      (fetchWithTimeout as Mock)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ list_id: 'dense' }) })
        .mockResolvedValueOnce(streamResponse(denseBytes));
      const beforeDense = await rssFloor();
      const denseResult = await new TrancoUpdater({ sleep: async () => {} }).updateTrancoList('top1k');
      const afterDense = await rssCeil();
      const deltaDense = afterDense - beforeDense;

      expect(denseResult.success).toBe(true);
      // The tier limit HOLDS in the output — exactly 1000 domains.
      expect(denseResult.domainsCount).toBe(1000);

      (fetchWithTimeout as Mock)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ list_id: 'flat' }) })
        .mockResolvedValueOnce(streamResponse(flatBytes));
      const beforeFlat = await rssFloor();
      const flatResult = await new TrancoUpdater({ sleep: async () => {} }).updateTrancoList('top1k');
      const afterFlat = await rssCeil();
      const deltaFlat = afterFlat - beforeFlat;

      expect(flatResult.success).toBe(true);
      expect(flatResult.domainsCount).toBe(0);

      // PBI pin: RSS growth stays under 2x the 12MB body (legacy: ~9.5x,
      // >80MB on this body). Same 2x cap on the dense-vs-flat difference —
      // measured ~0.6x after the fix, ~8x under the legacy whole-split.
      expect(deltaDense).toBeLessThan(bodyBytes * 2);
      expect(deltaDense - deltaFlat).toBeLessThan(bodyBytes * 2);
    }, 120_000);
  });

  describe('static pin', () => {
    test('line-bound scan precedes any line-array materialization in the parse path', () => {
      const text = readFileSync(path.join(repoRoot, 'src/utils/trustDb/trancoUpdater.ts'), 'utf8');

      const parseStart = text.indexOf('private parseTrancoCSV');
      const parseFn = text.slice(parseStart, text.indexOf('\n  }', parseStart));
      // Legacy amplification pattern (whole-text trim+split) is gone.
      expect(parseFn).not.toContain(".trim().split('\\n')");
      // The bound helper is consulted before any per-line parsing begins.
      expect(parseFn.indexOf('splitToTierLineBound')).toBeGreaterThanOrEqual(0);
      expect(parseFn.indexOf('splitToTierLineBound')).toBeLessThan(parseFn.indexOf("split(',')"));

      const helperStart = text.indexOf('private splitToTierLineBound');
      const helper = text.slice(helperStart, text.indexOf('\n  }', helperStart));
      // The indexOf walk locates line ends BEFORE anything is split.
      const indexOfWalk = helper.indexOf("indexOf('\\n'");
      const splitAt = helper.indexOf(".split('\\n')");
      expect(indexOfWalk).toBeGreaterThanOrEqual(0);
      expect(splitAt).toBeGreaterThan(indexOfWalk);
    });
  });
});
