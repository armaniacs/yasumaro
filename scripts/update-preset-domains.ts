/**
 * update-preset-domains.ts
 * Tranco Top 500 ドメインリストを取得し、src/utils/trustDb/presetDomains.ts に書き出す
 *
 * Usage: npx ts-node scripts/update-preset-domains.ts
 *        node --loader ts-node/esm scripts/update-preset-domains.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TRANCO_URL = 'https://tranco-list.eu/top-1m.csv.zip';
const TOP_N = 1000;
const OUTPUT_FILE = path.join(__dirname, '../src/utils/trustDb/presetDomains.ts');

async function fetchTrancoTop500(): Promise<string[]> {
  console.log(`Fetching Tranco list from ${TRANCO_URL}...`);

  // Node.js 18+ の fetch を使用
  const response = await fetch(TRANCO_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch Tranco list: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // zip を展開
  const { default: AdmZip } = await import('adm-zip');
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  let csvContent: string | null = null;
  for (const entry of entries) {
    if (entry.entryName.endsWith('.csv')) {
      csvContent = entry.getData().toString('utf8');
      break;
    }
  }

  if (!csvContent) {
    throw new Error('No CSV file found in Tranco zip');
  }

  const lines = csvContent.split('\n');
  const domains: string[] = [];

  for (const line of lines) {
    if (domains.length >= TOP_N) break;
    const parts = line.trim().split(',');
    if (parts.length >= 2) {
      const domain = parts[1].trim().toLowerCase();
      if (domain) {
        domains.push(domain);
      }
    }
  }

  console.log(`Fetched ${domains.length} domains from Tranco list`);
  return domains;
}

async function main(): Promise<void> {
  try {
    const domains = await fetchTrancoTop500();

    const content = `/**
 * presetDomains.ts
 * Tranco Top ${TOP_N} ドメインプリセット（自動生成）
 * 生成日時: ${new Date().toISOString()}
 *
 * このファイルは scripts/update-preset-domains.ts により自動生成されます。
 * 手動編集しないでください。
 */

export const TRANCO_TOP_${TOP_N}_DOMAINS: string[] = ${JSON.stringify(domains, null, 2)};
`;

    fs.writeFileSync(OUTPUT_FILE, content, 'utf8');
    console.log(`Written ${domains.length} domains to ${OUTPUT_FILE}`);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
