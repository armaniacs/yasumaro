/**
 * auditLogTsv.ts
 * Serialize audit log rows to TSV for the diagnostics export.
 *
 * Previously lived at panels/asyncData/auditLogPanel.ts, which implied it was
 * a Panel — it never implemented the Panel contract and was not registered in
 * the NavigationRegistry. It is a pure formatter, so it belongs in utils.
 */

import type { AuditLogEntry } from '../../utils/sqlite-types.js';
// PBI 2026-10-21-09: the created_at column is the LOCAL calendar date (SSOT
// formatLocalDateString), not the UTC ISO instant the old toIsoDate emitted.
// A UTC instant dated a JST-morning audit log with the previous day; the local
// calendar date keeps the column aligned with what the user sees elsewhere
// (e.g. the panel's download filename).
import { formatLocalDateString } from '../../utils/localDate.js';

function escapeTsvField(value: string): string {
  let str = value;
  // CWE-1236: neutralize a leading formula-trigger character so a spreadsheet
  // treats the cell as text instead of evaluating it. Mirrors escapeCsv in
  // exportLogsService.ts.
  if (/^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }
  if (str.includes('\t') || str.includes('\n') || str.includes('"')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export function toTsvString(rows: AuditLogEntry[]): string {
  const header = 'id\tprovider\turl\tcreated_at';
  const lines = rows.map((r) =>
    `${r.id}\t${escapeTsvField(r.provider)}\t${escapeTsvField(r.url)}\t${formatLocalDateString(r.created_at)}`
  );
  return header + '\n' + lines.join('\n') + '\n';
}
