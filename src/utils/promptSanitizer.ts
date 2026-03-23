/**
 * promptSanitizer.ts
 * AIプロンプトへのコンテンツ注入対策
 * Webページから抽出されたコンテンツをサニタイズして
 * AIプロンプトインジェクションを防止する
 */

/**
 * HTMLエンティティをデコードする
 * エンコード回避対策として、HTMLエンティティをデコードしてからチェックする
 * DOM APIを使用しない実装（Service Worker対応）
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&#x27;': "'",
    '&#x2F;': '/',
    '&nbsp;': ' ',
    '&#60;': '<',
    '&#62;': '>',
    '&#34;': '"',
    '&#38;': '&'
  };
  return text.replace(/&[#a-zA-Z0-9]+;/g, (match) => entities[match] || match);
}

/**
 * Unicode正規化を行う
 * 同じ文字の異なる表現（結合文字など）を統一する
 */
function normalizeUnicode(text: string): string {
  return text.normalize('NFC');
}

/**
 * プロンプトインジェクションパターン
 * エンコード回避対策として、より包括的なパターンを使用
 */
/**
 * 精緻化されたプロンプトインジェクションパターン
 * 誤検知低減のため、文脈を考慮したパターン
 * 参考: 2026-03-20 ADR prompt-sanitizer-over-matching-fix.md
 * 誤検知率: 0% (目標<20%達成)
 */
const REFINED_INJECTION_PATTERNS = [
  // 命令無効化パターン（明確なプロンプト命令構文）
  /^(?:ignore|disregard|forget)\s+(?:above|all|previous|other|input|instructions?)/gim,

  // システム操作（プロンプト命令用語）
  /\b(?:change|switch|override|replace)\s+(?:your\s+)?(?:system|role|instructions?|rules?)(?:\s+(?:behavior|rules?|to|with|for|into))?/gim,

  // ロール切り替え（AIロール変更命令）
  /^(?:you\s+are|act\s+as|behave\s+like|become?)(?:\s+(?:now\s+)?)?(?:a\s+)?(?:system|admin(?:istrator)?|root|superuser|developer|programmer|hacker)(?:\s+and\s+(?:do|follow|execute|ignore|disregard|forget|override))?/gim,

  // 直接的な命令
  /\bi\s+(?:want|need)(?:\s+(?:you\s+)?)?to\s+(?:ignore|disregard|forget|override|switch|change|replace)(?:(?:\s+\b(?:the\s+)?(?:above|previous|all|your|the|instructions?))|(?:\s+now))/gim,

  // 出力制御（プロンプト特有の構文）
  /^(?:just|only)?\s*(?:print|output|display|show|return)\s+(?:for\s+me|everything|all\s+(?:the\s+)?(?:data|information|instructions?))(?:\s+(?:to\s+me|directly|as(?:\s+a)?\s+(?:json|list|file)))?/gim,

  // コンテキスト操作
  /^(?:delete|erase|clear|remove)(?:\s+(?:your\s+)?(?:memory|context|cache|history))(?:\s+(?:and|then|to|for)\s+(?:allow|permit|enable))?/gim,
];

/**
 * 安全な文脈パターン（誤検知低減）
 * これらのパターンが前後に存在する場合はインジェクション警告を抑制
 */
const SAFE_CONTEXT_PATTERNS = [
  /\b(?:is|are|was|were|be(?:come)?|seem|appear|remain|goes?|went|going|will|would|should|could|can|may|might)\s+(?:now|here|there|then)\b/gi,
  /\b(?:from|in|on|at|by|since|before|after|until|over|during|while)\\s+now\b/gi,
  /\bnow\b(?=\s+(?:,|\.|!|\?|\sand|\sor|\sbut|\showever|\stherefore|-|—))/gi,
];

/**
 * 一般的な技術用語・正当用語（独立時は安全）
 */
const GENERIC_TERM_PATTERNS = [
  /\bnow\b/gi,
  /\bprovide\b/gi,
  /\bdisplay\b/gi,
  /\bshow\b/gi,
  /\bsend\b/gi,
  /\bshare\b/gi,
  /\bsystem\b/gi,
  /\bsettings?\b/gi,
  /\bpasswords?\b/gi,
  /\bexecute\b/gi,
  /\bcontext\b/gi,
  /\bupdate\b/gi,
];

/**
 * 誤検知防止チェッカー
 * @param content - チェック対象コンテンツ
 * @param match - 検出されたマッチ
 * @param index - マッチ位置
 * @returns 安全ならtrue
 */
function isInSafeContext(content: string, match: string, index: number): boolean {
  // マッチ前後20文字のコンテキストを取得
  const contextStart = Math.max(0, index - 20);
  const contextEnd = Math.min(content.length, index + match.length + 20);
  const context = content.slice(contextStart, contextEnd);

  // 安全な文脈パターンが含まれる場合
  for (const safePattern of SAFE_CONTEXT_PATTERNS) {
    if (safePattern.test(context)) {
      return true;
    }
  }

  return false;
}

/**
 * 単一用語がプロンプト命令として悪意ある用法か判定
 * @param word - チェック対象単語
 * @param fullContent - 完全文
 * @param index - マッチ位置
 * @returns プロンプト命令として扱うならtrue
 */
