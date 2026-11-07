/**
 * check-deprecated-aliases.mjs — forbid new uses of sunset-scheduled aliases.
 *
 * Existing imports keep working (backward compatibility), but new code must
 * use the canonical names. Grandfathered files are allowlisted; any other
 * file importing the old names fails the check.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

// alias pattern -> canonical replacement -> files still allowed to use it
const RULES = [
    {
        pattern: /\bProviderStrategy\b(?!.*AIProviderStrategy)/,
        name: 'ProviderStrategy alias',
        canonical: 'AIProviderStrategy',
        grandfathered: new Set([
            'src/background/ai/providers/ProviderStrategy.ts',
            'src/background/ai/providers/HttpProviderStrategy.ts',
            'src/background/ai/AIService.ts',
            'src/background/ai/RemoteAIService.ts',
            'src/background/ai/providers/BuiltInAiProvider.ts',
            'src/background/ai/providers/GeminiProvider.ts',
            'src/background/ai/providers/OpenAIProvider.ts',
            'src/background/ai/providers/index.ts',
            'src/utils/storage/providerAllowlist.ts',
            'src/utils/httpFailureMessages.ts',
        ]),
    },
    {
        pattern: /(?<!Generic)OpenAIProvider\b/,
        name: 'OpenAIProvider legacy class',
        canonical: 'GenericOpenAICompatibleProvider',
        grandfathered: new Set([
            'src/background/ai/providers/OpenAIProvider.ts',
            'src/background/ai/providers/index.ts',
            'src/background/ai/providerCatalog.ts',
        ]),
    },
    // --- PBI 2026-11-07-01: shim-path bans. Match the import path (not the
    // identifier) so renames cannot dodge the gate. Grandfathered sets list
    // only non-test files that still import the shim today (__tests__ dirs
    // are skipped by the walker); entries may only be removed, never added.
    {
        pattern: /(?:from|import\()\s*['"][^'"]*keySerializer\.js['"]/,
        name: 'keySerializer shim import',
        canonical: 'src/utils/storage/storageTransaction.ts',
        grandfathered: new Set([
        ]),
    },
    {
        pattern: /(?:from|import\()\s*['"][^'"]*logMasker\.js['"]/,
        name: 'logMasker shim import',
        canonical: "src/utils/sensitiveDataMask.ts maskSensitiveData(data, 'partial')",
        grandfathered: new Set([
        ]),
    },
    {
        pattern: /(?:from|import\()\s*['"][^'"]*\/redaction\.js['"]/,
        name: 'redaction shim import',
        canonical: 'src/utils/sensitiveDataMask.ts',
        grandfathered: new Set([
        ]),
    },
    {
        pattern: /(?:from|import\()\s*['"][^'"]*savedUrlStore\.js['"]/,
        name: 'savedUrlStore shim import',
        canonical: 'src/utils/storage/savedUrlRepository.ts (types/constants via src/utils/urlEntry.ts)',
        grandfathered: new Set([
        ]),
    },
    {
        pattern: /(?:from|import\()\s*['"][^'"]*utils\/auditLog\.js['"]/,
        name: 'auditLog shim import',
        canonical: 'src/messaging/auditLogGateway.ts',
        grandfathered: new Set([
            'src/background/ai/RemoteAIService.ts',
        ]),
    },
    {
        // Legacy Adapter names re-exported by SettingsRepository. The line
        // must name both an *Adapter identifier and the SettingsRepository
        // path, so the unrelated queue/log/offscreen adapters never match.
        pattern: /(?=.*SettingsRepository\.js['"])(?=.*\b\w*Adapter\b)/,
        name: 'SettingsRepository Adapter alias import',
        canonical: 'src/utils/storage/storagePort.ts (StoragePort, ChromeStoragePort, InMemoryStoragePort)',
        grandfathered: new Set([
        ]),
    },
];

function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            if (['__tests__', 'node_modules', 'dist'].includes(entry)) continue;
            yield* walk(full);
        } else if (extname(full) === '.ts' && !full.endsWith('.test.ts')) {
            yield full;
        }
    }
}

const violations = [];
for (const full of walk(join(ROOT, 'src'))) {
    const relPath = full.slice(ROOT.length);
    const src = readFileSync(full, 'utf8');
    for (const rule of RULES) {
        if (rule.grandfathered.has(relPath)) continue;
        const lines = src.split('\n');
        lines.forEach((line, i) => {
            if (line.includes('@deprecated') || line.trim().startsWith('*') || line.trim().startsWith('//')) return;
            if (rule.pattern.test(line)) {
                violations.push(`${relPath}:${i + 1}: new use of deprecated ${rule.name} — use ${rule.canonical}`);
            }
        });
    }
}

if (violations.length > 0) {
    console.error('deprecated alias violations:');
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
}
console.log('deprecated alias guard: OK');
