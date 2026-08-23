/**
 * loader.ts の静的インポート方針テスト
 *
 * 背景:
 *   manifest.json の content_scripts に登録される最終成果物
 *   (dist/chromium-mv3/content-scripts/content.js) は "type": "module" なしで
 *   実行されるプレーンスクリプトである。loader.ts に外部から解決できない
 *   静的 import があれば、ビルド後にもそれが残り SyntaxError を引き起こす。
 *
 *   ただし loader.ts はビルド時に WXT (rolldown) でバンドルされるエントリ
 *   ポイントであり、プロジェクト内の相対 import はビルド時にインライン化
 *   される（実測: ビルド前後で loader.ts に静的 import を追加しても
 *   dist/chromium-mv3/content-scripts/content.js に import 文は残らない）。
 *   したがって「静的 import が一切存在しないこと」ではなく、
 *   「バンドラーが解決できない import が無いこと」を保証する。
 *
 * 検証内容:
 *   1. loader.ts のトップレベル静的 import が、プロジェクト内の相対パス
 *      （./ または ../ で始まる .js）のみであること（bare specifier や
 *      絶対URLのimportは許容しない）
 *   2. loader.ts に export {} 以外のトップレベル export がないこと
 */

import * as fs from 'fs';
import * as path from 'path';

const LOADER_PATH = path.resolve(__dirname, '..', 'loader.ts');

describe('loader.ts - Content Script 静的インポート方針', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(LOADER_PATH, 'utf8');
    });

    it('静的 import はプロジェクト内の相対パス（./ または ../）のみであること', () => {
        const lines = source.split('\n');
        const staticImportLines = lines.filter((line) => {
            const trimmed = line.trimStart();
            if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
                return false;
            }
            // "import type" は TypeScript コンパイル時に完全に消去されるため許容
            if (/^import\s+type\s+/.test(trimmed)) {
                return false;
            }
            return /^import\s+/.test(trimmed);
        });

        const nonRelativeImports = staticImportLines.filter((line) => {
            const match = line.match(/from\s+['"]([^'"]+)['"]/);
            if (!match) return true; // side-effect import without a resolvable path
            const specifier = match[1];
            return !(specifier.startsWith('./') || specifier.startsWith('../'));
        });

        if (nonRelativeImports.length > 0) {
            const detail = nonRelativeImports.map(l => `  ${l.trim()}`).join('\n');
            throw new Error(
                `loader.ts に、バンドラーが解決できない可能性のある import 文が見つかりました。\n` +
                `Content Script の最終成果物 (dist/.../content.js) は "type": "module" なしで登録されるため、\n` +
                `プロジェクト内の相対パス (./xxx.js) 以外の import はバンドル後に残ると SyntaxError になります。\n\n` +
                `検出された import 文:\n${detail}`
            );
        }
    });

    it('loader.ts が urlSkipper と domainPolicy に委譲し、ローカル再実装を持たない（重複コード排除の確認）', () => {
        expect(source).toMatch(/import\s*\{[^}]*shouldSkipUrl[^}]*\}\s*from\s*['"]\.\/urlSkipper\.js['"]/);
        expect(source).toMatch(/import\s*\{[^}]*checkDomainAllowedFromCache[^}]*\}\s*from\s*['"]\.\/domainPolicy\.js['"]/);
        // ローカルに再実装された SKIPPED_PROTOCOLS / StorageKeys 定数が残っていないこと
        expect(source).not.toMatch(/const\s+SKIPPED_PROTOCOLS\s*=/);
        expect(source).not.toMatch(/const\s+StorageKeys\s*=/);
    });

    it('loader.ts は export {} のみを含むこと（isolatedModules 用ダミーは許容）', () => {
        const lines = source.split('\n');
        const exportLines = lines.filter(line => {
            const trimmed = line.trimStart();
            if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
                return false;
            }
            return /^export\s+/.test(trimmed) && !/^export\s*\{/.test(trimmed);
        });

        if (exportLines.length > 0) {
            const detail = exportLines.map(l => `  ${l.trim()}`).join('\n');
            throw new Error(
                `loader.ts に export {} 以外の export 文が見つかりました。\n` +
                `Content Script エントリーポイントは ESM として実行されないため、\n` +
                `export 文（export {} を除く）は避けてください。\n\n` +
                `検出された export 文:\n${detail}`
            );
        }

        expect(exportLines).toHaveLength(0);
    });
});
