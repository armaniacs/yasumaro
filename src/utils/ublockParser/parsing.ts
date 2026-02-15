/**
 * ublockParser/parsing.ts
 * uBlock Origin形式フィルターパーサーのパーシングロジック
 *
 * 【機能概要】: uBlock Origin形式のドメインフィルターをパースし、内部データ構造に変換
 * 【実装方針】: 入力値検証とパターンマッチングによる安全なパース処理
 * 【テスト対応】: ソース `src/utils/__tests__/ublockParser.test.js` の29テストケースに対応
 * 🟢 信頼性レベル: plan/UII/02-phase2-parser.md および plan/UII/10-data-structures.md に基づく実装
 */

import { PATTERNS, RULE_TYPES, PREFIXES, RuleType } from './constants.js';
import { isValidString, validateDomain } from './validation.js';
import { buildRuleObject, generateRuleId, UblockRule } from './transform.js';
import { parseRuleOptions } from './options.js';

// ============================================================================
// ルール解析ヘルパー関数
// ============================================================================

/**
 * 【ヘルパー関数】: トリムされた行からルールタイプと作業用行を抽出
 * 【設計方針】: プレフィックス解析とタイプ判定を分離して可読性向上
 * 【処理効率化】: 単一のif-else連鎖で効率的に判定
 * 【可読性向上】: 各ケースの意図が明確な条件分岐
 * 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載される構文解析
 * @param {string} trimmedLine - トリムされた行
 * @returns {{ type: RuleType; workLine: string } | null} - タイプと作業用行、無効ならnull
 */
function extractRuleTypeAndWorkLine(trimmedLine: string): { type: RuleType; workLine: string } | null {
  // 【例外ルール判定】: `@@||` プレフィックスで例外ルールと判定
  if (trimmedLine.startsWith(PREFIXES.EXCEPTION)) {
    return {
      type: RULE_TYPES.EXCEPTION,
      workLine: trimmedLine.substring(PREFIXES.EXCEPTION.length)
    };
  }

  // 【ブロックルール判定】: `||` プレフィックスでブロックルールと判定
  if (trimmedLine.startsWith(PREFIXES.RULE)) {
    return {
      type: RULE_TYPES.BLOCK,
      workLine: trimmedLine.substring(PREFIXES.RULE.length)
    };
  }

  // 【不正形式判定】: どちらのプレフィックスもない場合は無効
  return null;
}

/**
 * 【ヘルパー関数】: 作業用行からドメインを抽出
 * 【設計方針】: サフィックス除去と空白削除を分離して処理を明確化
 * 【処理効率化】: 簡潔な文字列操作で効率的にドメイン抽出
 * 【可読性向上】: 各処理ステップが明確
 * 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載される構文解析
 * @param {string} workLine - プレフィックスを除去した行
 * @returns {string | null} - 抽出されたドメイン、無効ならnull
 */
function extractDomain(workLine: string): string | null {
  // 【オプションセパレータ検索】: オプションセパレータ($)の位置を検索
  const optionSeparatorIndex = workLine.indexOf(PREFIXES.OPTION);

  // 【ドメイン部分抽出】: オプションセパレータより前の部分をドメイン部分とする
  let domainPart;
  if (optionSeparatorIndex !== -1) {
    domainPart = workLine.substring(0, optionSeparatorIndex);
  } else {
    domainPart = workLine;
  }

  // 【サフィックス検証】: 末尾に `^` があるか確認
  if (!domainPart.endsWith(PREFIXES.SUFFIX)) {
    return null;
  }

  // 【ドメイン抽出】: `^` サフィックスを除去
  let domain = domainPart.substring(0, domainPart.length - PREFIXES.SUFFIX.length);

  // 【空白除去】: ドメイン内の空白も削除して正規化
  domain = domain.replace(/\s+/g, '');

  return domain;
}

/**
 * hosts形式の行をパース
 * 【設計方針】: 0.0.0.0/127.0.0.1 ドメイン 形式をブロックルールに変換
 * @param {string} rawLine - 元の行
 * @param {string} hostsPart - IPアドレス以降の部分
 * @returns {UblockRule|{type: string, originalLine: string}|null} - パースされたルール
 */
