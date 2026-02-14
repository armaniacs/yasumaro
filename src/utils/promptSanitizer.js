/**
 * promptSanitizer.js
 * AIプロンプトへのコンテンツ注入対策
 * Webページから抽出されたコンテンツをサニタイズして
 * AIプロンプトインジェクションを防止する
 */

/**
 * プロンプトインジェクションパターン
 */
const INJECTION_PATTERNS = [
  // 指示無効化パターン
  /ignore\s+(?:above|all|previous|other|input|instructions?)/gi,
  /disregard\s+(?:above|all|previous|other|input|instructions?)/gi,
  /forget\s+(?:above|all|previous|other|input|instructions?)/gi,

  // 代わりにパターン
  /instead/gi,
  /rather\s+than/gi,

  // 新しい命令パターン
  /(?:^|\n)now/gi,
  /(?:^|\n)update\s+/gi,

  // 大文字の指示コマンド（明らかな命令パターン）
  /\b(?:PROVIDE|SHOW|EXHIBIT|REVEAL|DISPLAY|OUTPUT|PRINT|ECHO|RETURN|SEND|TRANSMIT|EXTRACT|ENCRYPT|DECRYPT|EMAIL|EMAILING|SHARE)\b(?!\s+(?:me|us|now|please))/gi,

  // システム操作
  /\b(?:SYSTEM|ADMIN|CONFIGURATION|SETTINGS?|PASSWORDS?|CREDENTIALS?|KEY(?:S)?|TOKEN)\b/gi,

  // 機密情報取得
  /\bprevious\s+(?:conversation|chat|dialog|context|prompts?|messages?)/gi,
  /\bahistorical\s+(?:data|information|conversations?|prompts?)/gi,

  // コード実行関連
  /\b(?:execute|run|eval|eval\(|function|__proto__|constructor)\s*\(.*\)/gi,
];

/**
 * 危険な特殊文字と制御文字
 */
const DANGEROUS_CHARS = {
  '\x00': true,  // Null byte
  '\x1b': true,  // Escape
  '\x1c': true,  // File Separator
  '\x1d': true,  // Group Separator
  '\x1e': true,  // Record Separator
  '\x1f': true,  // Unit Separator
  '\x7f': true,  // Delete
  '\x80': true,  // Euro
  '\x81': true,  // Control
  '\x82': true,  // Control
  '\x83': true,  // Control
  '\x84': true,  // Control
};

/**
 * プロンプトインジェクションの危険度レベル
 */
const DangerLevel = {
  SAFE: 'safe',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
};

/**
 * プロンプトサニタイザの結果
 * @typedef {Object} SanitizeResult
 * @property {string} sanitized - サニタイズされたコンテンツ
 * @property {DangerLevel} dangerLevel - 危険度レベル
 * @property {string[]} warnings - 検出された警告メッセージ
 */

/**
 * コンテンツをサニタイズしてプロンプトインジェクションを防止する
 * @param {string} content - サニタイズするコンテンツ
 * @returns {SanitizeResult} サニタイズ結果
 */
export function sanitizePromptContent(content) {
  if (!content || typeof content !== 'string') {
    return {
      sanitized: '',
      dangerLevel: DangerLevel.SAFE,
      warnings: [],
    };
  }

  let sanitized = content;
  const warnings = [];
  let dangerLevel = DangerLevel.SAFE;

  // クレジットカード番号、銀行口座等のPIIはpiiSanitizerで処理済みと想定
  // ここではプロンプトインジェクションのみを対象

  // 1. インジェクションパターンの検出と警告
  for (const pattern of INJECTION_PATTERNS) {
    const matches = sanitized.match(pattern);
    if (matches) {
      const matchStr = matches.join(', ');
      warnings.push(`Detected possible prompt injection pattern: ${matchStr}`);
      dangerLevel = DangerLevel.HIGH;

      // 危険パターンを置換（マスキング処理）
      sanitized = sanitized.replace(pattern, '[FILTERED]');
    }
  }

  // 2. 危険な特殊文字・制御文字の除去
  let sanitizedWithChars = '';
  for (const char of sanitized) {
    if (DANGEROUS_CHARS[char]) {
      warnings.push(`Removed dangerous control character: U+${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
      if (dangerLevel === DangerLevel.SAFE) {
        dangerLevel = DangerLevel.LOW;
      }
    } else {
      sanitizedWithChars += char;
    }
  }
  sanitized = sanitizedWithChars;

  // 3. HTMLエンティティ・タグのエスケープ（XSS一環）
  sanitized = sanitized.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 4. 過度な連続空白・改行の正規化
  sanitized = sanitized.replace(/\n\s*\n\s*\n/g, '\n\n').replace(/ {3,}/g, '  ');

  // 5. 長さ制限（プロンプトインジェクションを狙った長い命令の対策）
  const MAX_FIRST_LINE_LENGTH = 200;
  const firstNewline = sanitized.indexOf('\n');
  if (firstNewline > MAX_FIRST_LINE_LENGTH) {
    warnings.push(`First line too long (${firstNewline} chars), truncated`);
    sanitized = sanitized.substring(0, MAX_FIRST_LINE_LENGTH) + '\n' + sanitized.substring(firstNewline);
    if (dangerLevel === DangerLevel.SAFE) {
      dangerLevel = DangerLevel.LOW;
    }
  }

  return {
    sanitized,
    dangerLevel,
    warnings,
  };
}

/**
 * コンテンツの危険度を確認する
 * @param {string} content - 確認するコンテンツ
 * @returns {DangerLevel} 危険度レベル
 */
export function checkContentDangerLevel(content) {
  const result = sanitizePromptContent(content);
  return result.dangerLevel;
}

/**
 * 検出された警告をログ用にフォーマット
 * @param {string[]} warnings - 警告メッセージ配列
 * @returns {string} フォーマットされたメッセージ
 */
export function formatWarnings(warnings) {
  if (!warnings || warnings.length === 0) {
    return '';
  }
  return warnings.join('; ');
}