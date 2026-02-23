/**
 * piiSanitizer.ts
 * 正規表現による個人情報（PII）の検出とマスキング
 * ReDoS対策: 入力サイズ制限とタイムアウト機能を実装
 * パフォーマンス改善: 1回のスキャンで全パターンを検出
 */

// 定数設定
export const MAX_INPUT_SIZE = 64 * 1024; // 64KB (65,536 characters)
const DEFAULT_TIMEOUT = 5000; // 5秒
const MAX_MATCH_COUNT = 1000; // マッチ件数制限（ReDoS対策）
const TIMEOUT_CHECK_INTERVAL = 5; // タイムアウトチェック間隔（5マッチごと）

interface PiiPattern {
    type: string;
    pattern: RegExp;
}

const PII_PATTERNS: PiiPattern[] = [
    // メールアドレス（最も具体的）
    {
        type: 'email',
        pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
    },
    // クレジットカード: 16桁または15桁のカード番号（マイナンバーより前）
    {
        type: 'creditCard',
        pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/ // 16桁（4-4-4-4）
    },
    {
        type: 'creditCard',
        pattern: /\b\d{4}[-\s]?\d{6}[-\s]?\d{5}\b/ // 15桁（区切り2つ）
    },
    // マイナンバー: 12桁（4桁-4桁-4桁）
    {
        type: 'myNumber',
        pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/
    },
    // 電話番号: 0 + 1-4桁 + 1-4桁 + 4桁
    {
        type: 'phoneJp',
        pattern: /\b0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}\b/
    },
    // 銀行口座: 7桁数字
    {
        type: 'bankAccount',
        pattern: /\b\d{7}\b/
    }
];

/**
 * 入力サイズを検証する
 * @param {string} text - 検証対象のテキスト
 * @returns {object} { valid: boolean, error?: string }
 */
function validateInputSize(text: string): { valid: boolean; error?: string } {
    if (!text || typeof text !== 'string') {
        return { valid: true }; // null/undefinedは後で処理
    }

    if (text.length > MAX_INPUT_SIZE) {
        return {
            valid: false,
            error: `Input size exceeds maximum limit of ${MAX_INPUT_SIZE} characters (actual: ${text.length})`
        };
    }

    return { valid: true };
}

/**
 * タイムアウト付きで関数を実行する
 * @param {Function} fn - 実行する関数
 * @param {number} timeout - タイムアウト時間（ミリ秒）
 * @returns {Promise<any>} 関数の実行結果
 */