function parseHostsLine(rawLine: string, hostsPart: string): UblockRule | { type: string, originalLine: string } | null {
  // ホスト部分からドメインを抽出（コメント部分を除去）
  let domain = hostsPart.split('#')[0].trim();

  // 複数のスペースで区切られている場合は最初のドメインのみ使用
  domain = domain.split(/\s+/)[0];

  // ドメインが空の場合はスキップ（nullを返す＝エラー扱いではなく、無視すべき行として扱うための準備）
  if (!domain) {
    return null;
  }

  // 無視すべきドメイン（localhostなど）はIGNOREタイプとして返す 🟢
  // これらはエラーではなく、意図的に除外すべきエントリ
  const IGNORED_DOMAINS = [
    'localhost',
    'local',
    'localhost.localdomain',
    'broadcasthost',
    'ip6-localhost',
    'ip6-loopback',
    'ip6-localnet',
    'ip6-mcastprefix',
    'ip6-allnodes',
    'ip6-allrouters',
    'ip6-allhosts'
  ];

  if (IGNORED_DOMAINS.includes(domain)) {
    return {
      type: RULE_TYPES.IGNORE,
      originalLine: rawLine
    };
  }

  // ドメイン検証
  if (!validateDomain(domain)) {
    return null;
  }

  // uBlock形式に変換してルールオブジェクトを構築
  const convertedLine = `||${domain}^`;
  return {
    id: generateRuleId(convertedLine),
    rawLine: convertedLine,
    originalLine: rawLine, // 元のhosts形式を保持
    type: RULE_TYPES.BLOCK,
    domain: domain,
    pattern: domain,
    options: { thirdParty: undefined, firstParty: undefined, domains: [], important: false }
  };
}

// ============================================================================
// Public API - パース関数
// ============================================================================

/**
 * uBlock形式の単一フィルタールールをパース
 *
 * 【改善内容】:
 *   - ヘルパー関数への分割で可読性向上
 *   - isValidStringによる一貫した入力検証
 *   - 定数使用によるハードコード削除
 * 【設計方針】: ||hostname^ @@||hostname^ 形式のドメインブロックルールをパース
 * 【パフォーマンス】: 各ヘルパー関数が単一責任を持つため効率的
 * 【保守性】: 各処理が独立しているため変更が容易
 * 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載される基本機能
 * @param {string} line - フィルタールールの1行
 * @returns {UblockRule|null} - パースされたルール（無効ならnull）
 */
export function parseUblockFilterLine(line: string): UblockRule | null {
  // 【入力値検証】: null/undefinedの場合はnullを返す 🟢
  if (!isValidString(line)) {
    return null;
  }

  // 【トリム処理】: 前後空白を除去してパース 🟢
  // 【テスト対応】: テスト13「前後空白を含む行はトリムしてパース」
  const trimmedLine = line.trim();

  // 【コメント行スキップ】: `!` で始まる行は無効（nullを返す）🟢
  // 【テスト対応】: テスト4「コメント行はスキップされる」
  // isCommentLineをインポートすると循環依存になるため、ここで直接判定
  if (PATTERNS.COMMENT_PREFIX.test(trimmedLine)) {
    return null;
  }

  // 【hosts形式コメントスキップ】: `#` で始まる行は無効（nullを返す）🟢
  if (PATTERNS.HOSTS_COMMENT_PREFIX.test(trimmedLine)) {
    return null;
  }

  // 【空行スキップ】: 空行は無効（nullを返す）🟢
  // 【テスト対応】: テスト5「空行はスキップされる」
  // isEmptyLineをインポートすると循環依存になるため、ここで直接判定
  if (trimmedLine === '') {
    return null;
  }

  // 【hosts形式検出】: 0.0.0.0 または 127.0.0.1 で始まる行を処理 🟢
  const hostsMatch = PATTERNS.HOSTS_FORMAT.exec(trimmedLine);
  if (hostsMatch) {
    const parsed = parseHostsLine(trimmedLine, hostsMatch[2]);
    // IGNOREタイプまたはnullの場合はnullを返す
    if (!parsed || (parsed as any).type === RULE_TYPES.IGNORE) {
      return null;
    }
    return parsed as UblockRule;
  }

  // 【ルールタイプ判定】: プレフィックス解析 🟢
  // 【テスト対応】: テスト1（ブロックルール）、テスト2（例外ルール）
  const typeResult = extractRuleTypeAndWorkLine(trimmedLine);
  if (!typeResult) {
    return null; // 【不正形式】: 有効なプレフィックスがない場合
  }

  // 【ドメイン抽出】: サフィックス除去と空白削除 🟢
  // 【テスト対応】: テスト1,3,6（正常系テスト）、テスト8,9（異常系テスト）
  const domain = extractDomain(typeResult.workLine);
  if (domain === null) {
    return null; // 【サフィックスなし】: `^` がない場合
  }

  // 【ドメイン検証】: 空ドメインと不正文字をチェック 🟡
  // 【セキュリティ】: 不正なドメイン形式による問題を防止 🟢
  // 【テスト対応】: テスト9,10（異常系テスト）
  if (!validateDomain(domain)) {
    return null; // 【不正なドメイン】: 形式が不正
  }

  // 【ルール構築】: UblockRuleオブジェクトを生成して返却 🟢
  // 注意: buildRuleObjectは parseRuleOptions を呼び出す
  return buildRuleObject(trimmedLine, typeResult.type, domain);
}