/**
 * domainValidation.ts
 * Trust Database のドメイン/TLD バリデーション関数。
 * trustDb.ts から抽出し、独立してテスト可能にする。
 */

const DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i;

/**
 * RFC準拠のドメイン名バリデーション
 * @param domain バリデーション対象のドメイン名
 * @returns 有効なドメイン名の場合 true、それ以外の場合 false
 */
export function isValidDomain(domain: string): boolean {
  const normalized = domain.toLowerCase().trim();

  if (!normalized) return false;
  if (normalized.length > 253) return false;
  if (normalized.startsWith('.')) return false;
  if (normalized.endsWith('.')) return false;
  if (!normalized.includes('.')) return false;
  if (!DOMAIN_REGEX.test(normalized)) return false;

  const labels = normalized.split('.');
  for (const label of labels) {
    if (label.length === 0) return false;
    if (label.length > 63) return false;
  }

  return true;
}

/**
 * TLD バリデーション
 * @param tld バリデーション対象のTLD（.を含むか含まない）
 * @returns 有効なTLDの場合 true、それ以外の場合 false
 */
export function isValidTld(tld: string): boolean {
  const normalized = tld.trim();

  if (!normalized.startsWith('.')) {
    return isValidTld('.' + normalized);
  }

  const tldWithoutDot = normalized.slice(1);

  if (tldWithoutDot.length < 2) return false;
  if (tldWithoutDot.length > 63) return false;

  const labelRegex = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  return labelRegex.test(tldWithoutDot);
}

/**
 * バージョン文字列を数値配列に変換し、辞書順比較する。
 * "1.10.0" > "1.9.0" のように数値比較する。
 */
export function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aVal = aParts[i] || 0;
    const bVal = bParts[i] || 0;
    if (aVal !== bVal) return aVal - bVal;
  }
  return 0;
}
