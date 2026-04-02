/**
 * loader.ts の静的インポート禁止テスト
 *
 * 背景:
 *   manifest.json の content_scripts に登録されたスクリプトは ESM モジュールとして
 *   実行されない（"type": "module" 指定なし）。そのため loader.ts に静的 import 文が
 *   あると SyntaxError が発生し、extractor.js の動的インポートも行われず、
 *   5秒・50%の条件を満たしても記録されなくなる。
 *
 * 検証内容:
 *   ビルド成果物 (dist/content/loader.js) ではなく、ソース (src/content/loader.ts) を
 *   検査して「toplevel の import 文が存在しないこと」を保証する。
 *   （ソースに import があれば tsc がそのまま出力するため、ソース検査で十分）
 */

import * as fs from 'fs';
import * as path from 'path';

const LOADER_PATH = path.resolve(__dirname, '..', 'loader.ts');

describe('loader.ts - Content Script 静的インポート禁止', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(LOADER_PATH, 'utf8');
    });

    it('loader.ts に静的 import 文が存在しないこと', () => {
        // 行ごとに検査して、トップレベルの import 文を探す
        const lines = source.split('\n');
        const staticImportLines = lines.filter((line, index) => {
            // コメント行はスキップ
            const trimmed = line.trimStart();
            if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
                return false;
            }
            // "import " で始まる行がトップレベルの静的 import
            return /^import\s+/.test(trimmed);
        });

        if (staticImportLines.length > 0) {
            const detail = staticImportLines.map(l => `  ${l.trim()}`).join('\n');
            throw new Error(
                `loader.ts に静的 import 文が見つかりました。\n` +
                `Content Script エントリーポイント (loader.ts) は manifest.json で "type": "module" なしに\n` +
                `登録されるため、静的 import は SyntaxError を引き起こします。\n` +
                `代わりに console.warn 等を直接使用してください。\n\n` +
                `検出された import 文:\n${detail}`
            );
        }

        expect(staticImportLines).toHaveLength(0);
    });

    it('loader.ts は export {} のみを含むこと（isolatedModules 用ダミーは許容）', () => {
        // トップレベルの export 文を検査（export {} 以外は不要）
        const lines = source.split('\n');
        const exportLines = lines.filter(line => {
            const trimmed = line.trimStart();
            if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
                return false;
            }
            // export { ... } 以外のトップレベル export を検出
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
