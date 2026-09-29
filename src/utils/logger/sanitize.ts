import { sanitizeRegex } from '../piiSanitizer.js';
import { maskSecretValueByKey } from '../sensitiveDataMask.js';
import { neutralizeLogText } from './neutralize.js';

// セキュリティ強化: log sanitization への深度制限と循環参照保護
// redaction.ts と整合
const MAX_RECURSION_DEPTH = 100;
const SANITIZE_RESULT = {
  TOO_DEEP: '[SANITIZED: too deep]',
  CIRCULAR_REF: '[SANITIZED: circular reference]',
} as const;

/**
 * ログの詳細情報をサニタイズする（キー名による秘匿マスキングと PII 検出・マスキング）。
 * 順序は「キー名による秘匿マスキング → PII 正規表現」で固定され、
 * 深度制限と循環参照保護付き。
 *
 * @param details - サニタイズ対象の詳細情報
 * @param visitedObjects - 循環参照検出用 WeakSet
 * @param depth - 現在の再帰深度
 * @returns サニタイズ済みの詳細情報
 */
async function sanitizeLogDetails(
  details: Record<string, unknown>,
  visitedObjects?: WeakSet<object>,
  depth = 0,
): Promise<Record<string, unknown>> {
  if (details === null || details === undefined) {
    return details;
  }

  if (typeof details !== 'object') {
    throw new Error(`Expected object, got ${typeof details}`);
  }

  if (typeof WeakSet !== 'undefined' && !visitedObjects) {
    visitedObjects = new WeakSet<object>();
  }

  if (depth >= MAX_RECURSION_DEPTH) {
    return { __sanitized: SANITIZE_RESULT.TOO_DEEP };
  }

  if (visitedObjects && visitedObjects.has(details)) {
    return { __sanitized: SANITIZE_RESULT.CIRCULAR_REF };
  }

  if (details instanceof Date) {
    return { __value: details.toISOString() };
  }

  if (details instanceof Error) {
    return { message: details.message, stack: details.stack };
  }

  if (visitedObjects) {
    visitedObjects.add(details);
  }

  // Null-prototype accumulator (VULN-003): keyed assignment on a plain `{}`
  // invokes the __proto__ setter for attacker-controlled keys (LOG_FORWARD
  // details). A dictionary-prototype object has no such setter, so every
  // `sanitized[key] = ...` below is a plain own-property write and the
  // returned entry's prototype can never be re-pointed.
  const sanitized = Object.create(null) as Record<string, unknown>;

  for (const [key, value] of Object.entries(details)) {
    // 秘匿マスキングを PII 段より先に適用する。キー名で秘匿と判定できるものは
    // 値の型（文字列・数値・null・undefined・オブジェクト）に関わらず丸ごと
    // 置換し、PII 判定に値の形を依存させない。マスクされなかった値は
    // 同一参照で返るので、ここで `!==` による通過判定ができる。
    const maskedValue = maskSecretValueByKey(key, value);
    if (maskedValue !== value) {
      sanitized[key] = maskedValue;
      continue;
    }

    if (value === null || value === undefined) {
      sanitized[key] = value;
      continue;
    }

    if (typeof value === 'string') {
      // Order: PII mask first, then neutralize control bytes / ANSI / newlines.
      const result = await sanitizeRegex(value);
      if (result.maskedItems.length > 0) {
        sanitized[key] = neutralizeLogText(result.text);
        sanitized[`${key}_maskedTypes`] = result.maskedItems.map((m) => (typeof m === 'string' ? m : m.type));
      } else {
        sanitized[key] = neutralizeLogText(value);
      }
    } else if (typeof value === 'object') {
      if (Array.isArray(value)) {
        sanitized[key] = await sanitizeArray(value, visitedObjects, depth + 1);
      } else {
        sanitized[key] = await sanitizeLogDetails(value as Record<string, unknown>, visitedObjects, depth + 1);
      }
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * 配列を再帰的にサニタイズするヘルパー関数
 */
async function sanitizeArray(
  arr: unknown[],
  visitedObjects?: WeakSet<object>,
  depth = 0,
): Promise<unknown[] | string> {
  if (depth >= MAX_RECURSION_DEPTH) {
    return SANITIZE_RESULT.TOO_DEEP;
  }

  if (visitedObjects && visitedObjects.has(arr)) {
    return SANITIZE_RESULT.CIRCULAR_REF;
  }

  if (visitedObjects) {
    visitedObjects.add(arr);
  }

  const sanitized: unknown[] = [];

  for (const item of arr) {
    if (item === null || item === undefined) {
      sanitized.push(item);
      continue;
    }

    if (typeof item === 'string') {
      const result = await sanitizeRegex(item);
      if (result.maskedItems.length > 0) {
        sanitized.push(neutralizeLogText(result.text));
      } else {
        sanitized.push(neutralizeLogText(item));
      }
    } else if (typeof item === 'object') {
      // 配列要素にはキー名が無いため、秘匿マスキングはオブジェクト要素を
      // sanitizeLogDetails に渡した再帰の中でだけ効く。生の文字列要素は
      // PII 段と中立制御バイトの除去に委ねる。
      if (Array.isArray(item)) {
        sanitized.push(await sanitizeArray(item, visitedObjects, depth + 1));
      } else {
        if (item instanceof Date) {
          sanitized.push(item.toISOString());
        } else if (item instanceof Error) {
          sanitized.push({ message: item.message, stack: item.stack });
        } else {
          sanitized.push(await sanitizeLogDetails(item as Record<string, unknown>, visitedObjects, depth + 1));
        }
      }
    } else {
      sanitized.push(item);
    }
  }

  return sanitized;
}

export { sanitizeLogDetails, sanitizeArray };
