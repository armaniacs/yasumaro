// src/utils/dailyNotePathBuilder.ts

/**
 * パスセグメントをサニタイズ（パストラバーサル攻撃対策）
 * 問題点2対応: URLパスサニタイズ
 * @param {string} component - サニタイズ対象のパスセグメント
 * @returns {string} サニタイズされたパスセグメント
 * @throws {Error} 無効なパス検出時にエラー
 */
function sanitizePathComponent(component: string): string {
    if (!component || typeof component !== 'string') {
        return component;
    }

    // 親ディレクトリ参照（../, ./）をブロック
    if (/\.\.?\//u.test(component) ||(/\.\.[\\/]/u.test(component))) {
        throw new Error('Invalid path component: path traversal detected');
    }

    // プロトコルスキーム注入（https://, file://, ftp:// など）をブロック
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(component)) {
        throw new Error('Invalid path component: protocol scheme detected');
    }

    // 絶対パス（/ で始まる）をブロック
    if (component.startsWith('/') || component.startsWith('\\')) {
        throw new Error('Invalid path component: absolute path detected');
    }

    return component;
}

/**
 * 日次ノートのパスを構築
 * @param {string} pathRaw - ユーザー入力のパス（プレースホルダーを含む）
 * @param {Date} date - 日付（デフォルトは本日）
 * @returns {string} 構築されたパス
 * @throws {Error} 無効なパス入力時
 */
export function buildDailyNotePath(pathRaw: string, date: Date = new Date()): string {
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    if (!pathRaw) return `${year}-${month}-${day}`;

    // パス入力のサニタイズ
    sanitizePathComponent(pathRaw);

    const today = `${year}-${month}-${day}`;

    return pathRaw
        .replace(/YYYY/gu, year)
        .replace(/MM/gu, month)
        .replace(/DD/gu, day)
        .replace(/YYYY-MM-DD/gu, today);
}