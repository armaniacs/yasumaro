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
 * TLD validation (add-time contract, unified with the JP-Anchor presets).
 *
 * PBI 2026-10-21-07: accepts multi-label TLDs so the UI can add values in the
 * same '.go.jp' format as the JP-Anchor presets. The verification-time
 * validator (DomainVerifier's private isValidTld) keeps its own multi-label
 * rules and is intentionally not shared with this add-time path.
 *
 * Contract:
 * - Empty / "*" / wildcard-containing input is rejected
 * - A leading dot is allowed and stripped before validation (".go.jp" -> "go.jp")
 * - RFC label rules: 1-63 characters per label, letters/digits/hyphens,
 *   no leading/trailing hyphen
 * - Multi-label TLDs (e.g. "go.jp") are accepted; total length is 2-253
 */
export function isValidTld(tld: string): boolean {
  const trimmed = tld.trim();

  if (!trimmed) return false;
  if (trimmed.includes('*')) return false;

  const normalized = trimmed.startsWith('.') ? trimmed.slice(1) : trimmed;

  if (!normalized) return false;
  if (normalized.length < 2) return false;
  if (normalized.length > 253) return false;
  if (normalized.startsWith('.') || normalized.endsWith('.')) return false;
  if (normalized.includes('..')) return false;

  const labelRegex = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  for (const label of normalized.split('.')) {
    if (!label || label.length > 63) return false;
    if (!labelRegex.test(label)) return false;
  }

  return true;
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
