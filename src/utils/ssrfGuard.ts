/**
 * ssrfGuard.ts
 * SSRF防止・IP分類・localhostポリシー。fetch.ts のトランスポート層
 * (timeout/retry/abort) から分離し、fetchモックなしで単体テスト可能にする。
 */

import { errorMessage } from './errorUtils.js';
import { LOOPBACK_PORTS } from './loopbackPorts.js';

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
    // 判定は正規化した hostname（小文字・末尾ドット除去）に対して行う。末尾ドット付きの
    // `localhost.` は同じアドレスに解決されるが、生の hostname ではどの分岐にも当たらない。
    const hostname = normalizeHostname(parsedUrl.hostname);
    if (isPrivateIpAddress(hostname)) {
      throw new Error(`Blocked hostname: ${parsedUrl.hostname}. Access to private network is not allowed.`);
    }
    // ドメイン名形式の localhost は isPrivateIpAddress では検出できないため明示的にブロック
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      throw new Error(`Blocked hostname: ${parsedUrl.hostname}. Access to localhost is not allowed.`);
    }
    // 代替表現 (0x7f., ::1 bracket 等) は BLOCKED_PATTERNS でカバー
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(hostname)) {
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
 * Canonicalize a URL hostname for policy checks: strip IPv6 brackets, lowercase,
 * and remove the DNS root trailing dot(s).
 *
 * `new URL()` keeps the trailing dot (`http://localhost./` yields `localhost.`),
 * which resolves to the same address but does not match the `localhost`
 * equality/suffix checks. Canonicalizing first keeps every policy check on the
 * same footing.
 */
export function normalizeHostname(hostname: string): string {
  return normalizeIpHostname(hostname).toLowerCase().replace(/\.+$/, '');
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

    // 0.0.0.0/8 - This host (0.0.0.0) — should be blocked as localhost equivalent
    if (a === 0) return true;

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

  // :: - IPv6 unspecified（全ゼロアドレス）。IPv4 の 0.0.0.0 と同様に「このホスト」を
  // 表す表現で、接続先が自分自身へ解決されるため許可すると SSRF 経路になる。
  // 0.0.0.0 と同じ扱い（プライベート判定でブロック）にする。
  // URL パーサは [0:0:0:0:0:0:0:0] を [::] に正規化して返すが、ヘルパ直呼び出しでも
  // 展開形で素通ししないよう両方の表記を同じ条件で見る（providerAllowlist.ts と同じ方針）。
  if (ipv6Lower === '::' || ipv6Lower === '0:0:0:0:0:0:0:0') {
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

  // NAT64 well-known prefix (64:ff9b::/96)。末尾 32bit が NAT64 ゲートウェイの
  // 変換先 IPv4 を表すため、埋め込み IPv4 を抽出して判定する。これにより
  // `[64:ff9b::7f00:1]`（127.0.0.1）を public と誤分類しない。
  const nat64Match = ipv6Lower.match(
    /^64:ff9b::((?:\d{1,3}\.){3}\d{1,3}|[0-9a-f]{1,4}:[0-9a-f]{1,4})$/
  );
  if (nat64Match) {
    const embedded = nat64Match[1] ?? '';
    if (embedded.includes('.')) {
      return isPrivateIpAddress(embedded);
    }
    const [highStr, lowStr] = embedded.split(':');
    const embeddedHex =
      ((Number.parseInt(highStr ?? '', 16) << 16) | Number.parseInt(lowStr ?? '', 16)) >>> 0;
    const a = (embeddedHex >>> 24) & 0xff;
    const b = (embeddedHex >>> 16) & 0xff;
    const c = (embeddedHex >>> 8) & 0xff;
    const d = embeddedHex & 0xff;
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
  const hostname = normalizeHostname(parsedUrl.hostname);

  // プライベートIPチェック
  if (isPrivateIpAddress(hostname)) {
    throw new Error(`Access to private network address is not allowed: ${parsedUrl.hostname}`);
  }

  // ドメイン名形式のlocalhostチェック（フィルターインポートのみ）
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error(`Access to localhost is not allowed for filter imports`);
  }
}

/**
 * VULN-013 fix: Allowed localhost ports (matching host_permissions in manifest)
 */
export const ALLOWED_LOCALHOST_PORTS = new Set<number>(LOOPBACK_PORTS);

/**
 * URL の実効ポートを解決する（明示ポートが無ければプロトコル既定値）。
 * https は 443、それ以外は 80。connect-src / SSRF 判定の共通解決に使う。
 */
export function resolveEffectivePort(url: URL): number {
  if (url.port) return parseInt(url.port, 10);
  return url.protocol === 'https:' ? 443 : 80;
}

/**
 * ローカルAI用ホスト名かどうか判定（localhost / 127.x.x.x / ::1）
 * Ollama、LM Studio等のローカルLLMサーバー向け
 * VULN-013 fix: ポート番号も検証し、許可されたポートのみ信頼する
 */
export function isLocalhostAddress(hostname: string, port?: number): boolean {
  const normalized = normalizeHostname(hostname);

  // localhost / *.localhost / 127.x.x.x (ループバックIPv4) / ::1 (IPv6ループバック) /
  // :: (IPv6 unspecified — 0.0.0.0 と同様に自分自身へ解決される) / ::ffff:127.x.x.x (IPv4マップ)
  const isLocalhost =
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized) ||
    normalized === '::1' ||
    normalized === '::' ||
    normalized === '0:0:0:0:0:0:0:0' ||
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
  const hostname = normalizeHostname(parsedUrl.hostname);
  const port = resolveEffectivePort(parsedUrl);

  // ローカルAI用アドレス（127.x.x.x / ::1 / localhost）は許可（ポート制限付き）。
  // isPrivateIpAddress('localhost') は false を返すため、ホスト名形式の localhost も
  // ここでポート許可リストに掛ける（VULN-013 の対象を全ループバック表現へ揃える）。
  if (isLocalhostAddress(hostname)) {
    if (!ALLOWED_LOCALHOST_PORTS.has(port)) {
      throw new Error(`Access to private network address is not allowed: ${parsedUrl.hostname}`);
    }
    return;
  }

  // その他のプライベートIPチェック（10.x.x.x / 172.16-31.x.x / 192.168.x.x 等）
  if (isPrivateIpAddress(hostname)) {
    throw new Error(`Access to private network address is not allowed: ${parsedUrl.hostname}`);
  }
}
