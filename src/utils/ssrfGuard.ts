/**
 * ssrfGuard.ts
 * SSRF防止・IP分類・localhostポリシー。fetch.ts のトランスポート層
 * (timeout/retry/abort) から分離し、fetchモックなしで単体テスト可能にする。
 */

import { errorMessage } from './errorUtils.js';

// セキュリティ定数
const ALLOWED_PROTOCOLS = new Set(['https:', 'http:']);
const BLOCKED_PATTERNS = [
  // 16進等の代替表現やブラケット付きIPv6をブロック。
  // 127.0.0.1 / localhost の通常形式は blockLocalhost 分岐で isPrivateIpAddress +
  // 明示的な localhost 判定によりブロックする（Obsidian用途は blockLocalhost:false で許可）。
  /^0x7f\./i,         // 0x7f.0.0.1 (alternative localhost format)
  /^::1/,             // IPv6 localhost
  /^\[::f{0,4}:1\]$/i // ::1 in brackets
];

export interface ValidateUrlOptions {
  requireValidProtocol?: boolean;
  blockLocalhost?: boolean;
}

/**
 * URLを検証（オプション）
 * @param {string} url - 検証するURL
 * @param {ValidateUrlOptions} options - 検証オプション
 * @throws {Error} URLが無効またはブロックされている場合
 */
export function validateUrl(url: string, options: ValidateUrlOptions = {}): void {
  const { requireValidProtocol = true, blockLocalhost = false } = options;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (e: unknown) {
    throw new Error(`Invalid URL: ${errorMessage(e)}`);
  }

  // プロトコル検証（オプション）
  if (requireValidProtocol && !ALLOWED_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new Error(`Unsupported protocol: ${parsedUrl.protocol}. Only http:// and https:// are allowed.`);
  }

  // localhostブロック（オプション）
  // Obsidian APIでlocalhostを使用するためデフォルトではブロックしない
  if (blockLocalhost) {
    // 127.0.0.1 / ::1 等のループバックは isPrivateIpAddress で検出する。
    // isPrivateIpAddress('localhost') は false を返すため、localhost は明示的に判定が必要。
    if (isPrivateIpAddress(parsedUrl.hostname)) {
      throw new Error(`Blocked hostname: ${parsedUrl.hostname}. Access to private network is not allowed.`);
    }
    // ドメイン名形式の localhost は isPrivateIpAddress では検出できないため明示的にブロック
    const lowerHostname = parsedUrl.hostname.toLowerCase();
    if (lowerHostname === 'localhost' || lowerHostname.endsWith('.localhost')) {
      throw new Error(`Blocked hostname: ${parsedUrl.hostname}. Access to localhost is not allowed.`);
    }
    // 代替表現 (0x7f., ::1 bracket 等) は BLOCKED_PATTERNS でカバー
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(parsedUrl.hostname)) {
        throw new Error(`Blocked hostname: ${parsedUrl.hostname}. Access to localhost addresses is not allowed.`);
      }
    }
  }
}

/**
 * IPv6ホスト名からブラケットを除去する
 * URL.hostname はIPv6アドレスを [::1] の形式で返すため、
 * プライベートIP判定の前にブラケットを正規化する
 * @param {string} hostname - チェックするホスト名
 * @returns {string} ブラケットを除去したホスト名
 */
export function normalizeIpHostname(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

/**
 * プライベートIPアドレスかどうか判定
 * @param {string} hostname - チェックするホスト名
 * @returns {boolean} プライベートIPの場合true
 */
export function isPrivateIpAddress(hostname: string): boolean {
  const normalized = normalizeIpHostname(hostname);

  // IPv4形式（xxx.xxx.xxx.xxx）
  const ipv4Match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, aStr, bStr, cStr, dStr] = ipv4Match;
    const a = Number(aStr);
    const b = Number(bStr);
    const c = Number(cStr);
    const d = Number(dStr);

    // 各オクテットが0-255の範囲内かチェック
    // 無効なIPアドレス（999.999.999.999など）を識別するため
    if (a < 0 || a > 255 || b < 0 || b > 255 || c < 0 || c > 255 || d < 0 || d > 255) {
      return false; // 無効なIPv4アドレスはプライベートアドレスとして扱わない
    }

    // 10.x.x.x (10.0.0.0/8)
    if (a === 10) return true;

    // 172.16.x.x - 172.31.x.x (172.16.0.0/12)
    if (a === 172 && b >= 16 && b <= 31) return true;

    // 192.168.x.x (192.168.0.0/16)
    if (a === 192 && b === 168) return true;

    // 127.x.x.x (ループバック)
    if (a === 127) return true;

    // 169.254.x.x (リンクローカル、クラウドメタデータ含む)
    if (a === 169 && b === 254) return true;

    return false;
  }

  // IPv6形式のプライベートアドレスの完全なチェック
  const ipv6Lower = normalized.toLowerCase();

  // ::1 - ループバックアドレス
  if (ipv6Lower === '::1') {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:0:0/96)。
  // この形式は IPv4 アドレスを IPv6 で表現するため、IPv4 部分を抽出して
  // プライベート判定にフォールバックする。攻撃者が SSRF 対策を迂回する
  // (例: ::ffff:10.0.0.1 / ::ffff:a00:1 で内部ネットワークへアクセス) のを防ぐ。
  const ipv4MappedMatch = ipv6Lower.match(
    /^::ffff:((?:\d{1,3}\.){3}\d{1,3}|[0-9a-f]{1,4}:[0-9a-f]{1,4}|[0-9a-f]{1,8})$/
  );
  if (ipv4MappedMatch) {
    const embeddedIpv4 = ipv4MappedMatch[1] ?? '';
    // ドット区切り IPv4 (::ffff:10.0.0.1)
    if (embeddedIpv4.includes('.')) {
      return isPrivateIpAddress(embeddedIpv4);
    }
    // 16進の IPv4-mapped。2グループ (::ffff:aaaa:bbbb) または 1グループ (::ffff:aabbccdd) で、
    // 32bit IPv4 を表現する。→ ドット区切り IPv4 に変換して再帰判定。
    // 注意: JS の << は 32bit 符号付き整数を返すため、最上位ビットが立つと負数になる。
    //        >>> 0 で符号なし 32bit に正規化する。
    const hexParts = embeddedIpv4.split(':');
    const ipv4Int = Number.parseInt(hexParts[0] ?? '', 16);
    const ipv4Hex = (hexParts.length === 2
      ? (ipv4Int << 16) | Number.parseInt(hexParts[1] ?? '', 16)
      : ipv4Int) >>> 0;
    const a = (ipv4Hex >>> 24) & 0xff;
    const b = (ipv4Hex >>> 16) & 0xff;
    const c = (ipv4Hex >>> 8) & 0xff;
    const d = ipv4Hex & 0xff;
    return isPrivateIpAddress(`${a}.${b}.${c}.${d}`);
  }

  // fe80::/10 - リンクローカルアドレス (fe80:: ~ febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff)
  if (/^fe[89ab][0-9a-f](:|$)/i.test(ipv6Lower)) {
    return true;
  }

  // fc00::/7 - ユニークローカルアドレス (ULAs)
  // fc00::/7 には fc00::/8 と fd00::/8 が含まれます (fc00:: ~ fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff)
  if (/^fc[0-9a-f]{0,2}:/i.test(ipv6Lower) || /^fd[0-9a-f]{0,2}:/i.test(ipv6Lower)) {
    return true;
  }

  return false;
}

