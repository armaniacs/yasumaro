/**
 * webhookExportMaskFailClosed.test.ts
 * PBI 2026-11-27-06 (VULN-401, CWE-754 Low) ― contract pin for the webhook
 * mask seam after the deliberate fail-closed change.
 *
 * sanitizeRegex reports size-rejection by RETURNING the original text with
 * an `error` flag (never throws). The seam used to drop that flag and ship
 * raw PII; it now re-raises it so the fail-closed catch in sendWebhookExport
 * suppresses the POST and records a mask-error history row. Ported from the
 * VulnHunter exploit test 401, inverted into the new contract.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  defaultWebhookMaskText,
  sendWebhookExport,
  WEBHOOK_EXPORT_REASONS,
  type WebhookExportNotice,
  type WebhookExportSenderDeps,
} from '../webhookExportSender.js';
import { WebhookExportHistory } from '../webhookExportHistory.js';
import { sanitizeRegex, MAX_INPUT_SIZE } from '../../../utils/piiSanitizer.js';

const PII_LINE = 'Contact: user@example.com / 090-1234-5678 ';
const OVERSIZE_SUMMARY = PII_LINE + 'a'.repeat(MAX_INPUT_SIZE + 1000 - PII_LINE.length);

interface FetchCall {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string };
}

function makeDeps(): WebhookExportSenderDeps & { fetchCalls: FetchCall[]; notices: WebhookExportNotice[] } {
  const fetchCalls: FetchCall[] = [];
  const notices: WebhookExportNotice[] = [];
  const store: Record<string, string> = {};
  return {
    fetchCalls,
    notices,
    fetchFn: vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
      fetchCalls.push({ url, init });
      return { ok: true, status: 200 };
    }),
    isHostPermitted: vi.fn(async (_url: string) => true),
    maskText: defaultWebhookMaskText,
    notify: vi.fn((event: WebhookExportNotice) => {
      notices.push(event);
    }),
    now: () => 1700000000000,
    history: new WebhookExportHistory({
      get: async (key: string): Promise<string | null> =>
        typeof store[key] === 'string' ? (store[key] as string) : null,
      set: async (key: string, value: string): Promise<void> => {
        store[key] = value;
      },
    }),
  };
}

describe('defaultWebhookMaskText boundary (production seam)', () => {
  it('sanity: sanitizeRegex still rejects oversize input in return form (contract unchanged in piiSanitizer)', async () => {
    expect(OVERSIZE_SUMMARY.length).toBeGreaterThan(MAX_INPUT_SIZE);
    const result = await sanitizeRegex(OVERSIZE_SUMMARY);
    expect(result.error).toBeDefined();
    expect(result.text).toBe(OVERSIZE_SUMMARY);
    expect(result.maskedItems).toHaveLength(0);
  });

  it('throws (fail closed) for a >64KB text instead of returning it raw', async () => {
    await expect(defaultWebhookMaskText(OVERSIZE_SUMMARY)).rejects.toThrow(/^mask-error: /);
  });

  it('masks a <64KB text containing PII (normal path unchanged)', async () => {
    const masked = await defaultWebhookMaskText('Contact: user@example.com');
    expect(masked).toContain('[MASKED:');
    expect(masked).not.toContain('user@example.com');
  });

  it('masks a text of exactly MAX_INPUT_SIZE characters (boundary below the rejection)', async () => {
    const text = PII_LINE + 'a'.repeat(MAX_INPUT_SIZE - PII_LINE.length);
    expect(text.length).toBe(MAX_INPUT_SIZE);
    const masked = await defaultWebhookMaskText(text);
    expect(masked).toContain('[MASKED:');
    expect(masked).not.toContain('user@example.com');
  });
});

describe('sendWebhookExport with the production seam on an oversize summary', () => {
  it('fails closed: mask-error history row, no POST, raw PII never egresses', async () => {
    const deps = makeDeps();
    const result = await sendWebhookExport(
      {
        record: {
          id: 'r1',
          title: 'Meeting notes',
          url: 'https://example.com/p1',
          summary: OVERSIZE_SUMMARY,
          tags: 'obsidian',
        },
        settings: { enabled: true, url: 'https://hooks.example.com/hook', condition: {} },
        isPrivate: false,
      },
      deps,
    );
    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe(WEBHOOK_EXPORT_REASONS.maskError);
    expect(deps.fetchFn).not.toHaveBeenCalled();
    const rows = await deps.history.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('failed');
    expect(rows[0]?.reason).toBe(WEBHOOK_EXPORT_REASONS.maskError);
    expect(deps.notices[0]?.kind).toBe('failed');
    expect(deps.notices[0]?.reason).toBe(WEBHOOK_EXPORT_REASONS.maskError);
  });

  it('an oversize TITLE also fails closed (title rides the same seam)', async () => {
    const deps = makeDeps();
    const result = await sendWebhookExport(
      {
        record: {
          id: 'r2',
          title: OVERSIZE_SUMMARY,
          url: 'https://example.com/p2',
          summary: 'small',
          tags: 'obsidian',
        },
        settings: { enabled: true, url: 'https://hooks.example.com/hook', condition: {} },
        isPrivate: false,
      },
      deps,
    );
    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe(WEBHOOK_EXPORT_REASONS.maskError);
    expect(deps.fetchFn).not.toHaveBeenCalled();
  });
});
