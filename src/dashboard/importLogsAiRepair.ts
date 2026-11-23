/**
 * importLogsAiRepair.ts
 * PBI 2026-11-23-06: AI-assisted repair proposals for rows rejected by the
 * tolerant log import (PBI 2026-11-23-05).
 *
 * Rule-first: rows the deterministic normalizer salvages never reach the AI.
 * Only rejected rows become targets, sending is explicit (requestAiRepair),
 * capped, sanitized, and never automatic. The lock gate defaults to
 * authGuard.isLocked with an injectable seam for tests.
 */

import { sqliteClient } from './dashboardSqliteService.js';
import {
  extractImportRows,
  normalizeImportRow,
  validateImportRowReason,
} from './importLogsService.js';
import { isLocked } from '../utils/storage/authGuard.js';
import { sanitizeRegex } from '../utils/piiSanitizer.js';
import { logInfo } from '../utils/logger/api.js';

/** Upper bound on rows sent for a single repair request. */
export const MAX_AI_REPAIR_ROWS = 10;
/** Upper bound on total characters sent for a single repair request. */
export const MAX_AI_REPAIR_CHARS = 6000;

/** One row the deterministic import rejected, awaiting a repair proposal. */
export interface AiRepairTarget {
  index: number;
  reason: string;
  before: string;
}

/** One AI proposal: the original text plus the repaired candidate. */
export interface AiRepairProposal {
  index: number;
  reason: string;
  before: string;
  after: string;
}

/** One row that could not be repaired (unparseable or still invalid). */
export interface AiRepairFailure {
  index: number;
  reason: string;
}

/**
 * Minimal AI client seam. Production wiring (which provider, consent,
 * progress) is a follow-up; the seam keeps this module testable without it.
 */
export interface AiRepairClient {
  repairRows(
    rows: Array<{ index: number; text: string }>
  ): Promise<Array<{ index: number; text: string }>>;
}

export interface AiRepairRequestOptions {
  client: AiRepairClient | null;
  lockCheck?: (() => Promise<boolean>) | undefined;
}

type NormalizedRow = NonNullable<ReturnType<typeof normalizeImportRow>>;

function stringifyRow(raw: unknown): string {
  try {
    const text = JSON.stringify(raw);
    return typeof text === 'string' ? text : 'unserializable row';
  } catch {
    return 'unserializable row';
  }
}

/**
 * Collect repair targets from any accepted import shape. Rows the
 * deterministic normalizer accepts are skipped; only rejected rows become
 * targets. Pure: no sending, no importing.
 */
export function collectAiRepairTargets(
  parsed: unknown
): { targets: AiRepairTarget[] } | { error: string } {
  const extracted = extractImportRows(parsed);
  if ('error' in extracted) return { error: extracted.error };
  const targets: AiRepairTarget[] = [];
  let usedChars = 0;
  for (let index = 0; index < extracted.rows.length; index += 1) {
    const raw = extracted.rows[index];
    const normalized = normalizeImportRow(raw);
    const reason =
      normalized === null
        ? 'must be an object'
        : validateImportRowReason(normalized);
    if (reason === null) continue;
    // 送信予算で早期に打ち切り: 予算を超える却下行は保持しない。
    if (targets.length >= MAX_AI_REPAIR_ROWS) break;
    const before = stringifyRow(raw);
    const separator = targets.length === 0 ? 0 : 1;
    if (usedChars + separator + before.length > MAX_AI_REPAIR_CHARS) break;
    targets.push({ index, reason, before });
    usedChars += separator + before.length;
  }
  return { targets };
}

export interface AiRepairPayload {
  items: string[];
  indices: number[];
  omittedRows: number;
  truncatedChars: boolean;
}

/**
 * Sanitize one parsed JSON value field-wise: only string leaves go through
 * the PII sanitizer, scalars pass through untouched. Whole-text sanitizing
 * would mask digit runs inside numbers (timestamps read as phone patterns)
 * and break the JSON the AI must parse.
 */
async function sanitizeJsonValue(value: unknown): Promise<unknown> {
  if (typeof value === 'string') {
    try {
      return (await sanitizeRegex(value)).text;
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) {
    const cleaned: unknown[] = [];
    for (const entry of value) cleaned.push(await sanitizeJsonValue(entry));
    return cleaned;
  }
  if (value !== null && typeof value === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) cleaned[key] = await sanitizeJsonValue(entry);
    return cleaned;
  }
  return value;
}

/**
 * Build the capped, sanitized send payload. Sanitization reuses the existing
 * PII sanitizer on string fields only (see sanitizeJsonValue); a row that
 * cannot be sanitized is omitted rather than sent raw. Pure except for the
 * sanitizer call: no sending, no importing.
 */