/**
 * uBlockインポート用URLの検証（内部ネットワークブロック）
 * SSRF対策 - 内部ネットワークアドレスへのアクセスを防止
 * @param {string} url - 検証するURL
 * @throws {Error} URLが無効またはプライベートネットワークの場合
 */
export function validateUrlForFilterImport(url: string): void {
  // 既存のバリデーションを使用（プロトコル検証等）
  // Obsidian API用localhostは許可（フィルターインポートのみ別途ブロック）
  validateUrl(url, {
    requireValidProtocol: true,
    blockLocalhost: false
  });

  const parsedUrl = new URL(url);

  // プライベートIPチェック
  if (isPrivateIpAddress(parsedUrl.hostname)) {
    throw new Error(`Access to private network address is not allowed: ${parsedUrl.hostname}`);
  }

  // ドメイン名形式のlocalhostチェック（フィルターインポートのみ）
  if (parsedUrl.hostname === 'localhost' || parsedUrl.hostname.endsWith('.localhost')) {
    throw new Error(`Access to localhost is not allowed for filter imports`);
  }
}

/**
 * VULN-013 fix: Allowed localhost ports (matching host_permissions in manifest)
 */
export const ALLOWED_LOCALHOST_PORTS = new Set([27123, 27124, 11434, 1234]);

/**
 * ローカルAI用ホスト名かどうか判定（localhost / 127.x.x.x / ::1）
 * Ollama、LM Studio等のローカルLLMサーバー向け
 * VULN-013 fix: ポート番号も検証し、許可されたポートのみ信頼する
 */
export function isLocalhostAddress(hostname: string, port?: number): boolean {
  const normalized = normalizeIpHostname(hostname).toLowerCase();

  // localhost / 127.x.x.x (ループバックIPv4) / ::1 (IPv6ループバック) / ::ffff:127.x.x.x (IPv4マップ)
  const isLocalhost =
    normalized === 'localhost' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized) ||
    normalized === '::1' ||
    /^::ffff:127\./.test(normalized);

  if (!isLocalhost) {
    return false;
  }

  // VULN-013 fix: ポート番号が指定された場合は許可されたポートのみ信頼する
  if (port !== undefined) {
    return ALLOWED_LOCALHOST_PORTS.has(port);
  }
  return true;
}

/**
 * AIリクエスト用URLの検証（SSRF対策）
 * 内部ネットワークアドレスへのアクセスを防止
 * ただし、ローカルAI（Ollama、LM Studio等）用の 127.x.x.x / ::1 は許可
 * @param {string} url - 検証するURL
 * @throws {Error} URLが無効またはプライベートネットワークの場合
 */
export function validateUrlForAIRequests(url: string): void {
  // 既存のバリデーションを使用（プロトコル検証等）
  validateUrl(url, {
    requireValidProtocol: true,
    blockLocalhost: false // AIプロバイダーはlocalhostも許可（開発環境等）
  });

  const parsedUrl = new URL(url);
  const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : (parsedUrl.protocol === 'https:' ? 443 : 80);

  // ローカルAI用アドレス（127.x.x.x / ::1）は許可（ポート制限付き）
  if (isLocalhostAddress(parsedUrl.hostname, port)) {
    return;
  }

  // その他のプライベートIPチェック（10.x.x.x / 172.16-31.x.x / 192.168.x.x 等）
  if (isPrivateIpAddress(parsedUrl.hostname)) {
    throw new Error(`Access to private network address is not allowed: ${parsedUrl.hostname}`);
  }
}
