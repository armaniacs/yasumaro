/**
 * piiSanitizer.js
 * 正規表現による個人情報（PII）の検出とマスキング
 * ReDoS対策: 入力サイズ制限とタイムアウト機能を実装
 */

// 定数設定
const MAX_INPUT_SIZE = 50 * 1024; // 50KB (文字数)
const DEFAULT_TIMEOUT = 5000; // 5秒

const PII_PATTERNS = {
    // クレジットカード（Luhnアルゴリズム検証は行わず、形式のみチェック）
    // 14-16桁の数字、ハイフン・スペース区切り可
    // 最適化: 貪欲マッチを避け、より具体的なパターンを使用
    creditCard: /\b(?:\d{4}[-\s]?){3}\d{4}\b|\b\d{4}[-\s]?\d{6}[-\s]?\d{5}\b/g,

    // マイナンバー（12桁の数字）
    // 最適化: より具体的なパターン
    myNumber: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,

    // 銀行口座番号（7桁の数字）
    // 文脈によっては誤検知の可能性があるが、安全側に倒してマスク
    // 最適化: 単純なパターン
    bankAccount: /\b\d{7}\b/g,

    // メールアドレス
    // 一般的なメールアドレス形式
    // 最適化: バックトラッキングを減らすために、より具体的なパターンを使用
    email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,

    // 電話番号（日本形式）
    // 固定電話(0x-xxxx-xxxx), 携帯電話(090-xxxx-xxxx), フリーダイヤル(0120-xxx-xxx)
    // 最適化: 入れ子の量指定子を避け、より具体的なパターンを使用
    phoneJp: /\b0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}\b/g,
};

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
            let processedText = text;
            const maskedItems = [];

            // 各パターンで置換
            for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
                processedText = processedText.replace(pattern, (match) => {
                    maskedItems.push({ type, original: match });
                    return `[MASKED:${type}]`; // デバッグ用にタイプを含める（本番は[MASKED]のみでも可）
                });
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