export async function buildAiRepairPayload(
  targets: AiRepairTarget[]
): Promise<AiRepairPayload> {
  const items: string[] = [];
  const indices: number[] = [];
  let usedChars = 0;
  let omittedRows = 0;
  let truncatedChars = false;
  const capped = targets.slice(0, MAX_AI_REPAIR_ROWS);
  omittedRows += targets.length - capped.length;
  if (omittedRows > 0) truncatedChars = true;
  for (let position = 0; position < capped.length; position += 1) {
    const target = capped[position]!;
    let text: string;
    try {
      text = JSON.stringify(await sanitizeJsonValue(JSON.parse(target.before)));
    } catch {
      try {
        text = (await sanitizeRegex(target.before)).text;
      } catch {
        omittedRows += 1;
        continue;
      }
    }
    const separator = items.length === 0 ? 0 : 1;
    if (usedChars + separator + text.length > MAX_AI_REPAIR_CHARS) {
      // 未処理分だけ足す: 処理済み (成功・除去失敗) は数え直さない。
      omittedRows += capped.length - position;
      truncatedChars = true;
      break;
    }
    items.push(text);
    indices.push(target.index);
    usedChars += separator + text.length;
  }
  return { items, indices, omittedRows, truncatedChars };
}

/**
 * Send only the failing rows for repair proposals. Nothing is imported here;
 * proposals carry before/after text for an explicit confirmation step.
 */
export async function requestAiRepair(
  targets: AiRepairTarget[],
  opts: AiRepairRequestOptions
): Promise<{ proposals: AiRepairProposal[]; failures: AiRepairFailure[] } | { error: string }> {
  const lockCheck = opts.lockCheck ?? isLocked;
  if (await lockCheck()) {
    return { error: 'AI repair is unavailable while the session is locked. Unlock first.' };
  }
  if (!opts.client) {
    return { error: 'AI repair client is not configured.' };
  }
  const payload = await buildAiRepairPayload(targets);
  if (payload.items.length === 0) {
    return { proposals: [], failures: [] };
  }
  const byIndex = new Map(targets.map((target) => [target.index, target]));
  await logInfo(
    'AI repair requested',
    { rows: payload.items.length, omittedRows: payload.omittedRows },
    'importLogsAiRepair.ts'
  );
  const responses = await opts.client.repairRows(
    payload.items.map((text, position) => ({ index: payload.indices[position]!, text }))
  );
  const proposals: AiRepairProposal[] = [];
  const failures: AiRepairFailure[] = [];
  for (const response of responses) {
    const target = byIndex.get(response.index);
    if (!target) {
      failures.push({ index: response.index, reason: 'AI response index is unknown' });
      continue;
    }
    try {
      JSON.parse(response.text);
    } catch {
      failures.push({ index: response.index, reason: 'AI response is not valid JSON' });
      continue;
    }
    proposals.push({
      index: response.index,
      reason: target.reason,
      before: target.before,
      after: response.text,
    });
  }
  return { proposals, failures };
}

/**
 * Import only the explicitly selected proposals, re-validating each repaired
 * row first. Duplicates stay existing-wins via the import INSERT OR IGNORE.
 */
export async function applyAiRepairProposals(
  proposals: AiRepairProposal[],
  selectedIndexes: number[]
): Promise<{ applied: number; rejected: AiRepairFailure[] } | { error: string }> {
  const selected = new Set(selectedIndexes);
  const chosen = proposals.filter((proposal) => selected.has(proposal.index));
  if (chosen.length === 0) {
    return { applied: 0, rejected: [] };
  }
  const rows: NormalizedRow[] = [];
  const rejected: AiRepairFailure[] = [];
  for (const proposal of chosen) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(proposal.after);
    } catch {
      rejected.push({ index: proposal.index, reason: 'repaired row is not valid JSON' });
      continue;
    }
    const normalized = normalizeImportRow(parsed);
    if (normalized === null) {
      rejected.push({ index: proposal.index, reason: 'must be an object' });
      continue;
    }
    const reason = validateImportRowReason(normalized);
    if (reason !== null) {
      rejected.push({ index: proposal.index, reason });
      continue;
    }
    rows.push(normalized);
  }
  if (rows.length === 0) {
    return { applied: 0, rejected };
  }
  const result = await sqliteClient.call('import', { subtype: 'import', rows });
  if (!('data' in result)) {
    return { error: result.error };
  }
  await logInfo(
    'AI repair applied',
    { applied: result.data.inserted, rejected: rejected.length },
    'importLogsAiRepair.ts'
  );
  return { applied: result.data.inserted, rejected };
}

/**
 * Render one proposal as - / + lines for the confirmation step.
 */
export function formatAiRepairDiff(proposal: AiRepairProposal): string {
  const beforeLines = proposal.before.split('\n');
  const afterLines = proposal.after.split('\n');
  let start = 0;
  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) {
    start += 1;
  }
  let endBefore = beforeLines.length - 1;
  let endAfter = afterLines.length - 1;
  while (
    endBefore >= start &&
    endAfter >= start &&
    beforeLines[endBefore] === afterLines[endAfter]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const lines = [`row ${proposal.index}: ${proposal.reason}`];
  for (let i = start; i <= endBefore; i += 1) lines.push(`- ${beforeLines[i]}`);
  for (let i = start; i <= endAfter; i += 1) lines.push(`+ ${afterLines[i]}`);
  return lines.join('\n');
}
