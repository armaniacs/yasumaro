import { sanitizeRegex } from '../piiSanitizer.js';

// セキュリティ強化: log sanitization への深度制限と循環参照保護
// redaction.ts と整合
const MAX_RECURSION_DEPTH = 100;
const SANITIZE_RESULT = {
  TOO_DEEP: '[SANITIZED: too deep]',
  CIRCULAR_REF: '[SANITIZED: circular reference]',
} as const;

/**
 * ログの詳細情報をサニタイズする（PII 検出とマスキング）
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

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(details)) {
    if (value === null || value === undefined) {
      sanitized[key] = value;
      continue;
    }

    if (typeof value === 'string') {
      const result = await sanitizeRegex(value);
      if (result.maskedItems.length > 0) {
        sanitized[key] = result.text;
        sanitized[`${key}_maskedTypes`] = result.maskedItems.map((m) => (typeof m === 'string' ? m : m.type));
      } else {
        sanitized[key] = value;
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
        sanitized.push(result.text);
      } else {
        sanitized.push(item);
      }
    } else if (typeof item === 'object') {
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
