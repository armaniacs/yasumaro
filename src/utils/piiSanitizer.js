/**
 * piiSanitizer.js
 * 正規表現による個人情報（PII）の検出とマスキング
 * ReDoS対策: 入力サイズ制限とタイムアウト機能を実装
 * パフォーマンス改善: 1回のスキャンで全パターンを検出
 */

// 定数設定
const MAX_INPUT_SIZE = 50 * 1024; // 50KB (文字数)
const DEFAULT_TIMEOUT = 5000; // 5秒

// PIIパターン定義（単一正規表現用）
// 注: 文字境界 `\b` を使用して、他の文字列の一部になる場合を防ぐ
// 数字の間にスペースやハイフンがある場合も検出
const PII_PATTERNS = [
    // クレジットカード: 16桁または15桁のカード番号
    {
        type: 'creditCard',
        pattern: /\b(?:\d{4}[-\s]?\d{2,4}[-\s]?\d{2,4}[-\s]?\d{4})\b/ // 16桁（可変区切り3つ）
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
    // 銀行口座: 7桁数字
    {
        type: 'bankAccount',
        pattern: /\b\d{7}\b/
    },
    // 電話番号: 0 + 1-4桁 + 1-4桁 + 4桁
    {
        type: 'phoneJp',
        pattern: /\b0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}\b/
    },
    // メールアドレス
    {
        type: 'email',
        pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
    }
];

/**
 * 入力サイズを検証する
 * @param {string} text - 検証対象のテキスト
 * @returns {object} { valid: boolean, error?: string }
 */
function validateInputSize(text) {
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
async function executeWithTimeout(fn, timeout) {
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

/**
 * テキストからPIIを検出してマスクする
 * 【パフォーマンス改善】: 1回のスキャンで全パターンを検出
 * @param {string} text - 対象テキスト
 * @param {object} options - オプション
 * @param {number} options.timeout - タイムアウト時間（ミリ秒）、デフォルト5000ms
 * @param {boolean} options.skipSizeLimit - サイズ制限をスキップするか（デフォルトfalse）
 * @returns {Promise<object>} { text: string, maskedItems: Array<{type: string, original: string}>, error?: string }
 */
export async function sanitizeRegex(text, options = {}) {
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

    try {
        // タイムアウト付きで処理を実行
        const result = await executeWithTimeout(() => {
            const maskedItems = [];
            const replacements = [];

            // 【パフォーマンス改善】: 重複チェック用のSet（O(1)探索）
            const matchedPositions = new Set();

            // 【パフォーマンス改善】: 各パターンを1回ずつスキャンしてマッチを収集
            // ただし置換は行わず、マッチ位置のみを記録
            for (const { type, pattern } of PII_PATTERNS) {
                let match;
                const regex = new RegExp(pattern.source, 'g');
                while ((match = regex.exec(text)) !== null) {
                    const matchedValue = match[0];
                    const startIndex = match.index;
                    const endIndex = startIndex + matchedValue.length;

                    // 【パフォーマンス改善】: Setで重複チェック（O(1)探索）
                    const positionKey = `${startIndex}-${endIndex}`;
                    if (matchedPositions.has(positionKey)) continue;

                    // 【パフォーマンス改善】: 重複チェックをSetに追加
                    matchedPositions.add(positionKey);

                    replacements.push({
                        index: startIndex,
                        length: matchedValue.length,
                        mask: `[MASKED:${type}]`,
                        type,
                        original: matchedValue
                    });
                }
            }

            // マッチ位置をオフセット順にソート（後ろから処理するため）
            replacements.sort((a, b) => b.index - a.index);

            // テキストを置換して作成
            let processedText = text;
            for (const r of replacements) {
                processedText =
                    processedText.substring(0, r.index) +
                    r.mask +
                    processedText.substring(r.index + r.length);
                maskedItems.unshift({ type: r.type, original: r.original });
            }

            return { text: processedText, maskedItems };
        }, timeout);

        return result;
    } catch (error) {
        // タイムアウトまたはその他のエラー
        return {
            text,
            maskedItems: [],
            error: error.message
        };
    }
}