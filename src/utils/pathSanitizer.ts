/**
 * pathSanitizer.ts
 * URLパスのセキュリティサニタイズ関数
 * 問題点2: URLパスサニタイズ不足の修正
 */

/**
 * 許可された文字とパターン
 */
const PATH_SANITIZATION_CONFIG = {
  // 許可される文字（バイト範囲）
  allowedChars: /^[a-zA-Z0-9_\-\x20\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]+$/,
  // 許可されるフォルダ区切り文字（スラッシュのみ）
  allowedSeparator: '/',
  // 最大パス長
  maxPathLength: 500,
  // 最大セグメント数
  maxSegments: 10,
};

/**
 * パストラバーサル攻撃パターン
 */
const PATH_TRAVERSAL_PATTERNS = [
  /\.\./g,        // 親ディレクトリ参照
  /\.(?!md$)/g,   // ドット（.md拡張子を除く）
  /~\//g,         // ホームディレクトリ
  /\\+/g,         // バックスラッシュ（Windowsパス区切り）
];

/**
 * プロトコルスキームパターン
 */
const PROTOCOL_SCHEME_PATTERNS = [
  /https?:\/\//i,
  /ftp:\/\//i,
  /file:\/\/\/?/i,
  /data:\//i,
  /javascript:/i,
  /vbscript:/i,
];

/**
 * 危険な特殊文字パターン
 */
const DANGEROUS_CHAR_PATTERNS = [
  /\0/,           // ヌルバイト
  /[\x00-\x1F]/,  // 制御文字（改行等）
  /\r/g,          // キャリッジリターン
  /\n/g,          // 改行
];

/**
 * パスセグメントをサニタイズする
 * @param {string} pathSegment - サニタイズ対象のパス
 * @returns {string} サニタイズされた安全なパス
 * @throws {Error} サニタイズできない危険な入力の場合
 */
export function sanitizePathSegment(pathSegment: string): string {
  if (!pathSegment || typeof pathSegment !== 'string') {
    return '';
  }

  // 1. パス長制限
  if (pathSegment.length > PATH_SANITIZATION_CONFIG.maxPathLength) {
    throw new Error('Path length exceeds maximum limit');
  }

  // 2. パストラバーサル攻撃の検出とブロック
  for (const pattern of PATH_TRAVERSAL_PATTERNS) {
    if (pattern.test(pathSegment)) {
      throw new Error('Path traversal attempt detected');
    }
  }

  // 3. プロトコルスキーム注入の検出とブロック
  for (const pattern of PROTOCOL_SCHEME_PATTERNS) {
    if (pattern.test(pathSegment)) {
      throw new Error('Protocol scheme injection detected');
    }
  }

  // 4. 危険な特殊文字の検出と削除
  for (const pattern of DANGEROUS_CHAR_PATTERNS) {
    if (pattern.test(pathSegment)) {
      throw new Error('Dangerous character detected in path');
    }
  }

  // 5. ルートパスで始まる場合の処理
  let sanitized = pathSegment;
  if (sanitized.startsWith('/')) {
    sanitized = sanitized.substring(1);
  }

  // 6. 空になった場合は空文字を返す
  if (sanitized.trim() === '') {
    return '';
  }

  // 7. セグメント数の制限
  const segments = sanitized.split('/');
  if (segments.length > PATH_SANITIZATION_CONFIG.maxSegments) {
    throw new Error('Too many path segments');
  }

  // 8. 各セグメントを検証
  for (const segment of segments) {
    // 空セグメントをスキップ
    if (segment === '') continue;

    // セグメントが許可された文字のみで構成されているか確認
    // （スラッシュは区切り文字として別途許可）
    for (const char of segment) {
      const charCode = char.charCodeAt(0);
      const isAlphanumeric = /[a-zA-Z0-9_\-]/.test(char);
      const isSpace = char === ' ';
      const isJapanese = /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/.test(char);
      const isPunctuation = /[,\.\(\)\[\]\{\}\+\-\*\?!]/.test(char);

      if (!isAlphanumeric && !isSpace && !isJapanese && !isPunctuation) {
        throw new Error(`Invalid character '${char}' in path segment`);
      }
    }
  }

  return sanitized;
}

/**
 * URL用のパスを生成する前にサニタイズする
 * buildDailyNotePathと組み合わせて使用するためのラッパー関数
 * @param {string} pathRaw - ユーザー入力のパス
 * @returns {string} サニタイズされたパス
 */
export function sanitizePathForUrl(pathRaw: string): string {
  try {
    if (!pathRaw) {
      return '';
    }

    // プレースホルダーを一時的に保護
    const placeholders = ['YYYY-MM-DD', 'YYYY', 'MM', 'DD'];
    const protectedPlaceholders: Record<string, string> = {};

    let tempPath = pathRaw;
    placeholders.forEach((placeholder, index) => {
      const token = `__PLACEHOLDER_${index}__`;
      if (tempPath.includes(placeholder)) {
        protectedPlaceholders[token] = placeholder;
        tempPath = tempPath.replace(new RegExp(placeholder, 'g'), token);
      }
    });

    // サニタイズ
    const sanitized = sanitizePathSegment(tempPath);

    // プレースホルダーを復元
    let result = sanitized;
    for (const [token, original] of Object.entries(protectedPlaceholders)) {
      result = result.replace(new RegExp(token, 'g'), original);
    }

    return result;
  } catch (error: any) {
    // サニタイズエラーの場合は安全なデフォルト値を返す
    console.warn('Path sanitization failed:', error.message);
    return '';
  }
}

/**
 * パスを安全なURLパスに変換する
 * 与えられたパスをURLクエリパラメータとして使用する場合にエンコードを行う
 * @param {string} path - エンコード対象のパス
 * @returns {string} URLセーフなエンコード済みパス
 */
export function encodePathForUrl(path: string): string {
  if (!path) return '';

  try {
    // encodeURIComponentを使用してURLセーフにする
    return encodeURIComponent(path);
  } catch {
    // エラーが発生した場合は安全なデフォルト値を返す
    return '';
  }
}