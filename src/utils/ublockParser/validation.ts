/**
 * ublockParser/validation.ts
 * uBlock Origin形式フィルターパーサーのバリデーション関数
 *
 * 【機能概要】: 入力値検証とデータ検証を提供
 * 🟢 信頼性レベル: 基本的な型安全パターンおよび plan/UII/10-data-structures.md に記載される制約
 */

import { PATTERNS } from './constants.js';

/**
 * ドメインラベル（ドット区切りの各要素）に許可される文字。
 * 空文字・英数字・ハイフン・アンダースコアの並びのみを受理する線形パターン。
 * 量指定子のネストがないため入力長に対し線形で、ReDoS に対し安全（VULN-025）。
 */
const DOMAIN_LABEL_CHARS = /^[a-z0-9_-]*$/i;

// ============================================================================
// 入力値検証
// ============================================================================

/**
 * 【ヘルパー関数】: 文字列型の入力値を検証
 * 【再利用性】: すべてのpublic関数で使用する共通の入力検証
 * 【単一責任】: 文字列型妥当性の確認
 * 🟢 信頼性レベル: 基本的な型安全パターン
 * @param {unknown} value - 検証対象の値
 * @returns {boolean} - 有効な文字列ならtrue
 */
export function isValidString(value: unknown): value is string {
  return value != null && typeof value === 'string' && value.length > 0;
}

// ============================================================================
// データ検証
// ============================================================================

/**
 * 【ヘルパー関数】: ドメインの妥当性を検証
 * 【設計方針】: 空ドメインチェックと形式チェックを分離して明確化
 * 【処理効率化】: 短絡評価で不要なチェックをスキップ
 * 【可読性向上】: 各検証が独立したif文で明確
 * 🟢 信頼性レベル: plan/UII/10-data-structures.md に記載されるドメイン制約
 * @param {string} domain - 検証対象のドメイン
 * @returns {boolean} - 有効なドメインならtrue
 */
export function validateDomain(domain: string): boolean {
  // 【空ドメイン検証】: ドメインが空の場合は無効
  if (!domain) {
    return false;
  }

  // 【連続ドット検証】: 連続するドットを含むドメインは無効
  if (domain.includes('..')) {
    return false;
  }

  // 【ワイルドカードプレフィックス】: 先頭 `*.` のみ許可し、残りを通常のドメインとして検証
  const body = domain.startsWith('*.') ? domain.slice(2) : domain;
  if (!body) {
    return false;
  }

  // 【線形なラベル検証】: ドット区切りの各ラベルを個別に文字チェックする。
  // ネストした量指定子の正規表現（旧 PATTERNS.DOMAIN_VALIDATION）を避けることで
  // 悪意ある入力による指数バックトラック（ReDoS, VULN-025）を封じる。
  // 旧実装との互換: 空ラベル（先頭/末尾ドット）を許容していたため split 結果の
  // 空要素も受理する。連続ドット（空ラベルが隣接）は上のガードで既に弾いている。
  return body.split('.').every((label) => DOMAIN_LABEL_CHARS.test(label));
}

// ============================================================================
// 行タイプ検証
// ============================================================================

/**
 * 指定された行がuBlock形式のコメント行か判定
 *
 * 【設計方針】: シンプルなプレフィックス判定で確実性を確保
 * 【パフォーマンス】: 正規表現キャッシュによる高速判定
 * 【保守性】: isValidStringの変更があれば一箇所で適用
 * 🟢 信頼性レベル: plan/UII/00-overview.md に記載される基本構文
 * @param {string} line - 判定対象の行
 * @returns {boolean} - コメント行ならtrue
 */
export function isCommentLine(line: string): boolean {
  // 【入力値検証】: null/undefinedの場合はfalseを返してエラーを防ぐ 🟢
  if (!isValidString(line)) {
    return false;
  }
  // 【パターンマッチング】: `!` または `#` で始まる行をコメント行と判定
  // インデントがあってもコメントとして認識するためにtrimする
  const trimmedLine = line.trim();
  return PATTERNS.COMMENT_PREFIX.test(trimmedLine) || PATTERNS.HOSTS_COMMENT_PREFIX.test(trimmedLine);
}

/**
 * 指定された行が空行か判定
 *
 * 【設計方針】: trim後の空白行チェックで柔軟な判定
 * 【パフォーマンス】: trimと空文字列比較は最効率的
 * 【保守性]: isValidStringの変更があれば一箇所で適用
 * 🟢 信頼性レベル: 基本的な文字列判定機能
 * @param {string} line - 判定対象の行
 * @returns {boolean} - 空行ならtrue
 */
export function isEmptyLine(line: string): boolean {
  // 【入力値検証】: null/undefined/空文字列の場合はtrueを返して処理をスキップ 🟢
  if (!isValidString(line)) {
    return true;
  }
  // 【空白判定】: trimした後に空文字列になるかチェック
  return line.trim() === '';
}

/**
 * 指定された行が有効なuBlockルールパターンか判定
 *
 * 【設計方針】: `||` プレフィックスと `^` サフィックスの両方をチェック
 * 【パフォーマンス】: 正規表現キャッシュによる高速判定
 * 【保守性】: isValidStringの変更があれば一箇所で適用
 * 🟢 信頼性レベル: plan/UII/00-overview.md に記載される基本構文
 * @param {string} line - 判定対象の行
 * @returns {boolean} - 有効なパターンならtrue
 */
export function isValidRulePattern(line: string): boolean {
  // 【入力値検証】: null/undefinedの場合はinvalid 🟢
  if (!isValidString(line)) {
    return false;
  }
  // 【パターン検証】: `||` プレフィックスと `^` サフィックスの両方を検出
  const hasPrefix = PATTERNS.RULE_PREFIX.test(line);
  const hasSuffix = PATTERNS.RULE_SUFFIX.test(line);

  // 【空パターン検証】: `||^` のようにドメインが空のパターンは無効
  // プレフィックスとサフィックスの間に少なくとも1文字必要
  if (hasPrefix && hasSuffix && line.length > 3) {
    return true;
  }

  return false;
}