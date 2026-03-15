/**
 * update-manifest-from-preset.ts
 * presetDomains.ts から Trancoドメインを host_permissions に追加して manifest.json を更新
 *
 * Usage: npx ts-node scripts/update-manifest-from-preset.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PRESET_DOMAINS_FILE = path.join(__dirname, '../src/utils/trustDb/presetDomains.ts');
const MANIFEST_FILE = path.join(__dirname, '../manifest.json');

/**
 * presetDomains.ts からドメインリストを抽出
 */
function extractDomains(presetContent: string): string[] {
  const match = presetContent.match(/export const TRANCO_TOP_\d+_DOMAINS: string\[\] = \s*\[(.*?)\];/s);
  if (!match) {
    throw new Error('Failed to extract domains from presetDomains.ts');
  }

  const domainsStr = match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('"') && line.endsWith('",'))
    .map(line => line.slice(1, -2)); // Remove quotes and trailing comma

  return domainsStr;
}

/**
 * ドメインを host_permissions 形式に変換
 * "google.com" → ["*://google.com/*", "*://*.google.com/*"]
 */
function domainToHostPermissions(domain: string): string[] {
  return [`*://${domain}/*`, `*://*.${domain}/*`];
}

/**
 * 既存の manifest.json から host_permissions（Tranco以外）を抽出
 */
function extractExistingHostPermissions(manifest: any): string[] {
  const allPermissions = manifest.host_permissions || [];

  // 既存のローカルホスト/AIプロバイダーを保持（Trancoドメインを除く）
  // Trancoドメインは "*://[a-z].com/*" または "*://*.[a-z].com/*" 形式と想定
  return allPermissions.filter((perm: string) => {
    // ローカルホスト（localhost, 127.0.0.1）を保持
    if (perm.includes('localhost') || perm.includes('127.0.0.1')) {
      return true;
    }
    // AIプロバイダードメインを保持
    const aiProviders = [
      'googleapis.com', 'openai.com', 'anthropic.com', 'groq.com',
      'openrouter.ai', 'mistral.ai', 'deepinfra.com', 'cerebras.ai',
      'ai-gateway.helicone.ai', 'api.publicai.co', 'api.venice.ai',
      'api.scaleway.ai', 'api.synthetic.new', 'api.stima.tech',
      'nano-gpt.com', 'api.poe.com', 'llm.chutes.ai',
      'api.abliteration.ai', 'api.llamagate.dev', 'api.gmi-serving.com',
      'api.sarvam.ai', 'deepseek.com', 'xiaomimimo.com', 'nebius.com',
      'sambanova.ai', 'nscale.com', 'featherless.ai', 'galadriel.com',
      'perplexity.ai', 'recraft.ai', 'jina.ai', 'voyageai.com',
      'volcengine.com', 'z.ai', 'wandb.ai', 'api.ai.sakura.ad.jp',
      'raw.githubusercontent.com', 'gitlab.com', 'easylist.to',
      'pgl.yoyo.org', 'nsfw.oisd.nl'
    ];
    return aiProviders.some(provider => perm.includes(provider));
  });
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  try {
    // 1. presetDomains.ts を読み込む
    console.log('Reading presetDomains.ts...');
    const presetContent = fs.readFileSync(PRESET_DOMAINS_FILE, 'utf8');
    const domains = extractDomains(presetContent);
    console.log(`Extracted ${domains.length} domains from presetDomains.ts`);

    // 2. manifest.json を読み込む
    console.log('Reading manifest.json...');
    const manifestContent = fs.readFileSync(MANIFEST_FILE, 'utf8');
    const manifest = JSON.parse(manifestContent);

    // 3. Trancoドメインを host_permissions 形式に変換
    const trancoHostPermissions: string[] = [];
    for (const domain of domains) {
      trancoHostPermissions.push(...domainToHostPermissions(domain));
    }
    console.log(`Generated ${trancoHostPermissions.length} host permissions from ${domains.length} domains`);

    // 4. 既存の host_permissions（Tranco以外）を抽出
    const existingHostPermissions = extractExistingHostPermissions(manifest);
    console.log(`Retained ${existingHostPermissions.length} existing host permissions`);

    // 5. 結合して更新
    manifest.host_permissions = [
      ...existingHostPermissions,  // 既存のローカルホスト/AIプロバイダー
      ...trancoHostPermissions     // Tranco Top 1000ドメイン
    ];

    // 6. manifest.json に書き戻す
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log(`Updated manifest.json with ${manifest.host_permissions.length} host permissions`);
    console.log('Done!');
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();