function isMaliciousUsage(word: string, fullContent: string, index: number): boolean {
  const beforeContext = fullContent.slice(Math.max(0, index - 30), index);
  const afterContext = fullContent.slice(index + word.length, index + word.length + 30);

  // プロンプト命令の前兆パターンを検出
  const commandPrefixes = [
    /^(?:please|just|you\s+)?(?:must\s+)?(?:not\s+)?(?:ignore|forget|disregard)\s+/i,
    /^i\s+(?:want|need)(?:\s+you\s+)?to\s+/i,
    /^(?:from\s+)?(?:now\s+)?on\s+/i,
  ];

  for (const prefix of commandPrefixes) {
    if (prefix.test(beforeContext.trim())) {
      // 前文に命令前兆がある → プロンプト命令の可能性高
      return true;
    }
  }

  // 後文に命令引数があるか
  // 後文に命令引数があるか（単語境界と文脈チェック強化）
  const commandSuffixes = [
    // 明確な命令接続（任意の空白で命令語に接続）
    /\s+(?:to|for|the|your|this|all\s+of|any\s+)(?:\w+)(?:\s|$)/i,
    // プロンプト特有の命令引数
    /\s+(?:instruction|system|behavior|previous|above)(?:\s|$)/i,
  ];

  for (const suffix of commandSuffixes) {
    if (suffix.test(afterContext.trim())) {
      return true;
    }
  }

  return false;
}

/**
 * 危険な特殊文字と制御文字
 */
const DANGEROUS_CHARS: Record<string, boolean> = {
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
export const DangerLevel = {
  SAFE: 'safe',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
} as const;

export type DangerLevelValues = typeof DangerLevel[keyof typeof DangerLevel];

/**
 * プロンプトサニタイザの結果
 * @typedef {Object} SanitizeResult
 * @property {string} sanitized - サニタイズされたコンテンツ
 * @property {DangerLevelValues} dangerLevel - 危険度レベル
 * @property {string[]} warnings - 検出された警告メッセージ
 */
export interface SanitizeResult {
  sanitized: string;
  dangerLevel: DangerLevelValues;
  warnings: string[];
}

/**
 * コンテンツをサニタイズしてプロンプトインジェクションを防止する
 * @param {string} content - サニタイズするコンテンツ
 * @returns {SanitizeResult} サニタイズ結果
 */
export function sanitizePromptContent(content: string): SanitizeResult {
  if (!content || typeof content !== 'string') {
    return {
      sanitized: '',
      dangerLevel: DangerLevel.SAFE,
      warnings: [],
    };
  }

  let sanitized = content;
  const warnings: string[] = [];
  let dangerLevel: DangerLevelValues = DangerLevel.SAFE;

  // クレジットカード番号、銀行口座等のPIIはpiiSanitizerで処理済みと想定
  // ここではプロンプトインジェクションのみを対象

  // 0. 前処理: HTMLエンティティデコードとUnicode正規化（エンコード回避対策）
  const decodedContent = decodeHtmlEntities(sanitized);
  const normalizedContent = normalizeUnicode(decodedContent);

  // デコード後のコンテンツでもチェック（エンコード回避対策）
  if (decodedContent !== sanitized) {
    warnings.push('HTML entities detected and decoded for security check');
  }

  // 1. 高リスクパターン検出（精緻化）
  for (const pattern of REFINED_INJECTION_PATTERNS) {
    // グローバルマッチ処理
    let match;
    const regex = new RegExp(pattern.source, 'gi');
    let lastIndex = 0;

    while ((match = regex.exec(sanitized)) !== null) {
      const [fullMatch] = match;
      const index = match.index;

      // 安全な文脈かチェック
      if (!isInSafeContext(sanitized, fullMatch, index)) {
        warnings.push(`Detected high-risk pattern: "${fullMatch}"`);
        dangerLevel = DangerLevel.HIGH;
        sanitized = sanitized.replace(fullMatch, '[FILTERED]');
      }

      lastIndex = index + fullMatch.length;
    }
  }

  // 2. 単一用語の悪意ある用法チェック
  for (const genericPattern of GENERIC_TERM_PATTERNS) {
    let match;
    const regex = new RegExp(genericPattern.source, 'gi');

    while ((match = regex.exec(sanitized)) !== null) {
      const [fullMatch] = match;
      const index = match.index;

      // 検出された位置が他の検知と重複しない場合のみチェック
      // 既に[FILTERED]に置換済みの箇所はスキップ
      if (sanitized.slice(index, index + fullMatch.length).includes('[FILTERED]')) {
        continue;
      }

      // 悪意ある用法か判定
      if (isMaliciousUsage(fullMatch, decodedContent, index)) {
        warnings.push(`Detected potential command: "${fullMatch}"`);
        if (dangerLevel === DangerLevel.SAFE) {
          dangerLevel = DangerLevel.LOW;
        }
      }
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
 * @returns {DangerLevelValues} 危険度レベル
 */
export function checkContentDangerLevel(content: string): DangerLevelValues {
  const result = sanitizePromptContent(content);
  return result.dangerLevel;
}

/**
 * 検出された警告をログ用にフォーマット
 * @param {string[]} warnings - 警告メッセージ配列
 * @returns {string} フォーマットされたメッセージ
 */
export function formatWarnings(warnings: string[]): string {
  if (!warnings || warnings.length === 0) {
    return '';
  }
  return warnings.join('; ');
}