/**
 * ublockParser/options.ts
 * uBlock Origin形式フィルターパーサーのオプションパース
 *
 * 【機能概要】: uBlock Origin形式のオプション文字列をパースし、内部データ構造に変換
 * 🟢 信頼性レベル: plan/UII/02-phase2-parser.md および uBlock Origin標準構文に基づく実装
 */

import { isValidString } from './validation.js';
import { OPTION_TYPES, PREFIXES } from './constants.js';

export interface OptionValues {
  domains?: string[];
  negatedDomains?: string[];
  thirdParty?: boolean;
  firstParty?: boolean;
  important?: boolean;
  matchCase?: boolean;
}

/**
 * 【ヘルパー関数】: ドメインオプションのドメインリストをパース
 * 【改善内容】: parseOptionsからドメイン処理ロジックを分離して単一責任原則適用
 * 【設計方針】: | 区切りのドメインリストを配列に変換し、空文字をフィルタ
 * 【処理効率化】: filterによる空文字排除で確実な配列生成
 * 【可読性向上】: ドメイン処理ロジックが独立して明確
 * 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載されるドメイン構文
 * @param {string} domainValue - `example.com|test.com` 形式のドメイン値
 * @returns {string[]} - クリーンなドメイン配列（空文字は除外）
 */
export function parseDomainList(domainValue: string): string[] {
  // 【入力値検証】: null/undefinedの場合は空配列を返す 🟢
  if (!isValidString(domainValue)) {
    return [];
  }

  // 【ドメイン分割】: | 区切りでドメイン配列に分割 🟢
  // 【フィルタリング】: 空文字を除外して有効なドメインのみ 🟢
  // 【処理効率化】: filterで確実な配列構築 🟢
  return domainValue.split(OPTION_TYPES.DOMAIN_SEPARATOR).filter(d => d !== '');
}

/**
 * ルールのオプション部分をパース
 *
 * 【機能概要】: uBlock Origin形式のオプション文字列をパースし、内部データ構造に変換
 * 【改善内容】:
 *   - ヘルパー関数parseDomainListでドメイン処理を分離
 *   - 定数OPTION_TYPESでハードコードを削除
 *   - シンプルなif-elseチェーンで可読性向上
 * 【設計方針】: カンマ区切りのオプションを分割し、各オプションタイプごとに適切に処理
 * 【パフォーマンス】: O(n)のループ処理、各オプションに対する定数時間処理
 * 【保守性】: 定数とヘルパー関数の変更が一箇所で適用
 * 🟢 信頼性レベル: plan/UII/02-phase2-parser.md および uBlock Origin標準構文に基づく実装
 * @param {string} optionsString - オプション文字列（`domain=example.com,3p,important` 等）
 * @returns {OptionValues} - パースされたオプションオブジェクト
 */
export function parseOptions(optionsString: string): OptionValues {
  // 【入力値検証】: null/undefined/空文字の場合は空オブジェクトを返す 🟢
  if (!isValidString(optionsString)) {
    return {};
  }

  const trimmedOptions = optionsString.trim();
  if (trimmedOptions === '') {
    return {};
  }

  // 【オプション解析】: カンマ区切りでオプションを分割して個別にパース 🟢
  const result: OptionValues = {};
  const optionTokens = trimmedOptions.split(OPTION_TYPES.OPTION_SEPARATOR);

  // 【オプション処理ループ】: 各トークンを処理して必要なプロパティを設定 🟢
  for (const token of optionTokens) {
    const processedToken = token.trim();

    // 【空白トークンスキップ】: トークンが空の場合はスキップ 🟢
    if (processedToken === '') {
      continue;
    }

    // 【domain option handling】: parse `domain=` and `~domain=` tokens in one path.
    // 【equivalent merge (PBI 2026-10-21-06)】: the two syntaxes map to the same
    // negatedDomains, so `~domain=` is normalized into a single parse path and the
    // duplicated second grammar branch is removed.
    const isNegatedDomainOption = processedToken.startsWith(
      OPTION_TYPES.EXCLUDE_DOMAIN_PREFIX + OPTION_TYPES.DOMAIN_PREFIX
    );
    if (isNegatedDomainOption || processedToken.startsWith(OPTION_TYPES.DOMAIN_PREFIX)) {
      // 【normalization】: rewrite `~domain=X` into the equivalent `domain=~X` value
      const domainValue = isNegatedDomainOption
        ? OPTION_TYPES.EXCLUDE_DOMAIN_PREFIX + processedToken.substring((OPTION_TYPES.EXCLUDE_DOMAIN_PREFIX + OPTION_TYPES.DOMAIN_PREFIX).length)
        : processedToken.substring(OPTION_TYPES.DOMAIN_PREFIX.length); // value after `domain=`

      // 【empty domain skip】: nothing to parse when there is no value
      if (domainValue === '') {
        continue;
      }

      // 【negated domain detection】: a `~` prefix marks excluded domains
      if (domainValue.startsWith(OPTION_TYPES.EXCLUDE_DOMAIN_PREFIX)) {
        const negatedList = domainValue.substring(OPTION_TYPES.EXCLUDE_DOMAIN_PREFIX.length); // value after `~`
        const negatedDomains = parseDomainList(negatedList);
        if (negatedDomains.length > 0) {
          result.negatedDomains = negatedDomains;
        }
      } else {
        // 【allowed domain handling】: parse the domain list with the helper
        const domains = parseDomainList(domainValue);
        if (domains.length > 0) {
          result.domains = domains;
        }
      }
    }

    // 【3pオプション処理】: サードパーティフラグを設定 🟢
    else if (processedToken === OPTION_TYPES.THIRD_PARTY) {
      result.thirdParty = true;
    }

    // 【1pオプション処理】: ファーストパーティフラグを設定 🟢
    else if (processedToken === OPTION_TYPES.FIRST_PARTY) {
      result.firstParty = true;
    }

    // 【importantオプション処理】: 重要フラグを設定 🟢
    else if (processedToken === OPTION_TYPES.IMPORTANT) {
      result.important = true;
    }

    // 【~importantオプション処理】: 重要フラグを解除 🟡
    else if (processedToken === OPTION_TYPES.NOT_IMPORTANT) {
      result.important = false;
    }

    // 【match-caseオプション処理】: 大文字小文字を区別する 🟡
    else if (processedToken === OPTION_TYPES.MATCH_CASE) {
      result.matchCase = true;
    }

    // 【~match-caseオプション処理】: 大文字小文字を区別しない 🟡
    else if (processedToken === OPTION_TYPES.NOT_MATCH_CASE) {
      result.matchCase = false;
    }

    // 【不明オプションスキップ】: 上記以外は安全にスキップ 🟢
    // 【注記】: エラーログや警告は出さず、静かに処理継続
  }

  return result;
}

/**
 * ルール行からオプション部分を抽出してパース
 * 【設計方針】: buildRuleObjectからオプション処理を分離して単一責任原則適用
 * 【処理効率化】: indexOfとsubstringで効率的にオプション部分を抽出
 * 【可読性向上】: オプション処理ロジックが独立して明確
 * 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載されるオプション構文
 * @param {string} line - トリムされたルール行
 * @returns {OptionValues} - パースされたオプションオブジェクト
 */
export function parseRuleOptions(line: string): OptionValues {
  const optionIndex = line.indexOf(PREFIXES.OPTION);
  if (optionIndex === -1) {
    return {}; // オプションなし
  }

  const optionsString = line.substring(optionIndex + 1); // $以降を抽出
  return parseOptions(optionsString);
}