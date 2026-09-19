/**
 * check-innerhtml-escape.mjs — popup/privacy rendering guard.
 *
 * Fails when a raw `innerHTML = <interpolated>` assignment appears outside the
 * allowlisted renderer modules. Renderers must go through `escapeHtml`
 * (see src/utils/htmlEscape.ts) or `textContent`-based construction.
 * Element clearing must use `clearElement` from `src/popup/domUtils.ts`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const TARGET_DIRS = ['src/popup', 'src/privacy'];
const ALLOWLIST = new Set([
    // Central renderers that are reviewed for escapeHtml coverage.
    'src/popup/statusRenderers.ts',
    'src/popup/statusPanel.ts',
    'src/privacy/privacy.ts',
]);

function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            if (entry === '__tests__' || entry === 'node_modules') continue;
            yield* walk(full);
        } else if (extname(full) === '.ts' && !full.endsWith('.test.ts')) {
            yield full;
        }
    }
}

const violations = [];
for (const rel of TARGET_DIRS) {
    for (const full of walk(join(ROOT, rel))) {
        const relPath = full.slice(ROOT.length);
        if (ALLOWLIST.has(relPath)) continue;
        const src = readFileSync(full, 'utf8');
        const lines = src.split('\n');
        const srcNoTests = src;
        lines.forEach((line, i) => {
            if (/\.innerHTML\s*=\s*`/.test(line)) {
                // Allow when the template block (next 10 lines) uses escapeHtml
                // or only static markup; flag only fully raw interpolations.
                const block = lines.slice(i, i + 10).join('\n');
                if (!/escapeHtml|textContent|createElement/.test(block) && /\$\{/.test(block)) {
                    violations.push(`${relPath}:${i + 1}: raw innerHTML template assignment without escapeHtml`);
                }
            }
            if (/\.innerHTML\s*=\s*''/.test(line)) {
                violations.push(`${relPath}:${i + 1}: use clearElement() instead of innerHTML = ''`);
            }
        });
        void srcNoTests;
    }
}

if (violations.length > 0) {
    console.error('innerHTML escape guard violations:');
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
}
console.log('innerHTML escape guard: OK');