async function executeWithTimeout<T>(fn: () => T, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Operation timed out after ${timeout}ms`));
        }, timeout);

        try {
            const result = fn();
            clearTimeout(timer);
            resolve(result);
        } catch (error) {
            clearTimeout(timer);
            reject(error);
        }
    });
}

interface SanitizeOptions {
    timeout?: number;
    skipSizeLimit?: boolean;
}

interface MaskedItem {
    type: string;
    original: string;
    index?: number;
}

interface SanitizeResult {
    text: string;
    maskedItems: MaskedItem[];
    error?: string;
}

interface Replacement {
    index: number;
    length: number;
    mask: string;
    type: string;
    original: string;
}

interface Range {
    start: number;
    end: number;
}

/**
 * テキストからPIIを検出してマスクする
 * 【パフォーマンス改善】: 1回のスキャンで全パターンを検出
 * @param {string} text - 対象テキスト
 * @param {SanitizeOptions} options - オプション
 * @param {number} options.timeout - タイムアウト時間（ミリ秒）、デフォルト5000ms
 * @param {boolean} options.skipSizeLimit - サイズ制限をスキップするか（デフォルトfalse）
 * @returns {Promise<SanitizeResult>} { text: string, maskedItems: Array<{type: string, original: string}>, error?: string }
 */
export async function sanitizeRegex(text: string, options: SanitizeOptions = {}): Promise<SanitizeResult> {
    const { timeout = DEFAULT_TIMEOUT, skipSizeLimit = false } = options;

    // null/undefinedチェック
    if (!text || typeof text !== 'string') {
        return { text: '', maskedItems: [] };
    }

    // 入力サイズ検証
    if (!skipSizeLimit) {
        const sizeValidation = validateInputSize(text);
        if (!sizeValidation.valid) {
            return {
                text,
                maskedItems: [],
                error: sizeValidation.error
            };
        }
    }

    const startTime = Date.now();
    try {
        const maskedItems: MaskedItem[] = [];
        const replacements: Replacement[] = [];

        // 【パフォーマンス改善】: 全パターンを1つの正規表現に統合して1パスでスキャン
        // 同じタイプのパターンを統合して名前付きグループの重複を避ける
        const typeGroups: string[] = [];
        const seenTypes = new Set<string>();
        for (const { type } of PII_PATTERNS) {
            if (seenTypes.has(type)) continue;
            seenTypes.add(type);
            const patternsForType = PII_PATTERNS
                .filter(p => p.type === type)
                .map(p => `(?:${p.pattern.source})`);
            typeGroups.push(`(?<${type}>${patternsForType.join('|')})`);
        }
        const combinedRegex = new RegExp(typeGroups.join('|'), 'g');

        let match: RegExpExecArray | null;
        let matchCount = 0;
        while ((match = combinedRegex.exec(text)) !== null) {
            matchCount++;
            // 【ReDoS対策】タイムアウトチェックをより頻繁に実行（5マッチごと）
            if (matchCount % TIMEOUT_CHECK_INTERVAL === 0 && Date.now() - startTime > timeout) {
                throw new Error(`Operation timed out after ${timeout}ms`);
            }
            // 【ReDoS対策】マッチ件数制限を追加
            if (matchCount > MAX_MATCH_COUNT) {
                throw new Error(`Operation exceeded maximum match count of ${MAX_MATCH_COUNT}`);
            }

            const matchedValue = match[0];
            const startIndex = match.index;

            // どのグループがマッチしたか特定
            let matchedType = 'unknown';
            if (match.groups) {
                for (const type of Object.keys(match.groups)) {
                    if (match.groups[type]) {
                        matchedType = type;
                        break;
                    }
                }
            }

            replacements.push({
                index: startIndex,
                length: matchedValue.length,
                mask: `[MASKED:${matchedType}]`,
                type: matchedType,
                original: matchedValue
            });
        }

        // 念のため重複やオーバーラップを排除（1パスなら基本発生しないが、複雑なパターンの場合への備え）
        replacements.sort((a, b) => b.length - a.length);
        const resolvedReplacements: Replacement[] = [];
        const usedRanges: Range[] = [];

        for (const r of replacements) {
            const rStart = r.index;
            const rEnd = r.index + r.length;
            const overlaps = usedRanges.some(range => !(rEnd <= range.start || rStart >= range.end));

            if (!overlaps) {
                resolvedReplacements.push(r);
                usedRanges.push({ start: rStart, end: rEnd });
            }
        }

        // 2. インデックスの降順でソート（後ろから置換することでインデックスのずれを防止）
        resolvedReplacements.sort((a, b) => b.index - a.index);

        let processedText = text;
        const finalMaskedItems: MaskedItem[] = [];

        // 【パフォーマンス改善】: 配列ベースの置換方式で文字列連結のオーバーヘッドを削減
        // テキストを配列に分割して置換し、最後にjoinすることで中間文字列を削減
        const textParts = processedText.split('');
        for (const r of resolvedReplacements) {
            for (let i = 0; i < r.length; i++) {
                if (i === 0) {
                    textParts[r.index] = r.mask;
                } else {
                    textParts[r.index + i] = '';
                }
            }
            finalMaskedItems.push({ type: r.type, original: r.original, index: r.index });
        }
        processedText = textParts.join('');

        // 3. 実際に置換された項目を出現順（インデックス昇順）に並べ替えて返す
        finalMaskedItems.sort((a, b) => (a.index || 0) - (b.index || 0));
        const resultItems = finalMaskedItems.map(item => ({ type: item.type, original: item.original }));

        return { text: processedText, maskedItems: resultItems };
    } catch (error: any) {
        // タイムアウトまたはその他のエラー
        return {
            text,
            maskedItems: [],
            error: error.message
        };
    }
}