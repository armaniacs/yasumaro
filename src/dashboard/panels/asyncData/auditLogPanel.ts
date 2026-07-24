

interface AuditLogEntry {
  id: number;
  provider: string;
  url: string;
  created_at: number;
}

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString();
}

function escapeTsvField(value: string): string {
  if (value.includes('\t') || value.includes('\n') || value.includes('"')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function toTsvString(rows: AuditLogEntry[]): string {
  const header = 'id\tprovider\turl\tcreated_at';
  const lines = rows.map((r) =>
    `${r.id}\t${escapeTsvField(r.provider)}\t${escapeTsvField(r.url)}\t${toIsoDate(r.created_at)}`
  );
  return header + '\n' + lines.join('\n') + '\n';
}

